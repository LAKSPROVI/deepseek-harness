# Agent Note：浏览器本地的会话状态覆盖与固定"进行中与近期会话"区块

Status: implemented

[English](2026-09-25-workspace-session-status-overlays.md) | 中文

## 问题

上游 0.1.6 的 workspace 重设计用统一的 `SessionStatuses` map 取代了 fork 的按会话人工分诊，该 map 只持有来自 Host 的实时事实（running、pending interaction、completion-unread）。它把用户自主标记的层整个丢掉了：没有办法把会话标记为"已结束"或"稍后完成"，没有按决定产生的未读状态，工作区树上方固定的"进行中与近期会话"区块也随旧推导一起消失。

## 决策

浏览器视图 store 持有一张持久化 map：`customSessionStatuses: Record<string, CustomSessionStatus | undefined>`，记录用户选择的每种状态（`ongoing`、`warning`、`unread`、`later`、`completed`、`finalized`、`idle`）。唯一的 `setSessionStatus` action 写入；会话列表推导通过 `sessionNode`、`deriveFlat` 与 `deriveGroups` 上的可选 overlay 参数把值携带到每个 `SessionNode.customStatus`，使实时 Host 事实仍然是 running 与 completion 状态的唯一来源。

`deriveRecentAndInProgress` 从统一状态 map 加 overlay 推导固定区块：排除用户标记为 completed、finalized 或 idle 的会话，收录每个正在运行、有运行中 subagent、等待交互、有未读完成提醒、或携带 later/warning overlay 的会话，并按最新顺序最多显示六行。每行以所属 Workspace 标题作为徽章展示。行状态呈现的优先级为：等待中的交互、warning overlay、running、subagents，然后是 finalized、later 与 unread 的 overlay 圆点；`data-state` 属性标记 overlay 圆点，测试与辅助工具都能定位。行菜单通过 `setSessionStatus` 直接设置任意状态；树、平铺列表与近期行共用同一 handler。

## 备选方案

**像 fork 那样持久化三张 map（completed、unread、custom）。** fork 的存储把同一事实拆进三条记录，每次写入都要做跨 map 记账。一张 map 通过值比较推导其余状态。

**从 `completionUnread` 推导"已完成"。** 那个 flag 属于 Host：它报告一次未被查看的已观察停止。用户断言"已结束"是对会话的决定，不是对某个轮次的观察；混用会让 replay 与浏览器不一致。

**只在客户端保留区块。** 持久化在视图 store 里，区块在刷新后完全一致，且不需要新的 session 事件——与排序和展开状态既有的持久化方式一致。

## 后果

overlay 完全借用既有推导 seam：没有新的 session 事件、没有新的持久化格式、没有 host 面变更。所有读取点都是可选的，因此从不设置状态的组合行为与上游完全一致。`customSessionStatuses` 字段通过 store 的持久化 blob 复水；overlay 之前的 `dsh.workspace.view.v5` 状态在首次写入时填充为空 map。用户标记为 completed 或 finalized 的行保留在各自的分组中并退出固定区块；近期区块仅在状态回响时重算。浏览器测试锚定了区块的渲染契约：标题标签、Workspace 徽章、一键打开，以及运行中行上的 ongoing 圆点。

## 测试

workspace-browser 客户端 spec 端到端覆盖固定区块：挂载一个运行中会话与一个空闲兄弟会话时，区块渲染在树上方，Workspace 徽章同时出现在区块行与分组标题中，运行中行暴露 `data-state="ongoing"`，单击打开会话。完整的 workspace 套件（218 个测试）以及 host 与 client 的 typecheck 在 overlay 接入树、平铺列表与近期行后全部通过。
