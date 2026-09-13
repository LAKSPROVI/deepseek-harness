---
description: "使用并排查实验性 Web 自动化面板：列出 Host 自动化任务并触发、暂停或恢复它们。"
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-client-ui-automation

[English](README.md) | 中文

## 概述

这个私有浏览器包在 Web 会话 header 中添加一个自动化动作。打开后列出 Host 持有的自动化任务，并提供 Host 暴露的三个安全控件：立即触发、暂停、恢复。它只通过 [`@deepseek-ai/dsh-automation`](../../automation/automation/README.zh.md) 生成的 `automations` Remote 命名空间读取和修改状态；从不读取 Host 文件系统或 `store.json`，也不创建、删除、迁移或缓存任何任务。

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

先加载 Host 自动化引擎，再在 Web Client bundle 中加载本包；源码检出的 Web profile 在 [`cordis.patch.yml`](../../bundle/web-app/cordis.patch.yml) 中同时列出两者。Client 导出挂载 `/client` 入口；根 Host 导出是惰性的，本包没有用户配置字段。

### 读取并控制列表

header 按钮切换面板，并在每次打开时重载列表。每行显示任务标题、调度类型、状态与下次运行时间。`Trigger` 请求 Host 立即运行一次并显示返回的 run id；`Pause` 与 `Resume` 切换任务状态。每个被接受的动作都会重载权威列表，因此面板从不显示本地猜测的状态。被拒绝的动作——包括属于其他所有者的任务返回的 `automation/not-found`——以一行错误显示，列表保持不变。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部——点击展开</summary>

[`src/client/mount.ts`](src/client/mount.ts) 挂载来自 `@deepseek-ai/dsh-automation/remote` 的生成 Remote 贡献，然后在注入了 `remote.automations` 的子作用域中注册一个 `conversation.session.header.actions` slot（id `automation`，order 30）。每次 Remote 调用都会解开 `RemoteResult` 信封并抛出其错误分支，因此组件只处理一种失败形状。释放插件 fiber 会移除 slot 并卸载命名空间；注册 slot 时失败会先卸载命名空间再重新抛出。

| 文件 | 职责 |
|---|---|
| [`src/client/mount.ts`](src/client/mount.ts) | Remote 挂载、子作用域与 slot 注册 |
| [`src/client/AutomationAction.tsx`](src/client/AutomationAction.tsx) | 面板状态：列表、刷新、单行错误 |
| [`src/client/types.ts`](src/client/types.ts) | props 契约与面板渲染的任务视图形状 |
| [`src/index.ts`](src/index.ts) | 惰性 Host 入口 |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [自动化引擎](../../automation/automation/README.zh.md)——存储、调度器、worker、reaper 与 `automations` Remote 命名空间。
- [任务自动化子系统](../../../docs/subsystems/automation.zh.md)——持久化记录与 Remote 界面。
- [实验性包](../README.zh.md)——孵化状态与发布排除规则。

-----

<a id="model-experience"></a>
## 模型体验

无：这个浏览器面板不注册任何 tool、prompt 段或会话事件。

#### KV Cache 影响

无直接影响；Host 引擎以及部署方注册的动作处理器负责之后任何模型可见的使用。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **不能创建或删除** — Host 未通过 Remote 暴露这两者，因此面板无法添加或移除任务；模型通过 `automation_*` 工具完成这些操作。
- **仅按需重载** — 面板在打开和每次动作后刷新；不订阅任何实时事件流，因此面板打开期间完成的计划运行只在下次重载后可见。
- **没有运行历史** — 面板只显示任务视图；运行日志与通知留在 Host 侧。
- **仅英文文案** — 面板尚未注册 locale 字典。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>

**运行时不变量：** 面板只持有一个 slot 注册和一个已挂载的命名空间；显示的每个状态都来自最近一次成功的 `list()`。

不发布运行时不变量伴生包：面板仅存在于浏览器侧，它拥有一个槽位注册并渲染最近一次成功的 `list()` 结果，二者宿主侧安装器都无法观察。
