# 转写与语音输入

[English](transcription.md) | 中文

Transcription 子系统通过已注册的 provider 将一段录制的音频载荷转为文本，而 Voice Input 接缝是浏览器录音所能到达的唯一 Remote 命名空间。策略只存在于一处：`ctx.transcription` 负责字节上限、provider 选择与结果裁剪，`ctx.voiceInput` 除转发外不持有任何策略，因此无头部署执行的规则与 Web 输入框看到的完全一致。[transcription README](../../packages/transcription/transcription/README.zh.md) 负责 provider 注册与错误码；[voice-input README](../../packages/transcription/voice-input/README.zh.md) 负责按住说话的输入框按钮及其挂载时机。

## Provider 选择

配置可指定 provider id，或留空。已配置且已注册、可用的 id 被选中；已配置且已注册但不可用的 id 以 `TRANSCRIPTION_PROVIDER_CONFIGURED_UNAVAILABLE` 失败。未配置 id 时，恰好一个可用 provider 会被隐式选中，多个可用 provider 以 `TRANSCRIPTION_PROVIDER_AMBIGUOUS` 失败，没有可用 provider 则以 `TRANSCRIPTION_PROVIDER_UNAVAILABLE` 失败。选择按请求重新评估，因此启动后才变为可用的 provider 无需重启即可被选中。

## 请求与结果

`TranscriptionRequest` 携带音频字节、其媒体类型以及可选的语言提示；`TranscriptionResult` 携带裁剪后的文本及产生它的 provider。[`packages/transcription/transcription-groq`](../../packages/transcription/transcription-groq/README.zh.md) 中的 Groq provider 是参考实现，其测试直接针对线上 API 执行。

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
