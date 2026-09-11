# Agent Note: 9Router 动态模型同步 UI 与 Remote 方法

Status: implemented

[English](2026-09-04-9router-models-sync-ui-panel.md) | 中文

## 问题

9Router 多提供方路由器提供数百个模型和动态路由，其可用性随时间变化。虽然计划同步会定期更新 `settings.yaml`，但用户之前在 Settings Models GUI 中无法直接查看同步时效性、活跃模型数量、过期诊断，也无法直接触发立即手动同步。

## 决策

我们在 LLM 服务的 Remote 方法与设置模型 UI 之间引入了实时同步遥测与触发子系统：

1. **Host 端遥测与执行 Seam：**
   - `packages/llm/llm/src/router-sync.ts` 读取持久化同步状态文件 (`sync-9router-models-state.json`)，检测过期状态（> 24 小时），读取执行失败日志，并通过 `sync-9router-models.mjs` 执行立即同步。
   - 在 `LlmRuntime` 上扩展了 `@Remote` 方法 `routerSyncStatus` 与 `triggerRouterSync`，通过 `@deepseek-ai/dsh-llm/remote` 导出并在 `@deepseek-ai/dsh-api-remotes/client` 组装。
   - 增加类型化遥测结构 (`RouterSyncStatus`)。

2. **Client 端展示组件：**
   - 在 `packages/client/ui-settings-models/src/client/RouterSyncPanel.tsx` 中创建 `RouterSyncPanel`。
   - 渲染运行正常、待更新和失败状态徽标、活跃对话模型计数、上次同步时间戳、遥测徽章（视觉、推理、延迟）以及手动“立即同步”操作按钮。
   - 在编辑 `9router` 提供方时，通过 `ProviderEditor.tsx` 条件挂载此面板，调用 `operations.getRouterSyncStatus` 和 `operations.triggerRouterSync`。
   - 使用 `ModelsSection.module.css` 中的设计系统语义 Token 进行样式定义，并在 `locales.ts` 中配置 `en` 和 `zh` 词典。

## 考虑过的备选方案

- **在 Web 客户端内自动轮询：** 否决，以避免不必要的 RPC 开销；状态在加载时读取，并在用户触发时立即刷新。
- **仅使用通用发现按钮：** 否决，因为 9Router 需要自定义路由过滤与元数据投影，而非通用端点列表。

## 影响

用户可以直接在 UI 中检查 9Router 同步健康状态并触发模型列表刷新，无需离开 Harness 或操作系统任务计划程序。

## 验证

`packages/llm/llm/tests/router-sync.spec.ts` 中的单元测试验证了状态读取、过期检测与错误提取。`packages/client/ui-settings-models/tests/router-sync-panel.client.spec.tsx` 中的组件测试验证了徽标渲染、按钮状态流转和错误提示。代码检查与测试套件完全通过。
