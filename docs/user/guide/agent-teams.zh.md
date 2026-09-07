# 使用 Equipe de agentes 操作 Agent Teams

[English](agent-teams.md) | 中文

Agent Teams 让一名 Lead 在同一工作区内协调最多九名具名 teammate。每名 teammate 都可以使用自己的 LLM provider、model 和 persona。Team 会把 roster、任务板、peer message 与结构化 debate 保存在 Lead Session 中，因此页面重载和 cold resume 后状态仍然存在。

当任务需要不同角色、独立模型路由、显式批评或人工控制综合时使用 Agent Teams。Team 负责协调工作；它不会证明答案正确、隔离文件或取代审查。

## 1. 准备路由

打开**设置 → 模型**，配置计划分配的每个 provider 和 model。重要工作开始前先测试各条路由。有效路由可以创建 teammate，但 provider 之后仍可能因额度、凭据或服务可用性拒绝请求；roster 会保留所选路由，child 历史会保留 provider 错误。

## 2. 启动 Team Session

选择工作区，选中 **Equipe de agentes** Agent preset，然后创建 Session。向 Lead 发送具体目标，并明确要求使用 Agent Team。Team 工具只在该 preset 中可用；其他 preset 不会增加 Team schema 或协作策略。

Lead 是第一个参与者。roster 上限是一名 Lead 加九名 teammate。所有成员共享工作区，并立即看到文件变更。

## 3. 打开 Equipe de agentes 标签页

第一个 prompt 获准后，在 **Chat** 与 **Trajectory** 旁打开 **Equipe de agentes**。操作视图使用巴西葡萄牙语标签，包含：

- **Integrantes**：持久 name、role、provider/model/persona 与实时 status；
- **Tarefas**：共享任务图与提示性的 write scope；
- **Debate**：topic、participant、phase、round、status 与 transition history；
- **Criar integrante**：teammate 身份、初始目标、context 与 route；
- **Orientar integrante**：发给一名 teammate 的持久 quiet 或 waking 消息。

当 teammate 在当前页面状态之外完成、失败或恢复时，使用 **Atualizar status**。

## 4. 创建 teammate

在 **Criar integrante** 中填写：

| 字段 | 含义 |
|---|---|
| **Nome** | 不可变的小写 kebab-case 名称，例如 `security-reviewer`；不能是 `lead`，也不能复用、重命名或删除。 |
| **Descrição** | roster 与 child catalog 中显示的简短职责。 |
| **Instrução inicial** | teammate 的第一个目标；写明预期输出与证据。 |
| **Contexto** | **Começar sem histórico** 不带 Lead 历史；**Copiar histórico concluído** 只复制一次 Lead 已完成 turn 前缀。 |
| **Provider de LLM** | 选择一个已配置 provider，或保留 **Herdar provider e modelo da líder**，在创建时继承 Lead 路由。 |
| **Modelo** | 从所选 provider 中选择一个 model；显式 provider 必须同时选择显式 model。 |
| **Persona** | 只属于该 teammate 的附加 system persona。 |

创建职责不同的角色，不要复制多个通用 agent。实用的三人 roster 是 Lead、implementer 与使用不同 model 或 provider 的 verifier。provisioning 失败也会占用 name，因此修复路由后必须使用新 name。

## 5. 协调工作

为每名 teammate 指定一项职责、预期交付物与不重叠的 write scope。write scope 是警告，不是锁：Bash、formatter、generator 和外部程序仍能修改相同文件。Lead 必须检查最终 diff 并解决冲突。

**Orientar integrante** 提供：

- **Apenas deixar na fila**：保存 guidance，但不唤醒 inactive teammate；
- **Acordar e orientar**：让消息成为 teammate 的下一 turn，并在需要时 cold-resume。

queued message 已经持久化。不要仅因没有立即投递而重发。只有需要取消 teammate 当前 turn 时才用 **Interromper tarefa**；interrupt 不会暂停 debate、清除 queued guidance 或释放任务 owner。

## 6. 运行结构化 debate

输入一个决策或问题，选择 2 到 10 名 active participant，设置最大 round，然后选择 **Iniciar debate**。protocol 按以下顺序推进：

1. **posições**：每名参与者陈述立场与证据。
2. **crítica**：识别薄弱点与缺失证据。
3. **réplica**：回应批评。
4. **verificação**：检查 claim、test 与 source。
5. **síntese**：Lead 记录共识、分歧、不确定性与下一步。

只有在所需贡献已经出现后才使用 **Avançar fase**。**Pausar protocolo** 会冻结 phase 推进，但不会取消正在运行的 model turn。**Retomar protocolo** 重新允许推进。**Concluir debate** 只在 active synthesis 可用；推进最后的 synthesis 会开始下一 round，达到配置的 round cap 后完成 debate。

每次 transition 都使用当前显示的 revision。若其他 actor 已经改变 debate，先刷新状态，再对新 revision 执行动作，不要覆盖它。

## 7. 重载并继续

重载页面或重新打开 Lead Session。roster、teammate route 与 persona、任务板、当前 debate 和 transition history 都会恢复。可通过 waking guidance 恢复 inactive teammate。之后改变 Lead model 不会重定向已有显式 route 的 teammate。

## 正确理解 status

- **em execução**：正在执行 model turn。
- **ocioso**：teammate live，但没有 active turn。
- **inativo**：持久 teammate 存在但当前不驻留；waking guidance 可以恢复它。
- **em criação/falhou**：创建尚未到达 active member，或以持久失败结束。
- **debate ativo/pausado/concluído**：protocol 状态，与 member runtime status 相互独立。

## 故障排除

| 症状 | 操作 |
|---|---|
| 没有 **Equipe de agentes** 标签页 | 确认 Session 使用 **Equipe de agentes** preset，并且第一个 prompt 已经获准。 |
| provider 返回额度或认证错误 | 在**设置 → 模型**中修复 provider，然后使用新 teammate name 或可用路由。原失败会保留在持久记录中。 |
| teammate 为 inactive | 发送 **Acordar e orientar**；不要用同一 name 重新创建。 |
| guidance 显示 queued | 把它视为已接受的持久工作，不要重试；需要执行时再唤醒 teammate。 |
| debate action 报告 stale state | 刷新 Team view，并对当前显示的 revision 重试。 |
| pause 没有停止正在生成的回答 | 这是预期行为；对该成员使用 **Interromper tarefa**。pause 只控制 protocol 推进。 |
| 两名 agent 修改同一文件 | 停止重叠工作，检查 diff，分配明确 owner，并手工解决冲突。write scope 仅作提示。 |
| restart 后状态不同 | 重新打开准确的 Lead Session。同一工作区中的不同 Session 仍是不同 Team。 |

## 进一步参考

- [Agent Teams 子系统地图](../../subsystems/agent-team.zh.md)
- [面向 agent 与维护者的 Agent Teams 操作指南](../../cookbook/operating-agent-teams.zh.md)
- [配置模型 provider](providers.zh.md)
