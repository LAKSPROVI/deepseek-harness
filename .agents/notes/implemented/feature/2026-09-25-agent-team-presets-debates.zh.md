# Agent Note：Agent Teams 可复用预设与结构化 debate

Status: implemented

[English](2026-09-25-agent-team-presets-debates.md) | 中文

## 问题

Team Lead 只能在 spawn 时内联写出 teammate 的完整规格才能创建它。重复出现的多成员组合每个 session 都要重新输入；清理整支 roster 需要为每个 teammate 单独调用一次 interrupt；需要对抗性审查的团队也没有结构化、可审计的审议产物——debate 退化为无法追踪的聊天消息。

## 决策

两个机制扩展 Team 领域，都复用既有的 journal 与 tool seam。

**可复用预设。** `templates.ts` 在 `agent-team-templates` 命名空间下持有经 schemastery 校验的 settings：至多五十个 teammate 模板与二十个 squad preset（每个一到九名成员），并带跨字段校验要求 provider 与 model 成对出现。`team_template_save`、`team_template_list` 与 `team_template_delete` 管理模板；`team_squad_save`、`team_squad_list`、`team_squad_delete` 与 `team_squad_spawn` 管理 squad，并可一次性批量实例化整支 squad。`spawn_teammate` 接受可选的 `template_id`，从保存的模板补全缺失字段，显式参数始终优先。`team_roster_dismiss` 批量中断全部活跃 teammate 或指定名单。这些 tool 在调用时通过 `ctx.get` 读取命名空间，因此没有 settings 服务的组合仍然安装全部 Team tool，只有预设 tool 失败，并给出点名缺失服务的清晰错误。

**结构化 debate。** `TeamDebateBoard` 通过 Team journal 为每支 Team 持有至多一个当前 debate：整值 `team/debate` 事件带 compare-and-set revision，五个有序阶段（positions、critique、rebuttal、verification、synthesis），至多 `maxDebateRounds` 轮，并维护只追加的转换历史。只有 Lead 可以开始或转换 debate；参与者必须是两到十个活跃成员名。`team_debate_start`、`team_debate_get` 与 `team_debate_update` 向模型暴露该协议，`TeamDebateMutationResult` 以业务结果的形式在 Remote seam 上携带 Team 拒绝，与任务板的错误契约一致。

## 备选方案

**仅按请求临时组装 squad。** 不持久化预设，每个 session 都要重输 prompt，且丢失经过审校的组合出处。Settings 持久化让被审查过的组合可跨团队复用。

**把 debate 建成共享 DAG 上的任务。** 任务的认领与协作语义无法表达阶段协议或 compare-and-set 的轮次转换；debate 是带历史记录的协议，不是工作项，复用任务 revision 会混淆两个 CAS 域。

**独立的 debate 服务。** journal 已经拥有事务串行化、append-and-flush 与整值 projection 模式；`TeamTaskBoard` 是先例。再开一个 seam 会复制每支 Team 的事务队列。

## 后果

部署方必须注册 `agent-team-templates` 命名空间，预设 tool 才能工作；注册是一个 effect，释放注册方即移除。`maxDebateRounds` 默认为八，并约束 `max_rounds` 参数。projection 校验 debate revision 的连续性，并通过 projection state 报告失败，绝不发明转换。debate 期间的发言通过 `send_message` 流转：按参与者的 compare-and-set 贡献记录曾有过设计并被有意省略，持久面收敛为协议转换本身。新增 `team/debate` 事件要求 `isTeamEvent`、`MutableTeamEventType`、zod 事件 schema 与持久态 entry schema 同步扩展，且 Remote 签名的类型分类落在 `agent-team` 子系统页。

## 测试

聚焦套件端到端覆盖两个机制：针对已注册 settings 命名空间的模板与 squad 保存/列表/删除循环、`spawn_teammate` 的模板展开与显式参数覆盖、批量 dismissal、名字归一化，以及完整的两轮 debate 协议——Lead 权限拒绝、重复启动拒绝、pause、resume、过期 revision 拒绝、九次阶段推进、从 synthesis 完成，以及 history 长度等于 revision 计数。`pnpm exec vitest run packages/experimental/agent-team packages/experimental/tool-agent-team` 96/96 通过；`tsc -b tsconfig.host.json` 与 `tsc -b tsconfig.client.json` 干净；生成的 tool、config 与 Cordis catalog 在本变更中一并再生成，并记录双语配对。
