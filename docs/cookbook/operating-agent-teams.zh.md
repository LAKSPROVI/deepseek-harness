# Cookbook: 操作 Agent Teams

[English](operating-agent-teams.md) | 中文

当 agent 或维护者通过界面显示为 **Equipe de agentes** 的 `agent-teams` preset 协调任务时，使用本流程。[用户指南](../user/guide/agent-teams.zh.md)负责 Web UI 操作；[子系统参考](../subsystems/agent-team.zh.md)负责持久形式与 API。

浏览器显示巴西葡萄牙语 control，而模型工具与领域值保持稳定：

| Web control | 模型／领域操作 |
|---|---|
| **Criar integrante** | `spawn_teammate`／`spawnTeammate()` |
| **Orientar integrante → Apenas deixar na fila** | `send_message`／quiet delivery |
| **Orientar integrante → Acordar e orientar** | `followup_task`／wakeup delivery |
| **Interromper tarefa** | `interrupt_agent`／`interrupt()` |
| **Iniciar debate** | `team_debate_start`／`startDebate()` |
| **Pausar protocolo**、**Retomar protocolo**、**Avançar fase**、**Concluir debate** | `team_debate_update`，action 为 `pause`、`resume`、`advance` 或 `complete` |

## 1. 决定是否组建 Team

只有用户明确要求 Agent Teams 或 teammate 时才组建 Team。无法拆分的紧耦合工作优先由一个 agent 完成。当角色、证据来源、模型路由或审查责任可以分离时，才使用 Team。

spawn 前先说明共享目标、交付物与停止条件。Lead 始终负责拆分、ownership、冲突解决、验证和最终回答。

## 2. 设计 roster

为每名 teammate 设置不可变的小写 kebab-case name、一项职责和一项输出。角色只需要自身 prompt 时使用 `fresh`；需要 Lead 已完成历史时使用 `fork`。多样性属于任务要求时，在 **Criar integrante** 中选择已配置 provider 及其公布的一个 model；角色需要时再添加 persona。**Herdar provider e modelo da líder** 只在创建时继承一次 Lead 路由；显式选择继续归属于该 teammate，不会跟随 Lead 后续变更。

实用的 roster 让不同成员承担不同失败模式：

- implementer：生成变更；
- reviewer：检查 contract、edge case 与 regression；
- verifier：独立运行 test 或验证外部证据；
- synthesizer：比较结论，但不修改同一批文件。

不要为了增加票数而创建重复的通用 agent。只有角色和证据要求也不同，provider diversity 才有意义。

## 3. 划分文件与证据

并发写入前先创建 Team task。为每个 in-progress task 指定 owner 与 workspace-relative 提示性 write scope。把 scope overlap warning 当作重新划分工作的理由，而不是 filesystem enforcement。

同一时间一个文件只允许一个 writer。read-only review 可以自由分配，但 formatter、generator、lockfile、共享配置和大范围 refactor 必须串行执行。Lead 在报告完成前检查 `git diff`、意外文件、生成输出与最终集成。

## 4. 沟通但不重复工作

可以等待的信息使用 quiet delivery。只有 target 必须再执行一轮时才使用 waking delivery。`queued` receipt 表示消息已经持久化，绝不重试。wait、timeout 或 wakeup 后重新读取 roster、任务板或 debate，因为 wait 只报告注册后发生的 edge，不会回放注册前的变化。

只在必须停止当前 turn 时 interrupt。interrupt 会保留 inbox 与 task ownership；任务要单独 release 或 reassign，debate 也要单独 pause。

## 5. 把 debate 当作证据 protocol

使用可证伪的 topic 和 2 到 10 个 active member name 启动 debate。transition 由 Lead 控制。每个 phase 的要求：

1. `positions`：在成员互相影响前收集独立立场。
2. `critique`：要求 critic 指明 claim、risk 或缺失 test。
3. `rebuttal`：直接回应 critique，不重复原立场。
4. `verification`：运行检查、读取一手来源，并标记未解决 claim。
5. `synthesis`：记录有支持的结论、剩余分歧、不确定性与后续工作。

只有 phase artifact 已经存在才 advance。共识票数不是验证。可以为人工审查 pause，但不要假设 running turn 已停止；需要时明确 interrupt。revision stale 时，读取当前 debate，再针对该状态重新决策。

## 6. 处理 provider 与 lifecycle 失败

把 provider failure 保留为证据。因额度、认证或 transport 失败的持久 member 仍能证明所选 route 与 persona，但不算成功的独立回答。替代工作必须使用新 name 和可用路由，因为 roster name 永不复用。

`inactive` member 可以恢复，并未删除。用具体下一目标唤醒它。进程 restart 后先打开同一个 Lead Session 并检查 roster，再创建任何成员。不要从空白新 Session 或同一工作区的另一个 Session 推断 Team 不存在。

## 7. 完成 Team 任务

Lead 回答前：

1. 等待每名必要成员，或记录其具体失败；
2. 重新列出 task，并明确 release 或 complete ownership；
3. 检查最终 workspace diff，运行相关验证；
4. 读取当前 debate revision 与 transition history；
5. 区分已验证事实、模型判断、未解决 claim 与 provider limitation；
6. 告诉用户完成了什么、哪些证据通过、什么仍被阻塞。

停止工作不会删除 Team 历史。持久 Session 继续作为 roster 身份、消息、任务、debate transition 与 provider outcome 的审计记录。

## 维护者地图

- Host 领域与持久化：[`packages/subagent/agent-team`](../../packages/subagent/agent-team/README.zh.md)
- 模型策略与工具：[`packages/subagent/tool-agent-team`](../../packages/subagent/tool-agent-team/README.zh.md)
- 浏览器控制：[`packages/client/ui-subagent`](../../packages/client/ui-subagent/README.zh.md)
- opt-in preset：[`apps/cli/config/agent-presets/agent-teams`](../../apps/cli/config/agent-presets/agent-teams/agent.cordis.yml)
- 持久类型与生成 Cordis API：[Agent Teams 子系统](../subsystems/agent-team.zh.md)
- 已发布的 rationale 与 alternative：[Agent Teams Agent Note](../../.agents/notes/implemented/feature/2026-08-30-stable-agent-teams-debate.zh.md)
