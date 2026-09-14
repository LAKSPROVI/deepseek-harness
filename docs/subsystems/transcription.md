# Transcription and voice input

English | [中文](transcription.zh.md)

The Transcription subsystem turns one recorded audio payload into text through a registered provider, and the Voice Input seam is the single Remote namespace a browser recording reaches. Policy lives in one place: `ctx.transcription` owns the byte ceiling, provider selection, and result trimming, while `ctx.voiceInput` owns nothing beyond forwarding, so a headless deployment enforces exactly the rules the Web composer sees. The [transcription README](../../packages/transcription/transcription/README.md) owns provider registration and error codes; the [voice-input README](../../packages/transcription/voice-input/README.md) owns the push-to-talk composer button and its mount timing.

## Provider selection

Configuration names a provider id or leaves it empty. A configured id that is registered and usable is chosen; a configured id that is registered but unusable fails as `TRANSCRIPTION_PROVIDER_CONFIGURED_UNAVAILABLE`. With no id, exactly one usable provider is chosen implicitly, several usable providers fail as `TRANSCRIPTION_PROVIDER_AMBIGUOUS`, and none fail as `TRANSCRIPTION_PROVIDER_UNAVAILABLE`. Selection is re-evaluated per request, so a provider that becomes usable after boot is picked up without restart.

## Request and result

`TranscriptionRequest` carries the audio bytes, their media type, and an optional language hint; `TranscriptionResult` carries the trimmed text and the provider that produced it. The Groq provider in [`packages/transcription/transcription-groq`](../../packages/transcription/transcription-groq/README.md) is the reference implementation and is exercised against the live API by its tests.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

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
