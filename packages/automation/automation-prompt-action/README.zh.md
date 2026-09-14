---
description: "自动化引擎的 CUSTOM_PROMPT 执行器：到期任务打开一个 Workspace Session 并发送其 prompt。"
kind: "package-reference"
---

# @deepseek-ai/dsh-automation-prompt-action

[English](README.md) | 中文

## 概述

自动化引擎随附的执行器。它在 `ctx.automation.worker` 上注册一个处理器（默认键 `CUSTOM_PROMPT`）；当带有该动作的任务到期或被触发时，处理器在任务的工作区创建一个普通的根 Session，挂载配置的 agent preset，应用权限 preset，以任务标题命名 Session，并发送任务的 prompt。prompt 被接纳后运行即记录为成功——与 webhook 运行时相同的即发即忘事务——之后 Session 在 `ctx.agents` 下过它正常的生命周期。

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

在 host 平面上把该行组合在 `@deepseek-ai/dsh-automation` 之后；Web bundle 在 [`cordis.patch.yml`](../../bundle/web-app/cordis.patch.yml) 中这样做。该行注入引擎与 Session 创建接缝（`agents`、`agentDefaultModel`、`agentPresets`、`permissionPresets`、`sessionTitle`、`workspaceRegistry`）。

### 配置

| 键 | 默认值 | 含义 |
|---|---|---|
| `actionType` | `CUSTOM_PROMPT` | 任务在 `actionType` 中引用的处理器键。 |
| `agentPreset` | roster 默认值 | 除非任务载荷指定，否则每次运行挂载的 preset。 |
| `permissionPreset` | 部署默认值 | 除非任务载荷指定，否则每次运行的 Session 获得的权限 preset。 |

### 任务载荷

带有此动作的任务携带 `actionPayload.prompt` 与绝对路径的 `actionPayload.workspacePath`；可选的 `title`、`agentPreset` 与 `permissionPreset` 按任务覆盖默认值。[`@deepseek-ai/dsh-tool-automation`](../tool-automation/README.zh.md) 从对话中组装的正是这个载荷。校验失败的载荷会在任何 Session 存在之前使运行失败。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部——点击展开</summary>

`openPromptSession` 镜像 `createWebhookSession`：解析权限 preset 与 agent preset，取当前默认模型，创建 Workspace，在 `setup` 中挂载 preset 并创建 Agent，附加 Session，设置权限 preset，重命名，然后 `followup` 一条 `source` 为 `{ kind: 'automation', taskId, runId, form: 'notice', summary }` 的用户消息——`MessageSourceMap` 的合并声明位于本包。附加之后的失败会先分离并释放再重新抛出，因此引擎以真实原因记录运行失败，且不会留下半成品 Session。`apply` 把注册包在 `ctx.effect` 中，释放插件 fiber 即移除处理器。

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | 载荷校验、Session 事务、处理器注册 |
| [`tests/prompt-action.spec.ts`](tests/prompt-action.spec.ts) | 调用顺序、覆盖、回滚、worker 注册生命周期 |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [自动化引擎](../automation/README.zh.md)——本处理器注册于其上、并向其报告运行的 worker。
- [自动化工具](../tool-automation/README.zh.md)——如何从对话创建带有此动作的任务。
- [Webhook 运行时](../../webhook/webhook/README.zh.md)——本包镜像的 Session 创建事务。

-----

<a id="model-experience"></a>
## 模型体验

### Session prompt

#### 模型看到什么

新 Session 的第一个用户轮次是任务的 `prompt` 原文，附带 notice 形式的来源摘要 `automation task "<title>" run <runId>`。模型看到的其余一切来自挂载的 preset，而非本包。

#### Token 影响

prompt 自身的 token，在新 Session 开始时出现一次。

#### KV Cache 影响

除普通的首条用户消息外没有影响；preset 的前缀不变。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **成功意味着已接纳，而非已完成** — prompt 被接受时运行即为 `SUCCESS`；Session 的结果不会回报给任务或其通知。
- **每次运行一个 Session** — 不复用已有 Session，也不延续上一次运行的 Session。
- **仅默认模型** — 每个 Session 都从 `agentDefaultModel.currentSelection()` 开始；任务的 `model`/`modelProvider` 字段尚未被参考。
- **Session 没有按任务的超时** — 引擎的 `timeoutSeconds` 限定的是处理器，而处理器在接纳后立即返回，因此永远不会限定 Session。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>

不发布运行时不变量伴生包：处理器在两次运行之间不持有任何状态——每个到期任务打开一个 Session、发送一条提示，并通过收到的 run 汇报——因此没有可检查的事件或可变数据关系。
