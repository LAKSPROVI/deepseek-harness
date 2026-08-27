# 语音转写

[English](transcription.md) | 中文

[`@deepseek-ai/dsh-transcription`](../../packages/transcription/transcription)定义转写能力 seam（`ctx.transcription`）：提供方注册、执行期提供方选择、音频字节上限和转写文本裁剪。[`@deepseek-ai/dsh-transcription-groq`](../../packages/transcription/transcription-groq)在其上注册由 Groq 支撑的提供方，[`@deepseek-ai/dsh-voice-input`](../../packages/transcription/voice-input)则把一次转写调用作为 `voiceInput` Typert Remote 命名空间发布给浏览器。

音频在整个 seam 中都是临时数据。字节仅在一次调用期间存在，且不会在任何位置成为持久数据：没有 session 事件、没有日志行、没有缓存、没有 spill 文件，也没有回显该载荷的诊断信息。只有转写文本会成为模型可见内容，且仅当人类发送写入了该文本的输入框草稿之后——这条路径由既有的用户消息流程负责记录。

来源：[`packages/transcription/transcription/src/types.ts`](../../packages/transcription/transcription/src/types.ts)

## 公开类型

```ts type-equiv
/**
 * Container formats the seam accepts. A CLOSED union owned by `dsh-transcription`:
 * providers `switch` to exhaustiveness, so adding a format breaks compilation at
 * every provider until it declares real support. Browser capture produces
 * `audio/webm` or `audio/mp4` depending on the engine; the WAV and MPEG arms serve
 * file-backed callers.
 */
type TranscriptionAudioFormat =
  | 'audio/webm'
  | 'audio/ogg'
  | 'audio/wav'
  | 'audio/mp4'
  | 'audio/mpeg'
```

```ts type-equiv
/**
 * One utterance to transcribe. `audio` is the complete encoded payload, not a
 * stream: the seam bounds it before dispatch, which requires knowing its full
 * size. `language` is a BCP-47 or ISO-639-1 hint; omitting it asks the provider
 * to detect, which costs accuracy on short utterances.
 */
interface TranscriptionRequest {
  /** Complete encoded audio payload. */
  readonly audio: Uint8Array
  /** Container format of {@link TranscriptionRequest.audio}. */
  readonly format: TranscriptionAudioFormat
  /** Language hint, e.g. `pt`; omitted = provider detects. */
  readonly language?: string
}
```

```ts type-equiv
/**
 * Normalized transcription outcome. `text` is the transcript with surrounding
 * whitespace already trimmed by the seam. `language` is present only when the
 * provider reports what it detected or honored — the seam never echoes the
 * request hint back, so a caller can distinguish detection from assumption.
 */
interface TranscriptionResult {
  /** The transcript. Empty string when the audio carried no speech. */
  readonly text: string
  /** Language the provider reports for the audio, when it reports one. */
  readonly language?: string
}
```

```ts type-equiv
/**
 * A speech-to-text backend. Registered with `ctx.transcription.registerProvider`.
 * `id` is a stable string, unique within the seam.
 */
interface TranscriptionProvider {
  readonly id: string
  /** Cheap local usability check; must not make network calls. */
  available(): boolean
  /** Transcribe one utterance; honor `signal` for cancellation. */
  transcribe(request: TranscriptionRequest, signal?: AbortSignal): Promise<TranscriptionResult>
}
```

```ts type-equiv
/**
 * Config for the transcription seam. `provider` pins which backend wins; omitted,
 * a single registered usable provider auto-selects. `maxAudioBytes` is the
 * payload ceiling enforced before dispatch.
 */
interface TranscriptionRuntimeConfig {
  /** Explicit provider id. Omitted = auto-select when exactly one usable. */
  readonly provider?: string
  /** Positive-integer ceiling on one request's audio bytes. */
  readonly maxAudioBytes?: number
}
```

## 语音输入类型

来源：[`packages/transcription/voice-input/src/types.ts`](../../packages/transcription/voice-input/src/types.ts)

```ts type-equiv
/** One recorded utterance uploaded for transcription. */
interface VoiceInputTranscribeRequest {
  /** Container format of the recorded bytes, as the recorder declared it. */
  readonly mediaType: TranscriptionAudioFormat
  /** Canonical base64 encoding of the audio bytes; the Host verifies the encoding. */
  readonly data: string
  /** Optional language hint, e.g. `pt`; absent leaves detection to the provider. */
  readonly language?: string
}
```

```ts type-equiv
/** The transcript of one accepted utterance. */
interface VoiceInputTranscribeValue {
  /** Transcribed text, already trimmed by the transcription seam; empty for silence. */
  readonly text: string
  /** Language the provider reported, when it reported one. */
  readonly language?: string
}
```

```ts type-equiv
/** The upload carried no audio byte. */
interface VoiceInputAudioEmpty {
  readonly code: 'audio-empty'
}
```

```ts type-equiv
/** The upload is not canonical base64, so no audio can be recovered from it. */
interface VoiceInputAudioUndecodable {
  readonly code: 'audio-undecodable'
}
```

```ts type-equiv
/** The decoded audio exceeds the transcription seam's configured ceiling. */
interface VoiceInputAudioTooLarge {
  readonly code: 'audio-too-large'
  /** Decoded byte length the Host measured. */
  readonly actualBytes: number
}
```

```ts type-equiv
/** No transcription provider is currently usable in this deployment. */
interface VoiceInputProviderUnavailable {
  readonly code: 'provider-unavailable'
  /** Operator-facing detail naming which selection step failed. */
  readonly detail: string
}
```

```ts type-equiv
/** A provider is registered but holds no credential to authenticate with. */
interface VoiceInputProviderUnconfigured {
  readonly code: 'provider-unconfigured'
  /** Operator-facing detail naming the missing credential reference. */
  readonly detail: string
}
```

```ts type-equiv
/** The provider was reached and refused or failed the transcription. */
interface VoiceInputProviderFailed {
  readonly code: 'provider-failed'
  /** The provider's own message, forwarded verbatim for display. */
  readonly detail: string
}
```

```ts type-equiv
/** The caller cancelled before a transcript existed. */
interface VoiceInputAborted {
  readonly code: 'aborted'
}
```

```ts type-equiv
/** Failures the public voice-input operation can report. */
type VoiceInputFailure =
  | VoiceInputAudioEmpty
  | VoiceInputAudioUndecodable
  | VoiceInputAudioTooLarge
  | VoiceInputProviderUnavailable
  | VoiceInputProviderUnconfigured
  | VoiceInputProviderFailed
  | VoiceInputAborted
```

```ts type-equiv
/** Successful public operation result. */
interface VoiceInputSuccess<T> {
  readonly ok: true
  readonly value: T
}
```

```ts type-equiv
/** Rejected public operation result with a stable business failure. */
interface VoiceInputRejected<E extends VoiceInputFailure> {
  readonly ok: false
  readonly error: E
}
```

```ts type-equiv
/** Result returned by the voice-input `transcribe` operation. */
type VoiceInputTranscribeResult =
  | VoiceInputSuccess<VoiceInputTranscribeValue>
  | VoiceInputRejected<VoiceInputFailure>
```

## 提供方选择与载荷上限

seam 拥有全部转写策略：音频字节上限、提供方选择和转写文本裁剪。消费方只添加自身传输层强制要求的部分，因此无界面部署与浏览器不会在任何一方都不持有的上限上产生分歧。

选择在执行期解析，且从不依赖注册顺序：配置的 `provider` id 必须既已注册又满足 `available()`，未配置 id 时要求恰好存在一个可用提供方。下方的 Cordis API 小节逐一列出每种情况的结果。

`maxAudioBytes` 默认为 25 MiB（`26214400`），即本 seam 所面向的各语音 API 中已记载的最小单请求上传上限。它在派发任何提供方之前按解码后的字节长度检查，因此超限上传永远不会抵达网络；空载荷在同一位置被拒绝。两个载荷失败为 `TRANSCRIPTION_AUDIO_TOO_LARGE` 和 `TRANSCRIPTION_AUDIO_EMPTY`。

`TranscriptionError extends HarnessError`，其 `code` 为开放字符串，因此提供方可以不修改 `dsh-transcription` 就抛出自有 code，而消费方必须容忍无法识别的 code。Groq 提供方另外抛出 `TRANSCRIPTION_CREDENTIAL_MISSING`、`TRANSCRIPTION_PROVIDER_ERROR` 和 `TRANSCRIPTION_ABORTED`。

提供方的 `available()` 是廉价的本地检查——凭据是否存在、端点能否解析、模型名是否非空——不发起网络调用。因此本 seam 没有健康信号：已配置但不可达的端点只会表现为一次失败的转写。

## voiceInput Remote 约定

Typert RPC 线路只承载 JSON，没有二进制通道，因此音频以 base64 编码置于普通请求内跨越该线路，带来 4/3 膨胀。在默认上限下，300 MiB 的默认请求体预算可以吸收该膨胀。

Host 在解码前先按规范 base64 模式校验上传内容。`Buffer.from` 会静默跳过字母表之外的字符，因此未经校验的损坏上传会解码成看似合理的音频，并在提供方内部深处以含义不明的消息失败。

`transcribe` 回答由七个 code 组成的封闭业务联合类型，每个都是用户可据以行动的结果。基础设施故障被原样重抛而不做映射，因为它是缺陷而非结果。`audio-undecodable` 在抵达 seam 之前抛出；其余 code 投影 seam 的失败：

| 转写错误 code | 线路失败 |
|---|---|
| `TRANSCRIPTION_AUDIO_EMPTY` | `audio-empty` |
| `TRANSCRIPTION_AUDIO_TOO_LARGE` | `audio-too-large`，携带解码后的 `actualBytes` |
| `TRANSCRIPTION_ABORTED` | `aborted` |
| `TRANSCRIPTION_CREDENTIAL_MISSING` | `provider-unconfigured` |
| 四个提供方选择 code | `provider-unavailable` |
| 其他任意 code | `provider-failed`，携带提供方的消息 |

最后一行正是让 seam 可合并扩展的 code 集合在提供方抛出本消费方未知的 code 时，不会作为基础设施异常逃逸的原因。

## 提供方

[`@deepseek-ai/dsh-transcription-groq`](../../packages/transcription/transcription-groq)以 `multipart/form-data` 和 `response_format=verbose_json` 调用 Groq 的 OpenAI 兼容 `POST {baseURL}/audio/transcriptions`。模型默认为 `whisper-large-v3-turbo`，端点基址默认为 `https://api.groq.com/openai/v1`，其中包含 Groq 用于承载该接口的 `/openai/v1` 前缀。线路格式及其原生 `fetch` 客户端为提供方私有；该提供方不使用 `ctx.llm`。

凭据经由可选的 `ctx.credentials` seam 按每次转写解析，并回退到启动环境，因此启动后存入或轮换的密钥无需重启即可用于下一次调用。选项在每次操作入口处快照一次，因此一次转写绝不会把从某个 settings section 解析出的密钥发往另一个 section 指定的端点。

请求设置 `redirect: 'error'`。携带凭据的请求若跟随重定向，就会把音频交给响应指定的任意 origin，而这里的音频是某个人的录音。Node 的 `fetch` 会在跨 origin 时剥离 `authorization`，但仍转发请求体，因此泄漏的正是该载荷。本家族中每个携带凭据的提供方都采用同一策略。

## Web 界面

[`@deepseek-ai/dsh-client-ui-voice-input`](../../packages/client/ui-voice-input)是浏览器侧消费方：位于 `conversation.input.left` slot 的按住说话控件。它只负责展示，不注册任何 Cordis 服务，并通过已挂载的生成贡献调用 `ctx.remote.voiceInput`。

浏览器以 0x8000 字节分块编码录音，因为把音频大小的缓冲区展开传入 `String.fromCharCode` 会超出参数数量上限。它读取两层信封：生成的 Remote 面为每次调用包裹的承载层 `RemoteResult`，以及其中的业务联合类型。转写文本落入输入框草稿，由人类发送。

## 边界与限制

- 没有流式转写。一次调用承载一段完整语音，因此长录音在结束前不会产出任何部分文本；中间结果需要 RPC 层尚不具备的流式 Remote 操作。
- 不声明所说语言。seam 接受语言提示而浏览器不发送，因为 UI 区域设置不能作为说话者所用语言的证据；由提供方自动检测。
- 提高 `maxAudioBytes` 的部署必须确认其请求体预算仍能覆盖 base64 膨胀后的上传，否则请求会在抵达 seam 之前被拒绝。
- ACP 保持无音频：它拒绝音频提示内容，并声明 `promptCapabilities.audio: false`。
- 音频永不可回放。没有日志、附件或缓存保留录音，因此转写错误可以在草稿中修正，但无法由原始语音重新推导。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxtranscription--transcriptionruntime"></a>

### `ctx.transcription` — `TranscriptionRuntime`

The transcription service. Registered as `ctx.transcription` (one instance per context).

Selection semantics (resolved at execution time, never order-dependent):

- A configured id that is registered and `available()` → that provider.
- A configured id not registered → `TRANSCRIPTION_PROVIDER_CONFIGURED_MISSING`.
- A configured id registered but unavailable → `TRANSCRIPTION_PROVIDER_CONFIGURED_UNAVAILABLE`.
- No id configured, exactly one registered usable provider → that provider.
- No id configured, multiple usable providers → `TRANSCRIPTION_PROVIDER_AMBIGUOUS`.
- No id configured, no usable provider → `TRANSCRIPTION_PROVIDER_UNAVAILABLE`.

```ts cordis-catalog
/**
 * Register a speech-to-text provider. Throws {@link TranscriptionError}
 * `TRANSCRIPTION_DUPLICATE_PROVIDER` if its id is already registered. Returns a
 * disposer; disposed with the calling fiber.
 * @param provider - the provider; its `id` is the registry key.
 * @returns the disposer that unregisters the provider.
 */
registerProvider(provider: TranscriptionProvider): () => void

/**
 * Transcribe one utterance through the selected provider. Enforces the payload
 * bound and rejects an empty payload before dispatch, resolves the provider
 * with the selection rules above, and trims the returned transcript. Throws
 * {@link TranscriptionError} when the capability cannot run.
 * @param request - the audio payload, its format, and an optional language hint.
 * @param signal - optional cancellation signal forwarded to the provider.
 * @returns the transcript, with surrounding whitespace removed.
 */
async transcribe(request: TranscriptionRequest, signal?: AbortSignal): Promise<TranscriptionResult>
```

Source: [`packages/transcription/transcription/src/index.ts`](../../packages/transcription/transcription/src/index.ts)

<a id="ctxvoiceinput--voiceinputservice"></a>

### `ctx.voiceInput` — `VoiceInputService`

The Remote namespace one browser recording reaches. It owns no transcription policy of its own: the ceiling, provider selection, and trimming all belong to `ctx.transcription`, so a headless deployment enforces the same rules.

```ts cordis-catalog
/**
 * Transcribe one uploaded utterance.
 * @param request - the recorded audio, its declared container format, and an optional language hint.
 * @param signal - abort signal cancelling the upload's transcription.
 * @returns the transcript, or a stable business failure.
 */
@Remote('transcribe') async transcribe( request: VoiceInputTranscribeRequest, signal?: AbortSignal, ): Promise<VoiceInputTranscribeResult>
```

Source: [`packages/transcription/voice-input/src/index.ts`](../../packages/transcription/voice-input/src/index.ts)
<!-- END GENERATED cordis-surface -->
