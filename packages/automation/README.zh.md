---
description: "持久化任务自动化引擎及其 Web 面板的包地图。"
kind: "package-group"
---

# automation/：持久化计划任务

[English](README.md) | 中文

## 概述

Automation 家族在任何实时对话轮次之外运行计划任务：基于文件的存储、周期调度器、执行 worker、崩溃恢复 reaper 与通知流。一个 Host 服务持有全部组件，并发布供 Web 面板消费的 `automations` Remote 命名空间。

## 目录

- [包](#packages)
- [相关文档](#related-documentation)
- [开发备注](#dev-note)

-----

<a id="packages"></a>
## 包

| 包 | 职责 | ctx key |
|---|---|---|
| [`automation/`](automation/README.zh.md) | 存储、周期、worker、reaper、通知、REST/SSE 库导出与 Cordis 服务 | `ctx.automation` |

浏览器面板位于 [`experimental/client-ui-automation`](../experimental/client-ui-automation/README.zh.md)，消费 `ctx.remote.automations`。

<a id="related-documentation"></a>
## 相关文档

[任务自动化子系统参考](../../docs/subsystems/automation.zh.md) 负责持久化记录与 Remote 界面。

<a id="dev-note"></a>
## 开发备注

无。
