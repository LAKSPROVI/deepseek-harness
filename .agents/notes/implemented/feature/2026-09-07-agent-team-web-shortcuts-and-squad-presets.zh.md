# Agent Note: Agent Teams 快速指导、任务 Kanban、debate 导出与 squad preset

Status: implemented

[English](2026-09-07-agent-team-web-shortcuts-and-squad-presets.md) | 中文

## Problem

即使操作者已经在查看某个 teammate 的 roster 卡片，向该 teammate 发送 guidance 之前也必须手动切换到 **Orientar integrante** 标签并从下拉菜单中选择目标。任务创建没有专用表单，一旦 Team 积累超过几个任务，扁平列表就无法提供按状态的总览。debate 的 synthesis 与 transcript 只能在 Web view 内阅读，没有办法带入另一份文档或消息。

招募一个固定的 multi-agent 阵型——同样的三四个 teammate 角色及其 prompt、provider 与 persona——需要为每个成员单独调用一次 `spawn_teammate`，并且跨会话反复复制粘贴同一份配置。清理一个包含若干已完成或已停滞 teammate 的 Team，需要为每个名字单独调用一次 `interrupt_agent`。

## Decision

Web view（`ui-subagent` 的 `AgentTeamView`）新增三个控件：**Integrantes** 中每张 teammate 卡片带有 **💬 Orientar** 快捷按钮，切换到预先聚焦该成员的 guidance 标签；**Tarefas** 侧边栏获得任务创建表单（subject、description、可选 write scope）以及 List／Kanban 切换，把任务按 pending／in-progress／completed 分栏展示；**Debate** 获得一键 Markdown 导出，把 debate synthesis、带作者归属的发言 transcript 与 phase transition history 复制到剪贴板。

`tool-agent-team` 新增两个面向模型的批量 tool。`team_squad_spawn` 一次调用即可实例化已保存 squad preset 的全部成员：对每个成员按其保存的 name、description、prompt、context、provider、model 与 persona 循环调用 `ctx.agentTeams.spawnTeammate()`。`team_squad_save`／`team_squad_list`／`team_squad_delete` 管理 squad preset（`SavedTeamSquad`：id、title、description、一到九个 `SavedSquadMember`），管理方式与 `team_template_save`／`list`／`delete` 管理单个 teammate 模板完全一致：两者都存放在 Host `settings` 服务的 `agent-team-templates` namespace 下，用同一个 `TeamTemplateSettingsSchema` 校验，各自独立设置上限（`MAX_TEAM_TEMPLATE_COUNT` = 50 个模板，`MAX_TEAM_SQUAD_COUNT` = 20 个 squad）。`team_roster_dismiss` 一次调用即可中断全部活跃 teammate，或仅中断指定名字的 teammate，并容忍已经不活跃的名字。

`agent-team` 拥有 `SavedTeamSquad`／`SavedSquadMember` 类型以及模板与 squad tool 共用的 settings-schema 校验；该包自身从不读写 settings —— `tool-agent-team` 是唯一的 settings 调用方。

## Alternatives considered

**用连续的 `spawn_teammate` 调用代替 `team_squad_spawn`。** 已否决：保存 preset 的意义正是为了避免逐轮重复一份已验证可用的多成员配置；单次批量 tool 调用符合这一意图，并且从模型视角看保持操作原子——循环中途失败仍会保留已经 spawn 成功的成员，与 `spawn_teammate` 本身"不回滚"的失败模式一致。

**为 squad 单独开一个 settings namespace。** 已否决：squad 与模板共享校验形状（拒绝重复 id、要求 provider／model 成对出现），共享 namespace 可以避免为这个结构上属于同一可复用配置功能、只是基数不同的特性再开一个 settings key、一份 schema 和一条迁移路径。

**现在就上线 squad 与 dismiss 的 Web UI 控件。** 已推迟：两者先作为纯模型 tool 上线；Web UI 已经提供等价的逐一操作流程（对每个成员分别调用 `spawn_teammate`／`interrupt_agent`），因此没有能力损失；专属的批量 UI 推迟到有明确的用户需求驱动其设计时再做。记录在两个包 README 的 Known Limitations and Deferred Work 中。

## Consequences

`tool-agent-team` 在每个 Team member scope 注册 22 个 tool，此前为 14 个；该包 Model Experience 一节记录的固定策略与 schema 成本随之增长。squad preset 与 teammate 模板共享同一套 50-模板／20-squad 上限统计和 settings namespace，因此这两个特性不会在各自独立的上限之间互相悄悄争抢配额。

Web view 新增的三个控件不引入任何新的模型可见 schema 或 Session event：guidance 聚焦、Kanban 切换与 Markdown 导出都是纯客户端呈现，基于 projection 已经携带的数据，由现有 `agent-team`、`tool-agent-team` 与 `ui-subagent` 测试套件（133 个测试）验证，无需新增 snapshot fixture。
