---
description: "Agent Teams 的包地图：持久团队领域及其面向模型的工具。"
kind: "package-group"
---

# agent-team/：具名 teammate 与共享任务板

[English](README.md) | 中文

## 概述

Agent Teams 家族让一个 Session 拥有一组具名 teammate，它们交换持久消息并通过共享任务板协作。领域包持有持久记录并发布 `ctx.agentTeams`；工具包提供由 preset 挂载的团队作用域工具。当随附的 Web bundle 开始依赖它们时，两者从 `experimental/` 提升为正式包：发布成员不能依赖私有原型。

## 目录

- [包](#packages)
- [相关文档](#related-documentation)
- [开发说明](#dev-note)

-----

<a id="packages"></a>
## 包

| 包 | 角色 | ctx 键 |
|---|---|---|
| [`agent-team/`](agent-team/README.zh.md) | roster、持久消息、共享任务板与 Cordis 服务 | `ctx.agentTeams` |
| [`tool-agent-team/`](tool-agent-team/README.zh.md) | 让模型创建、发消息与协调 teammate 的九个团队作用域工具 | 注册到 `ctx.tools`，消费 `ctx.agentTeams` |

浏览器投影位于 [`client/ui-agent-team`](../client/ui-agent-team/README.zh.md)；源码 checkout 的 profile 层仍在 [`experimental/agent-team-profile`](../experimental/agent-team-profile/README.zh.md) 与 [`experimental/agent-team-web-profile`](../experimental/agent-team-web-profile/README.zh.md)。

<a id="related-documentation"></a>
## 相关文档

[Agent Teams 子系统参考](../../docs/subsystems/agent-team.zh.md) 持有持久 Team 类型与 `ctx.agentTeams` 服务 API。

<a id="dev-note"></a>
## 开发说明

无。
