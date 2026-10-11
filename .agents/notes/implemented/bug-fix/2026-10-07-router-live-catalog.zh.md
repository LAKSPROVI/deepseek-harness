# Agent Note: Scoped configuration supports router availability

Status: implemented

[English](2026-10-07-router-live-catalog.md) | 中文

## 问题

在继承配置组合后筛选 Settings 描述符，仍会处理无关组件。拒绝零模型的自定义路由无法表示完全撤回。

## 决策

限定读取在计算继承层和克隆独立值之前，将命名空间传给 ConfigEditor。完整读取仍列举全部唯一条目；缺失 ID 返回空数组。明确声明协议和端点的自定义路由允许零模型；内置目录提供方保留默认行为。

[运行时证据决策](../architecture/2026-10-11-router-runtime-evidence.zh.md)取代本记录先前的 Settings 发布和整周期租约策略。可用性现在使用独立快照、逐模型过期及临时故障期间有限保留有效证据。同步遵循已有路由协议；配置编辑仍检查修订号。

## 考虑过的替代方案

**仅筛选最终描述符。** 这会让无关继承和克隆工作留在读取路径中。

**写入已导入的旧设置文件。** 后续写入不一定触达活动 profile。配置变更需要当前 Settings 服务。

## 影响

真实 profile 回归测试验证继承一致、秘密脱敏、缺失 ID 和组合次数。这些测试证明限定读取契约，不证明实时续期延迟或上游工具行为。[使用说明](../../../../docs/user/router-live-catalog.zh.md)介绍当前可用性流程。
