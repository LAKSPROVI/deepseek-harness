---
description: "让自定义 Anthropic 网关的可选模型与经过认证的可用性目录保持一致。"
kind: "tutorial"
---

# 自动刷新路由器目录

[English](router-live-catalog.md) | 中文

本指南将已有的 `9router` 提供方连接到发布严格 `x_9r` 可用性证据的网关。运行前需要本地 Web Harness、启动日志以及由环境变量引用的凭据。提供方保留 `api: anthropic-messages` 和原有基础 URL。

## 启动同步

1. 在同步进程的环境中设置 `ROUTER_API_KEY`。不要将其值放入命令参数或配置示例。
2. 使用实际安装路径和提供方的准确基础 URL 运行脚本：

```sh
node scripts/sync-router-live-models.mjs --home /path/to/home --app-url http://127.0.0.1:3080/ --catalog-url https://gateway.example/v1 --launch-log /path/to/launch.log --watch --interval-ms 30000
```

3. 查看 `home/sync-9router-models-state.json`。确认成功的周期具有 `ok: true`、当前的 `synchronizedAt`、`validUntil` 和 `publishedChatModels`。将 Harness 设置中的完整模型 ID 集合与经过认证的目录投影进行比较。
4. 使用操作系统的登录调度器启动此命令。只保留一个监视进程。监视进程运行时，不加 `--watch` 的同一命令会请求立即执行一个周期。

## 理解可用性

脚本要求新的文本、工具调用、Anthropic 工具调用及 Anthropic 流式响应证据。它排除自动路由别名、过期证据、格式错误的列表、重复 ID 及未经证明的图像输入。有效的空结果或目录请求失败会撤回提供方的可选模型；后续成功周期会恢复模型。默认每 30 秒刷新一次；网关证据本身的有效期最长为十分钟。验证与实际请求之间仍可能发生可用性变化。

启动 Web Harness 时，将 `DSH_HOME` 设置为相同的目录。脚本为此目录启用原生可用性约束：即使同步停止，运行时也会撤回过期选项并拒绝新的调用。本地确认最长有效 60 秒；原生文件监视失败时，每 30 秒的通知检查负责恢复。变更通过检查修订号的 Settings 操作更新原生模型目录。脚本只修改 `providers.9router.models`，先创建并验证配置备份，并在撤回和恢复期间按准确 ID 保留模型选项。其他提供方、凭据、历史和现有会话的模型选择保持不变。已选模型消失后会变为不可用；脚本不会悄悄为该会话切换模型。

## 恢复同步

状态文件报告经过清理的错误码。`app_unavailable` 表示本地 Harness 无法接受更新；监视进程会重试。协议或端点不匹配会阻止写入该提供方。仅使用 `home/backups/router-live-catalog` 中经过验证的备份，通过相同的 Settings 流程恢复配置。后端重启需要新的启动令牌；同步器会自动将它换成本地会话 Cookie。

[适配器参考](../../packages/llm/llm-pi-ai/README.zh.md) 描述自定义路由，[决策记录](../../.agents/notes/implemented/bug-fix/2026-10-07-router-live-catalog.zh.md) 解释可用性契约。
