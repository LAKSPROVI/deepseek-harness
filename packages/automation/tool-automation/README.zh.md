---
description: "面向模型的 automation_* 工具：通过 ctx.automation 创建、列出、触发、暂停、恢复与删除持久化任务。"
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-automation

[English](README.md) | 中文

## 概述

六个让 agent 管理部署所有者持久化任务的工具：`automation_create_task`、`automation_list_tasks`、`automation_trigger_task`、`automation_pause_task`、`automation_resume_task` 与 `automation_delete_task`。每次写入都经过引擎的所有权检查，因此属于其他所有者的任务会被报告为不存在而不是被修改。创建的任务默认使用 `CUSTOM_PROMPT` 动作，其执行器（[`@deepseek-ai/dsh-automation-prompt-action`](../automation-prompt-action/README.zh.md)）在任务到期时于任务的工作区打开一个 Session 并发送 prompt。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

在 agent preset 中添加一行；Web bundle 的 `automation` preset（[`presets/automation`](../../bundle/web-app/presets/automation/agent.cordis.yml)）是随附示例。该行注入 `tools` 与 `automation`，因此 host 组合必须在任何命名本包的 preset 挂载之前携带引擎（`@deepseek-ai/dsh-automation`）。没有配置字段。

### 从对话创建任务

`automation_create_task` 接收标题、`schedule_type`（`ONCE`、`INTERVAL`、`CRON`、`RRULE`）及其 `schedule_expr`，以及默认 `CUSTOM_PROMPT` 动作所需的 `prompt`。工作区默认为调用 Session 的目录；`workspace_path` 可覆盖。`max_runs` 限定调度次数，`timezone` 作用于 `RRULE`。其他 `action_type` 只作为键被接受；是否存在对应处理器是部署方的事，没有处理器的运行会被记录为失败。

### 查看与控制

`automation_list_tasks` 以 `AutomationTaskView` 记录返回所有者的任务。`automation_trigger_task` 排队一次立即运行并返回其 id；运行在后台进行。`automation_pause_task` 与 `automation_resume_task` 切换调度，`automation_delete_task` 连同运行历史一起移除任务。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部——点击展开</summary>

`apply` 用 `defineTool` 在 `ctx.tools` 上注册六个定义；注册表随插件 fiber 释放它们。创建通过 `ctx.automation.store.createTask` 写入，`userId` 固定为 `ctx.automation.owner`，然后经 `taskView` 读回视图，使模型看到的与面板完全一致。控制工具调用引擎的 `triggerNow`、`pauseTask`、`resumeTask` 与 `deleteTask`；`AutomationTaskNotFoundError` 被改写为一行指向 `automation_list_tasks` 的消息。

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | 工具定义、载荷组装、所有权失败改写 |
| [`tests/tool-automation.spec.ts`](tests/tool-automation.spec.ts) | 注册、创建默认值、控制流程、拒绝外部所有者 |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [自动化引擎](../automation/README.zh.md)——存储、调度器、worker、reaper 与 `automations` Remote 命名空间。
- [Prompt 动作](../automation-prompt-action/README.zh.md)——`CUSTOM_PROMPT` 背后的执行器。
- [任务自动化子系统](../../../docs/subsystems/automation.zh.md)——持久化记录与 Remote 界面。

-----

<a id="model-experience"></a>
## 模型体验

### 工具 schema

#### 模型看到什么

模型看到六个生成的 [`automation_*` schema](../../../docs/tool-catalog.zh.md#deepseek-aidsh-tool-automation)：带有标题、调度、prompt、工作区与动作字段的 `automation_create_task`，以及各接收一个任务 `id` 的五个控制工具。

#### Token 影响

在携带这些工具的 preset 挂载期间，每个请求都有固定的 schema 成本。

#### KV Cache 影响

定义与可见性不变时前缀稳定。插件生命周期或作用域限制可能使这些 schema 的复用失效。

### 工具调用历史与结果

#### 模型看到什么

模型的参数保留在 assistant 工具调用中。下一步看到的是格式化 JSON 形式的任务视图（`id`、`title`、`scheduleType`、`status`、`nextRunAt`、`lastRunAt`、`totalRunsCompleted`、`maxRuns`、时间戳）、列表 `{"tasks":[…]}`、触发时的一行 `Run queued: <runId>`，或删除时的 `Deleted task <id>`。被拒绝的控制调用是一行提及 `automation_list_tasks` 的错误。

#### Token 影响

每个任务视图约 60 个保留 token；列表随所有者的任务数量增长。

#### KV Cache 影响

仅追加；新可见内容跟随可复用的请求前缀，不会使现有 KV-cache 条目失效。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **没有编辑工具** — 修改调度或 prompt 意味着删除再创建；引擎的 `updateTask` 未暴露给模型。
- **没有运行历史** — 工具只显示任务视图；运行日志与通知留在 Host 侧并到达面板，而非模型。
- **单一所有者** — 工具代表 `ctx.automation.owner` 行事；没有按 Session 的所有权。
- **触发是即发即忘** — `automation_trigger_task` 在运行完成前就返回 run id；模型只有稍后列出才能知道结果。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>
