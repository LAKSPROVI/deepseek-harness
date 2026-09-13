---
description: "定义转写能力接缝：provider 注册表、选择策略、载荷上限与共享错误分类。"
kind: "package-reference"
---

# @deepseek-ai/dsh-transcription

[English](README.md) | 中文

## 概述

**`TranscriptionRuntime`**（`ctx.transcription`）定义 harness 具备哪种语音转文字能力（把一段完整的录音话语转成文本），并通过多个提供方实现，不把调用方绑定到某个厂商的 API 形状。

## 目录

- [概览](#overview)
- [服务 API（`ctx.transcription`）](#service-api-ctx-transcription)
- [配置](#config)
- [选择](#selection)
- [词汇](#vocabulary)
- [模型体验](#model-experience)
- [已知限制与暂缓事项](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="overview"></a>
## 概览

本包承担 transcription 能力的 Service Definition 角色。它在一个 seam 上只承载一种操作，但该操作可能有多个提供方：

| 包 | 职责 |
|---|---|
| `@deepseek-ai/dsh-transcription`（本包） | Service Definition：服务、提供方注册表、选择策略、载荷上限、请求／结果词汇、`TranscriptionError` 分类体系 |
| [`@deepseek-ai/dsh-transcription-groq`](../transcription-groq/README.zh.md) | 提供方：Groq 的 OpenAI 兼容 Whisper 转写 API |

音频在这里只是临时数据：seam 把编码后的字节交给选中的提供方，并返回文本。它不追加会话事件，因此载荷不会成为持久会话数据。

<a id="service-api-ctx-transcription"></a>
## 服务 API（`ctx.transcription`）

| 成员 | 语义 |
|---|---|
| `registerProvider(provider)` | 注册语音转文字后端。id 重复时抛出 `TranscriptionError` `TRANSCRIPTION_DUPLICATE_PROVIDER`。返回 disposer。随调用 fiber 一并 dispose（资源释放）。 |
| `transcribe(request, signal?)` | 强制执行载荷上限，解析提供方，并通过它转写一段话语。返回去除首尾空白的转写文本。能力无法运行时抛出 `TranscriptionError`。 |

`transcribe()` 会把空载荷拒绝为 `TRANSCRIPTION_AUDIO_EMPTY`，把超过 `maxAudioBytes` 的载荷拒绝为 `TRANSCRIPTION_AUDIO_TOO_LARGE`，两者都发生在派发任何提供方之前：只有这个面向调用方的入口知道完整载荷。提供方自身的失败原样向上传播，因此提供方特有的 code 会以抛出的原样到达调用方。

提供方注册的是**能力**而非工具。本包不注册任何面向模型的名称、描述、提示词文本或 JSON Schema。

<a id="config"></a>
## 配置

| 配置键 | 默认值 | 含义 |
|---|---|---|
| `provider` | 未设置 | 在选择中优先生效的显式提供方 id。缺省时，若只注册了一个可用提供方则自动选择。 |
| `maxAudioBytes` | `26214400`（25 MiB） | 单次请求音频字节数的正整数上限，在派发前强制执行。`DEFAULT_MAX_AUDIO_BYTES` 常量取该 seam 所面向的语音 API 中最小的单请求上传上限；接入其他后端的部署应设置该键，而不是沿用它。 |

<a id="selection"></a>
## 选择

选择绝不依赖注册、配置或 HMR（热模块替换）顺序。能力要么具有显式提供方 id（配置 `provider`），要么在恰好只注册一个可用提供方时自动选择。`transcribe()` 会在载荷检查之后、于执行时解析提供方：

| 情况 | 执行 |
|---|---|
| 已配置 id 已注册且 `available()` | 运行该提供方 |
| 已配置 id 未注册 | `TRANSCRIPTION_PROVIDER_CONFIGURED_MISSING` |
| 已配置 id 已注册但不可用 | `TRANSCRIPTION_PROVIDER_CONFIGURED_UNAVAILABLE` |
| 无 id，恰好一个已注册的可用提供方 | 运行该提供方 |
| 无 id，没有可用提供方 | `TRANSCRIPTION_PROVIDER_UNAVAILABLE` |
| 无 id，多个可用提供方 | `TRANSCRIPTION_PROVIDER_AMBIGUOUS` |

失败分支会抛出 `TranscriptionError`；调用方按其结构化 code（加消息细节：缺失 id、歧义候选集合）路由。提供方的 `available()` 是便宜的局部检查（凭据是否存在、配置是否可解析），供执行时解析使用，且**禁止发起网络调用**。

<a id="vocabulary"></a>
## 词汇

`TranscriptionRequest`（`audio`、`format`、`language?`）→ `TranscriptionResult`（`text`、`language?`）；取消作为可选的直接 `AbortSignal` 参数传给 `transcribe()`。`audio` 是完整的编码载荷而非流，因为对它设限需要知道其完整大小；`language` 是 BCP-47 或 ISO-639-1 提示，缺省即请求提供方自行检测。音频不含语音时 `text` 为空字符串；结果中的 `language` 只在提供方报告其检测到或采用的语言时出现——seam 绝不把请求中的提示原样回显，因此调用方可以区分「检测」与「假定」。`TranscriptionAudioFormat` 是这里拥有的封闭联合（`audio/webm` | `audio/ogg` | `audio/wav` | `audio/mp4` | `audio/mpeg`）：提供方使用 `switch` 实现穷尽检查，因此新增格式会导致它们编译失败，直到各自声明真实支持。完整约定见 `src/types.ts`，其中也包含 `TranscriptionError` code 分类体系。

<a id="model-experience"></a>
## 模型体验

无，因为该 seam 只把转写文本返回给调用方，自身不注册提示词、工具 schema 或会话事件。

#### KV Cache 影响

与所有模型请求相互独立：本包不会把任何音频字节或转写 token 送入请求，因此既不构建也不会使可复用前缀失效。

## 已知限制与暂缓事项

<a id="known-limitations-and-deferred-work"></a>

- **没有流式或部分转写结果**：该 seam 每次调用转写一段完整话语，且 `TranscriptionRequest.audio` 是整个编码载荷，因为派发前的上限检查需要其完整大小。实时字幕需要另一种操作，并带有自己的结果与取消语义。
- **没有提供方可用性查询**：可用性只能通过调用 `transcribe()` 并按抛出的 `TranscriptionError` code 路由来观测；无提供方失败是通用的 `TRANSCRIPTION_PROVIDER_UNAVAILABLE`，不会枚举逐提供方原因，也没有提供方变更事件。
- **一次转写不留持久记录**：音频与转写文本都不进入会话日志，因此无法从持久会话数据重建一次调用；让转写文本对模型可见的消费方自行负责记录。
- **`TranscriptionResult` 只携带 `text` 与 `language`**：没有分段、逐词时间戳、置信度或说话人标签，因此提供方返回这些内容时无处安放。
- **`TranscriptionRequest` 只携带一个语言提示**：提供方无关的控制项（词表或提示词偏置、时间戳粒度、说话人分离）暂缓至有多个提供方都能诚实支持时。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>

不发布运行时不变量伴生包：提供方映射是私有的，负载上限与选择规则按每次调用强制执行；接缝不发布注册表观察流，也不追加会话事件，因此没有可检查的事件/数据关系。
