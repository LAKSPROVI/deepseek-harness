---
description: "转写接缝的 Groq Whisper provider，按次解析凭据。"
kind: "package-reference"
---

# @deepseek-ai/dsh-transcription-groq

[English](README.md) | 中文

## 概述

由 [Groq](https://groq.com) 支持的 `TranscriptionProvider`，用于 harness [transcription 能力 seam](../transcription/README.zh.md)（`ctx.transcription`）。它调用 Groq 的 **OpenAI 兼容转写 API**（`POST {baseURL}/audio/transcriptions`，`multipart/form-data`），使用 Whisper 模型，并把 Groq 返回的 `verbose_json` 响应体映射为 seam 规范化的 `TranscriptionResult`。

## 目录

- [概览](#overview)
- [配置](#config)
- [请求](#the-request)
- [映射](#mapping)
- [按次解析的凭据与设置](#credentials-and-settings-per-call)
- [模型体验](#model-experience)
- [已知限制与暂缓事项](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="overview"></a>
## 概览

这是一个**实现**包：它向 `ctx.transcription` 注册提供方，通过可选的 `ctx.credentials` seam 为每次转写解析凭据，且不注册面向模型的工具。它是函数／命名空间插件（`inject: ['transcription']`）。multipart 协议格式（wire format）与原生 `fetch` 客户端是提供方私有细节，并**不**使该提供方依赖 `ctx.llm`。

已挂载的凭据服务具有权威性；没有该服务时，启动进程的环境变量就是全部凭据来源。每次转写都会解析该引用，因此启动后存储或轮换的密钥无需重启，即可用于下一次调用。

<a id="config"></a>
## 配置

| 配置键 | 默认值 | 含义 |
|---|---|---|
| `apiKey` | 未设置 | Groq API 密钥字面值。优先使用 `apiKeyEnv`，避免密钥进入配置；非空字面值优先于解析器。 |
| `apiKeyEnv` | `GROQ_API_KEY` | 每次转写都会通过 `ctx.credentials` 解析该凭据引用；没有该 seam 时则从启动环境解析。值缺失时，调用以 `TRANSCRIPTION_CREDENTIAL_MISSING` 失败，其消息会指出该引用。 |
| `baseURL` | `https://api.groq.com/openai/v1` | OpenAI 兼容端点基址；追加 `/audio/transcriptions`。缺省时回退到启动环境中的 `$GROQ_BASE_URL`。Groq 的 OpenAI 兼容接口位于 `/openai/v1` 而非 `/v1`，因此仅填主机名会让每个请求都返回 404。无法解析时提供方不可用。 |
| `model` | `whisper-large-v3-turbo` | Groq 转写模型名称。`whisper-large-v3-turbo` 是成本／延迟取向的选择；非 turbo 的 `whisper-large-v3` 以吞吐换取边际精度提升。值为空时提供方不可用。 |
| `defaultLanguage` | 未设置 | 请求未携带语言提示时发送的提示值，例如 `pt`。请求自带的 `language` 优先。缺省则交由 Groq 检测，这会降低短话语的准确率。 |

```yaml
- id: transcription-groq
  name: '@deepseek-ai/dsh-transcription-groq'
  config:
    apiKeyEnv: GROQ_API_KEY
    model: whisper-large-v3
```

上面的条目是 `transcription-groq` Settings 段的 base 层：叠加其上的用户层会作用于**下一次**转写，因为提供方是按次投影该段，而不是在注册时固化它。因此端点或模型变化时，seam 的提供方选择不会闪断。`apiKey` 带有 `role('secret')`，所以它在任何一层都不会出现在 `describe()` 响应中。

<a id="the-request"></a>
## 请求

每次转写发送一个 multipart 请求体：`file` 部分携带请求的音频，命名为 `utterance.<ext>`，类型取请求的格式（`webm`、`ogg`、`wav`、`mp4`，`audio/mpeg` 对应 `mp3`），同时携带 `model`、`response_format=verbose_json`，以及存在提示时的 `language`。标头携带 bearer 密钥、`accept: application/json` 和 harness 的 user agent。HTTP 重定向会在接触 `Location` 目标前被拒绝，并以 `TRANSCRIPTION_PROVIDER_ERROR` 呈现。

`available()` 是不发起网络调用的局部检查：存在字面密钥或凭据解析器、`baseURL` 可解析、`model` 非空。

<a id="mapping"></a>
## 映射

`text` ← `text`；Groq 报告非空语言时 `language` ← `language`。不含 `text` 成员的响应体属于无法处理，而不是空转写文本——静音会返回空字符串，因此成员缺失意味着协议格式已变更——并变为 `TRANSCRIPTION_PROVIDER_ERROR`。

非 2xx 响应变为 `TRANSCRIPTION_PROVIDER_ERROR`，并携带 Groq 自身的细节，取自 `error.message`、字符串形式的 `error` 或顶层 `message`；错误响应体非 JSON 或不含细节时保留 `Groq API error (HTTP <status>)`。429 限流使用同一 code，便于调用方统一路由，区别由消息承载。传输失败、凭据解析失败和无法处理的成功响应体使用相同 code；凭据缺失为 `TRANSCRIPTION_CREDENTIAL_MISSING`；调用方取消（包括凭据解析或响应体解析期间的中止）为 `TRANSCRIPTION_ABORTED`。

<a id="credentials-and-settings-per-call"></a>
## 按次解析的凭据与设置

一次转写在入口处一次性快照其选项，因此在等待凭据解析期间落地的设置写入，不会把从旧段解析出的密钥发送到新段所指定的端点。提供方不会在两次调用之间保留密钥。

<a id="model-experience"></a>
## 模型体验

无，因为该提供方只通过 `ctx.transcription` 把转写文本返回给调用方，不注册提示词、工具 schema 或会话事件。

#### KV Cache 影响

与所有会话请求相互独立：Groq 转写调用是独立的 HTTP 请求，不会向模型请求贡献 token，因此既不构建也不会使可复用前缀失效。

## 已知限制与暂缓事项

<a id="known-limitations-and-deferred-work"></a>

- **仓库中不存在本地或离线提供方**：无法通过网络访问 Groq 的部署完全没有转写后端，因此 `ctx.transcription` 会解析为 `TRANSCRIPTION_PROVIDER_UNAVAILABLE`，并且每段话语都会离开本机。
- **动态凭据的可用性在操作内部解析**：同步的 `available()` 约定可以确认解析器存在，但无法查询异步凭据存储。因此，选中的无密钥提供方会使转写以 `TRANSCRIPTION_CREDENTIAL_MISSING` 失败。调用方取消在本地与该预检存在竞态，但无法强制任意凭据后端自行停止工作。
- **`verbose_json` 中 `text` 与 `language` 以外的细节会被丢弃**：分段与时间戳在 `TranscriptionResult` 中无处安放，因此请求详细响应体只换来所报告的语言。
- **未建模 Groq 自身的上传上限**：seam 的 `maxAudioBytes` 是本地上限；未超过它但被 Groq 拒绝的载荷会在派发后以 `TRANSCRIPTION_PROVIDER_ERROR` 失败，并携带 Groq 的消息。
- **一次转写尝试不留持久记录**：该提供方不追加会话事件，因此失败或被取消的 Groq 调用无法从会话数据重建。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>

不发布运行时不变量伴生包：提供方在调用之间不持有状态——每次转写投影一次自己的设置段，不保留凭据——因此没有可检查的事件或可变数据关系。
