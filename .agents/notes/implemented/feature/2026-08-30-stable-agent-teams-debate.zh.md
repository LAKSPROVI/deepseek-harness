# Agent Note: Stable Agent Teams routes, debate, and Web controls

Status: implemented

[English](2026-08-30-stable-agent-teams-debate.md) | 中文

## Problem

Agent Teams 最初作为私有实验包孵化，以稳定其持久 roster、mailbox、task 与 lifecycle 规则。发布包不能依赖该位置，因此已发布的 base composition、生成式 Remote assembly 与 Web client 无法在不违反仓库依赖方向的情况下暴露该服务。

对于参与者分别使用不同 LLM provider、model 与 persona 的 Team，单一 child route 也不足够。仅存在于 live Agent 上的 route 选择无法从 roster 检查，也不能在 cold resume 后可靠重建。

结构化审议需要持久的当前 phase、round、participant set 与 compare-and-set revision。interrupt Agent 不等同于暂停 debate；仅靠模型工具也不能提供显式 human control 或可跨 reload 的浏览器 view。

## Decision

Agent Teams 成为 `packages/subagent/agent-team` 与 `packages/subagent/tool-agent-team` 下的稳定产品能力，发布名为 `@deepseek-ai/dsh-agent-team` 与 `@deepseek-ai/dsh-tool-agent-team`。promotion 会原子更新 import、配置行、生成产物与仓库 metadata，不为实验名称提供兼容 shim。

Host service 由 base composition 挂载，因此持久 Team 状态与浏览器 projection 可用，而不会增加模型可见工具。只有 `agent-teams` Agent Preset 挂载 Team tool package 及其协作策略；普通 preset 保留现有 subagent 工具与 prompt 成本。

一个 Team 仍由一名 Lead 与最多九名 teammate 组成。Lead 是 root Session，每名 teammate 是一个 continuable 直接 child；不可变 roster name 继续永久保留 failed provisioning attempt，而不回收身份。

## Per-member routes

每个持久 teammate snapshot 将 continuable provider 与可选 `llmProvider`、`model`、`persona` 选择分开记录。创建 teammate 时，通过 `agentOptions` 转发已解析的 LLM route，并通过 continuable-child composition 转发 persona。subagent descriptor 保留这些值；cold resume 从该 descriptor 重建 child，而不是继承 Lead 当时使用的 route。

省略 route 字段保留显式继承语义：child 在创建时继承 Lead route 或 mounted persona，而显式选择的 provider、model 或 persona 会在后续 Activation 中继续归属于该 child。Roster 与 projection view 暴露持久选择，但不会把 continuable provider 当作 LLM provider。

## Structured debate

Lead Session 以完整 `team/debate` snapshot 保存一个当前 structured debate。debate 携带稳定 id、单调 revision、topic、participant name、round、maximum rounds、status、current phase 与紧凑 transition history。phase 顺序为 `positions`、`critique`、`rebuttal`、`verification`、`synthesis`；从最终 synthesis 推进时，要么开始下一 round，要么在达到 round cap 时完成 debate。

创建与 transition 操作仅由 Lead 授权。每次 transition 都提供 expected revision，并在状态陈旧时失败。`pause` 与 `resume` 改变持久 debate status，不会取消 Agent turn 或修改其 inbox；`interrupt` 仍是独立的 subagent 操作，用于取消当前 turn。human control 通过生成的 Remote 调用相同的持久操作，而模型工具仍受 `agent-teams` preset 限定。

## Projection and Web controls

`agentTeam` Session projection 是浏览器安全的完整值，包含 member、task 与当前 debate。它有意排除 queued mailbox content，因为 pending peer mail 属于投递状态，可能包含尚未进入 target Session 的内容，并且 Team control 不需要它。

Web conversation Team tab 从 history tail 读取初始 projection，并从通用 `session/projection` frame 接收后续值。preset、标签页、control、phase 与 status label、帮助、无障碍文本和本地错误使用巴西葡萄牙语；protocol value、identifier、用户输入内容与 provider diagnostic 保持不变。mutation 使用生成的 `agentTeams` Remote 与当前 projected revision；Client plugin 同时注入 deferred Slot action 所访问的父级 `remote` Service，以及控制 activation 的 `remote.agentTeams` namespace。legacy Host API proxy 因此保持领域无关，也不增加 Team-specific HTTP、SSE 或 WebSocket 约定。

生成式 Typert Remote 是供 Client bundle 消费的已构建 Host artifact。因此 assembled validation 会先生成并构建 Host module，再构建 Client 与 Web shell，随后操作已有 `dsh web` 进程，而不是替代用的 Vite server。只运行 source test 不能证明正在运行的 GUI 与其生成式 Remote 一致。

## Alternatives considered

**把 Agent Teams 保留在 `packages/experimental/` 并增加 Host adapter。** 否决，因为 release BFF 或 Web package 仍不能依赖实验领域，而在 adapter 中复制其类型会为同一持久状态创建两个 authority。

**在每个 base session 中挂载 Team tool。** 否决，因为 service 与 projection 没有模型 token 成本，但 tool schema 与 policy 有。显式启用 preset 可保留普通 request prefix，并避免 Team control 覆盖无关 subagent tool。

**只在 subagent descriptor 中持久化异构 route。** 否决，因为 roster 与浏览器 consumer 需要可检查的持久选择，而 provisioning recovery 必须比较 Team reservation 与实际 materialize 的 child。

**用 mailbox message 或内存 UI state 表示 debate progress。** 否决，因为两者都无法在 restart、HMR、模型工具与 human control 之间提供单一权威 CAS revision。

**在 Team projection 中暴露 mailbox content。** 否决，因为 delivery recovery、de-duplication 与 target admission 拥有该数据；浏览器 control 只需要 roster、task 与 debate state。

**向 legacy API proxy 添加 Team method。** 否决，因为 Session projection 已提供读取路径，Typert Remote 则提供生成式 typed mutation，无需让 carrier 了解另一个业务领域。

## Testing

Package test 覆盖十名参与者上限、不可变 route 字段、显式与继承的 LLM 选择、persona 转发、descriptor-backed cold resume、provisioning reconciliation、debate phase 顺序、transition authorization、stale revision、pause 与 interrupt 的区别、projection replay、fork isolation，以及 mailbox event 不进入 projection。JSONL 与 SQLite restart test 固定持久 recovery。

Tool test 固定显式启用 schema 与模型可见结果。真实 Loader composition test 证明 base service 存在但不带 Team tool，`agent-teams` preset 才贡献这些工具。Typert built-artifact 与 Client mount test 覆盖生成的 Remote，Host API projection test 覆盖通用 carrier，Web test 覆盖初始 history projection、live update、human control，以及 active 或 paused debate 期间的 reload。

## Consequences

Agent Teams 成为受支持的 release dependency，可直接参与 base、Remote 与 Web composition。service 存在于普通 session 中，但在选择 Team preset 前不会增加模型可见 schema 或 policy。

Lead Session 会随完整 member、task 与 debate snapshot 增长。该设计以在后续 snapshot 中重复 debate history 为代价，保留可独立检查的 recovery 与简单 last-wins projection；配置的 participant、task、mailbox 与 round 限额约束 active state，而不是历史日志增长。

参与者的 provider、model 与 persona 是持久 Team fact，因此修改 Lead route 不会重定向现有 teammate。debate pause 是持久协调状态，不是进程 suspension：正在运行的 participant 会继续，除非被单独 interrupt；inactive participant 也不会仅因 phase transition 被唤醒。
