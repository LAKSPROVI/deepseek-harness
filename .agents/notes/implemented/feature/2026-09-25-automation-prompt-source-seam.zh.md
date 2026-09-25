# Agent Note：Automation 的 prompt 消息经由不透明的 MessageSource seam

Status: implemented

[English](2026-09-25-automation-prompt-source-seam.md) | 中文

## 问题

`automation-prompt-action` 为到期的任务打开 Session，并把初始 prompt 作为一条 `user/message` 发送，其 `source` 指名 automation 运行（`kind: 'automation'`，带 `taskId` 与 `runId`）。0.1.6 的持久化类型历史把向 `MessageSourceMap` 增加该成员归类为持久化 union-variant 变更：需要 Session 格式版本升级，而那要求迁移边、逐产物的 stage 实现与快照后继。运行时自动化引擎今天在没有该类型注册的情况下正常工作；格式升级本身是一个完整的发布级项目。

## 决策

该包保留本地的 `AutomationMessageSource` 接口，记录精确的来源对象，并通过不透明的 `MessageSource` seam 发出它：`satisfies AutomationMessageSource as unknown as MessageSource`。在相邻的 V3-to-V4 格式边交付之前，暂缓把 `automation` 成员注册到 `MessageSourceMap`；双重转换让这一暂缓成为显式且经过编译的产物，而不是未检的载荷。行文规范用"消息 `source` 与 Session 标题回退"替换了 JSDoc 里的 "provenance" 一词，保持术语具体。

## 备选方案

**现在就注册该成员。** 这条路机制上正确，但会把完整的格式版本流程——身份边、逐产物 stage、校验器、快照后继、两个 SDK 的录制——拖进一个产品价值在自动化引擎本身的任务里。

**复用 `MessageSourceMap` 的通用 `plugin` 成员。** `plugin` 成员携带 `{ kind: 'plugin'; plugin: string } & ContextFormed`，会把结构化的 `taskId` 与 `runId` 压进一段 summary 字符串，丢失恢复工具读取的机器可读运行标识。

**完全去掉 source 对象。** 来源是把 Session 与创建它的任务运行连接起来的审计线索；删除它会让 Session 变成孤儿。

## 后果

持久化字节与 seam 之前的实现完全一致：线上与日志没有任何变化。TypeScript 仍通过 `satisfies` 对照本地接口检查对象，字段漂移会让构建失败。当 V3-to-V4 边交付时，把该转换替换为真正的 `MessageSourceMap` 注册只需一行改动，外加升级本来就要求的 event-schema 更新。持久化类型历史对已记录的 V3 状态保持绿色；编译器没有留下洞：`as unknown` 步骤在唯一一个调用点可见。

## 测试

聚焦的 automation 套件保持不变通过（prompt-action spec 断言发出的 source 对象），且 `pnpm run verify-persistence-changes` 与 `pnpm run verify-persistence-formats` 对已记录的历史保持绿色，证明该树没有引入任何未确认的持久化类型变更。
