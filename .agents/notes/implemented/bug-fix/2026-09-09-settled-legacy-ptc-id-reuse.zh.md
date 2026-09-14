# Agent Note: 已结算历史 PTC 标识复用

Status: implemented

[English](2026-09-09-settled-legacy-ptc-id-reuse.md) | 中文

## 问题

已发布的 V0 历史可以在此前 dispatch 已结算后复用 `tool/code-dispatch` 的 `subCallId`。原关系校验器会永久保留每一个完成的 start，因此将后来的完整配对视为重复。这会让完整的历史对话被迁移拒绝，尽管两次执行并不重叠。

## 决策

V0 到 V1 的关系校验器只保留 PTC start 到匹配的 `tool/code-dispatch` 到达为止。随后它删除活动 start，但保留 child 到 root 的祖先记录。后续 start 只能在同一 root 下复用该标识；并发重复仍会失败，没有活动 start 的 dispatch 仍会失败，改变 root 仍会失败。

## 曾考虑的替代方案

**永久保留每个完成的 start。** 已否决，因为持久 V0 表示会在完成后复用标识，永久保留会把完成的生命周期误认为活动生命周期。

**随完成的 start 一起忘记 child root。** 已否决，因为后续嵌套 PTC 祖先关系仍需要 root 映射来拒绝改变的 root 或无关 parent。

**接纳每个重复的 start。** 已否决，因为两个未结算的同标识 start 无法与后来的 dispatch 进行无歧义配对。

## 后果

完成的历史 PTC 配对可以重复出现，而无需重写源工件。关系覆盖保留了对并发重复的拒绝，并证明在原 root 下结算后的复用。迁移仍会拒绝不匹配的 start/dispatch payload、缺失 start、改变 root 和无效 parent 祖先关系。
