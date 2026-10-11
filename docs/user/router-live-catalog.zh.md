---
description: "让自定义网关的可选模型与经过认证的可用性目录保持一致。"
kind: "tutorial"
---

# 自动刷新路由器目录

[English](router-live-catalog.md) | 中文

本指南将已有的 `9router` 提供方连接到发布严格 `x_9r` 可用性证据的网关。运行前需要本地 Web Harness、启动日志以及由环境变量引用的凭据。提供方保留原有基础 URL，以及 `api: anthropic-messages` 或 `api: openai-completions`。同步器遵循已配置协议，不会自行切换协议。

## 启动同步

1. 在同步进程的环境中设置 `ROUTER_API_KEY`。不要将其值放入命令参数或配置示例。
2. 使用实际安装路径和提供方的准确基础 URL 运行脚本：

```sh
node scripts/sync-router-live-models.mjs --home /path/to/home --app-url http://127.0.0.1:3080/ --catalog-url https://gateway.example/v1 --launch-log /path/to/launch.log --watch --interval-ms 30000
```

3. 查看 `home/sync-9router-models-state.json`。确认成功的周期具有 `ok: true`、当前的 `synchronizedAt`、`validUntil` 和 `publishedChatModels`。将原生模型选择器中的完整模型 ID 集合与经过认证的目录投影进行比较。
4. 使用操作系统的登录调度器启动此命令。只保留一个监视进程。监视进程运行时，不加 `--watch` 的同一命令会请求立即执行一个周期。

## 理解可用性

脚本要求已配置协议的新鲜文本、工具和流式证据。它排除别名、重复 ID、格式错误的证据、过期路由以及未经证明的图像输入。schema-2 运行时快照保留每个模型原始的 `checked_at` 和 `expires_at`，最长十分钟。已确认的移除或负面证据会撤回模型；旧证据不能恢复模型。验证与实际请求之间仍可能发生可用性变化。

启动 Web Harness 时，将 `DSH_HOME` 设置为相同的目录。同步器发布运行时快照，不修改持久化 Settings，也不重新加载其组件。pi-ai 适配器将快照合入原生模型目录，并保留准确 ID 对应的选项和已配置容量限制。其他提供方、凭据、历史、默认值和会话选择保持不变。每个模型独立过期；文件通知和每 30 秒的后备检查刷新目录。旧快照保留原有 60 秒确认期限。

可选目录还会检查部署的工具展示方式。路由器 `gh/gpt*` 路由最多接受 128 个原生工具 schema；更大的工具集会将其从默认选择器排除，但不会移除任何已配置 MCP 或原生工具。状态标记统计该默认上下文中可用的模型。显式选择 PTC 的会话可以使用只含一个 `run_code` schema 的作用域目录。每次实际调用都会检查完整投影工具集，因此手动选择和已准备调用也不能绕过限制。工具计数拒绝会指出模型、128-schema 限制和请求计数。

## 恢复同步

状态文件报告经过清理的故障、协议、尝试次数和 `transport`。该文件属于私有运行时数据：其中的凭据指纹将快照绑定到实际调用凭据。URL、协议、凭据引用或凭据值改变后，需要匹配的证据。后端重启后，同步器从启动日志获取新的本地认证 Cookie。

本地认证和 Settings 读取有 30 秒期限；外部目录请求有八秒期限，临时故障重试一次。两次临时故障后，`transport: degraded` 仅保留仍有效的单个证明，不改变其过期时间。无效响应和认证失败会撤回选项。监视器从周期开始计算每 30 秒重试；`--app-timeout-ms` 接受不超过 30000 的正整数，绝不延长证据。

调用前，已过期的已知模型可以请求一次更新，最多等待 20 秒，并支持取消。没有新鲜证据时，调用以 `ROUTER_MODEL_UNAVAILABLE` 失败。已完成的工具结果保留在会话历史中，恢复后可以通过后续消息继续使用；更新不会再次执行工具或悄悄选择其他模型。已经发送的流保持原有调用。

[适配器参考](../../packages/llm/llm-pi-ai/README.zh.md) 描述自定义路由，[决策记录](../../.agents/notes/implemented/bug-fix/2026-10-07-router-live-catalog.zh.md) 解释可用性契约。
