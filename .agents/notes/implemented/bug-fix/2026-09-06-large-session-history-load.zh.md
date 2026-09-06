# Agent Note：大会话历史加载

Status: implemented

[English](2026-09-06-large-session-history-load.md) | 中文

## 问题

在 Web 客户端打开一个很大的会话时，要么卡住一分多钟，要么以 `Failed to load history: signal timed out (internal)` 失败。某位运维的存档里最大的会话（一份 31 MB 压缩事件日志）实测需要 76 秒——机器负载高时 162 秒——才能返回一页 `PAGE_MESSAGES`（50）条消息的 `session.history`，因为宿主在分页时会为该页的每个 tool event 计算一个渲染视图。浏览器载体（`packages/host/apiproxy/src/fetch/client.ts` 中的 `AbstractApiClient`）对有界 unary 调用施加固定的 30 秒 `AbortSignal.timeout`，而 `session.history` 用的是默认策略。`packages/client/runtime/src/client/sessions/session.ts` 中的 `doOpen` 在该超时后重试一次，同样是 30 秒，因此一页超过约 30 秒的会话永远打不开。

## 决策

两处改动，都在面向客户端的路径上：

- 第三种 `UnaryTimeoutPolicy`，`'extended'`（`EXTENDED_TIMEOUT_MS = 180_000`），仅应用于 `session.history` 和 `subagent.history`。其余每个 unary 调用保持 30 秒健康期限。这两者是用户发起的读取，带连接层取消，因此宽松的上限是安全的，同时仍能给一个真正卡死的宿主设界。
- 顶层会话（`this.address === undefined`）的 `doOpen` 请求 `FIRST_PAGE_MESSAGES`（8）而非 `PAGE_MESSAGES`（50）。`session.history` 的成本大致与该页的消息数线性相关，所以最近的往来会在几秒内渲染出来；`loadOlder` 在滚动时仍拉取 `PAGE_MESSAGES`。subagent 的打开保持整页——这是一条较冷的路径，且若干测试钉住了确切的 `subagent.history` 请求。

## 验证

`session.client.spec.ts` 与 `manager.client.spec.ts` 通过（112 个测试）：常规会话的断言检查 history 调用次数与 `beforeSeq`，从不检查第一页的 `maxMessages`，而 subagent 的断言仍然看到 `maxMessages: 50`。针对运行中的后端实测，31 MB 会话的 8 条首页在 180 秒上限之内返回，最近的轮次可见。

## 曾考虑的替代方案

- **移除历史读取的期限（`'caller-signal-only'`）** — 拒绝：一个真正卡死的宿主会让打开的转圈永远转下去且无任何反馈；一个大但有限的上限保留了失败信号。
- **对每一页都缩小 `PAGE_MESSAGES`** — 拒绝：这会给普通会话平白多加一次 `loadOlder` 往返而没有好处；只作用于首页的旋钮让常规分页保持不变。
- **subagent 首页也缩小** — 此处拒绝：subagent 打开路径更冷，`session.client.spec.ts` / `manager.client.spec.ts` 断言其确切的 `maxMessages`；收益在大会话所在的顶层会话列表上。
- **在宿主上惰性计算 tool event 视图，而非在分页时** — 推迟：这是对底层成本的正确长期解法，但涉及宿主与共享客户端 fold 如何划分工作的结构性改动，超出一个加载时回归的范围。

## 后果

一个很大的会话打开时会在几秒内显示其最近 8 条消息，而不是卡在整个尾页上，且低于 180 秒的慢历史读取不再让会话报错。顶层会话现在总是要多花一次 `loadOlder` 才能看到第 9 条及更早的消息。底层每页视图计算的成本不变；一个病态到 8 条消息也超过 180 秒的会话仍会失败，届时上面的惰性视图方案就是补救。
