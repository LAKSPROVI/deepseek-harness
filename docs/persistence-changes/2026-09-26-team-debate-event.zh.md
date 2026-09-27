---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-09-26-team-debate-event

[English](2026-09-26-team-debate-event.md) | 中文

## 概述

新增持久的 team/debate Structured Deliberation 事件，为 Team debate 的每次修订记录一条 compare-and-set 转换。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="declaration"></a>
## 声明

```yaml persistence-change
schemaVersion: 1
id: 2026-09-26-team-debate-event
baseline: false
changes:
  - root: "event:team/debate"
    previous: null
    after: "84a7362512e706a545918cfa4af11a97ab9770b4addcbfad9f9e2908c54b465a"
    decision: same-version
```

<a id="compatibility"></a>
## 兼容性

在同一 Session 格式版本中的新 root。既有日志不含此事件因而仍然有效；早于它的读取器会按 required-on-read 规则拒绝携带该事件的日志。该事件只由实验性 Agent Teams 服务在 Lead 通过 team_debate_* 工具启动、暂停、恢复、推进或完成 debate 时追加，其唯一消费者是渲染 debate 面板的客户端 agentTeam 投影。

<a id="verification"></a>
## 验证

pnpm exec vitest run packages/experimental/agent-team packages/experimental/tool-agent-team：共享 CAS debate 测试驱动两轮完整流程（pause/resume/拒绝过期 revision/advance 遍历所有阶段/complete/history），Team 套件通过。

<a id="dev-note"></a>
## 开发备注

无。
