---
description: "浏览器语音输入的 Host 端：解码一次 base64 上传，经接缝转写，并返回文本或稳定的失败。"
kind: "package-reference"
---

# @deepseek-ai/dsh-voice-input

[English](README.md) | 中文

## 概述

**`VoiceInputService`**（`ctx.voiceInput`）是某个浏览器功能的 Host 一端：它接收一次 base64 音频上传，解码后交由 [transcription 能力 seam](../transcription/README.zh.md) 转写，并返回转写文本或一个稳定的业务失败。

## 目录

- [概览](#overview)
- [Remote API（`ctx.remote.voiceInput`）](#remote-api-ctx-remote-voiceinput)
- [上传内容](#the-upload)
- [失败](#failures)
- [策略归属](#policy-ownership)
- [模型体验](#model-experience)
- [已知限制与暂缓事项](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="overview"></a>
## 概览

本包承担该能力的 Consumer 角色：

| 包 | 职责 |
|---|---|
| [`@deepseek-ai/dsh-transcription`](../transcription/README.zh.md) | Service Definition：服务、提供方注册表、选择策略、载荷上限、请求／结果词汇、`TranscriptionError` 分类体系 |
| [`@deepseek-ai/dsh-transcription-groq`](../transcription-groq/README.zh.md) | 提供方：Groq 的 OpenAI 兼容 Whisper 转写 API |
| `@deepseek-ai/dsh-voice-input`（本包） | 消费方：`voiceInput` Remote 命名空间、base64 解码，以及面向浏览器的失败 code |

音频只是临时数据：解码后的字节仅存活于一次调用期间，不进入任何会话事件与存储，返回结果后也不保留。

<a id="remote-api-ctx-remote-voiceinput"></a>
## Remote API（`ctx.remote.voiceInput`）

| 成员 | 语义 |
|---|---|
| `transcribe(request, signal?)` | 解码一次上传，并通过 `ctx.transcription` 转写。返回携带转写文本的 `{ ok: true, value }`，或携带单个失败 code 的 `{ ok: false, error }`。失败不是 `TranscriptionError` 时以 reject 结束。 |

`TypertRemoteService` 把该方法发布在命名空间 `voiceInput` 下，因此浏览器调用方以 `ctx.remote.voiceInput.transcribe(request)` 访问它。末尾可选的 `AbortSignal` 是该方法的取消参数：对支持取消的方法，Typert 网关会提供承载层的 signal，并转发给 `ctx.transcription.transcribe`，因此放弃请求的调用方会一并停止提供方调用。

预期失败是返回联合中的一个值；基础设施错误则原样重新抛出，因此提供方内部的缺陷表现为 reject，而不是变成浏览器会当作用户可见提示渲染的业务 code。

<a id="the-upload"></a>
## 上传内容

| 字段 | 含义 |
|---|---|
| `mediaType` | 录制方声明的容器格式，取自 seam 的封闭联合 `TranscriptionAudioFormat`：`audio/webm`、`audio/ogg`、`audio/wav`、`audio/mp4`、`audio/mpeg`。原样转发给 seam。 |
| `data` | 音频字节的规范 base64 编码：完整四元组，末尾最多两个填充字符。 |
| `language` | 可选提示，例如 `pt`。缺省或为空字符串时按「完全不带提示」发送，把检测交给提供方。 |

`data` 在解码前先按规范 base64 模式校验，因为 `Buffer.from(data, 'base64')` 会静默跳过字母表之外的每个字符：否则被损坏的上传会解码出看似合理的音频，再由提供方以含义不明的消息拒绝。未通过该模式的载荷绝不会到达 seam。

成功值携带 `text`，以及提供方报告了语言时的 `language`。两者都原样来自 seam 的 `TranscriptionResult`；静音时 `text` 为空字符串。完整的请求、值与失败声明见 [`src/types.ts`](src/types.ts)。

<a id="failures"></a>
## 失败

| `error.code` | 含义 |
|---|---|
| `audio-undecodable` | `data` 不是规范 base64。在此判定，且在派发任何提供方之前。 |
| `audio-empty` | 解码后的载荷不含任何音频字节，由 seam 报告为 `TRANSCRIPTION_AUDIO_EMPTY`。 |
| `audio-too-large` | 解码后的载荷超过 seam 的 `maxAudioBytes` 上限。携带 `actualBytes`，即本包测得的解码长度。 |
| `provider-unavailable` | seam 没有解析出可用提供方：不可用、已配置但未注册、已配置但不可用，或选择存在歧义。`detail` 指明失败在哪一步。 |
| `provider-unconfigured` | 提供方已注册但没有凭据，由 seam 报告为 `TRANSCRIPTION_CREDENTIAL_MISSING`。`detail` 指明缺失的凭据引用。 |
| `provider-failed` | 已联系到提供方，但它拒绝或未能完成转写。`detail` 转发提供方自己的消息。本包不识别的每个 `TranscriptionError` code 都归入此项，因为 seam 的 code 是可合并扩展的。 |
| `aborted` | 转写在产生文本之前被取消，由 seam 报告为 `TRANSCRIPTION_ABORTED`。 |

<a id="policy-ownership"></a>
## 策略归属

本包不持有任何转写策略：载荷上限、提供方选择与转写文本的空白裁剪都归 `ctx.transcription`，因此直接调用该 seam 的 headless 部署执行完全相同的规则。`audio-too-large` 是 seam 的上限失败投射到 wire 上的结果，并补上测得的字节长度，使调用方能报告自己实际发送的大小。

本包自己拥有的是：base64 编码校验、空提示的归一化、从 `TranscriptionError` code 到面向浏览器 code 的映射，以及「预期失败」与「重新抛出」之间的界限。

<a id="model-experience"></a>
## 模型体验

无，因为该服务只回应其调用方，不注册提示词、工具 schema 或会话事件；只有人类从输入框发送出去的转写文本才对模型可见，且经由本就会记录它的普通用户消息路径。

#### KV Cache 影响

与所有模型请求相互独立：本包不会把任何音频字节或转写 token 送入请求，因此既不构建也不会使可复用前缀失效。

## 已知限制与暂缓事项

<a id="known-limitations-and-deferred-work"></a>

- **音频以 base64 膨胀后传输**：Remote wire 是 JSON，因此一次上传的体积约为录制字节长度的 4/3，并在请求中被完整缓冲。既没有二进制或 multipart 通路，也没有分块上传。
- **没有流式或部分转写结果**：每次调用一段完整话语，与 seam 的单一操作一致。长录音在结束前不会产生任何反馈，也没有可渲染的进度或部分文本信号。
- **上限按解码后的字节执行**：base64 文本远大于 `maxAudioBytes` 的请求仍会先被解码，再由 seam 拒绝，因此超限上传会被完整传输并完整解码后才失败。
- **`detail` 把面向运维的文本带到浏览器**：`provider-unavailable`、`provider-unconfigured` 与 `provider-failed` 会转发 seam 或提供方自己的消息，其中包含凭据引用名称。部署方只应通过受信任或另行认证的边界暴露 Remote 网关。
- **一次调用不留持久记录**：本包不追加会话事件，因此失败、被取消或被丢弃的转写无法从会话数据重建；让转写文本对模型可见的消费方自行负责记录。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>

不发布运行时不变量伴生包：Remote 表面在调用之间不持有状态、也不发布事件——它解码一次上传，委托给 `ctx.transcription`，应答后不保留任何内容——因此没有可检查的事件或可变数据关系。
