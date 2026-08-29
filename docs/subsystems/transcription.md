# Transcription

English | [中文](transcription.zh.md)

[`@deepseek-ai/dsh-transcription`](../../packages/transcription/transcription) defines the transcription capability seam (`ctx.transcription`): provider registration, execution-time provider selection, the audio-byte ceiling, and transcript trimming. [`@deepseek-ai/dsh-transcription-groq`](../../packages/transcription/transcription-groq) registers a Groq-backed provider on it, and [`@deepseek-ai/dsh-voice-input`](../../packages/transcription/voice-input) publishes one transcription call to the browser as the `voiceInput` Typert Remote namespace.

Audio is transient across the whole seam. The bytes exist for the duration of one call and become durable data nowhere: no session event, no log line, no cache, no spill file, and no diagnostic that echoes the payload. Only the transcript becomes model-visible, and only once the human sends the composer draft it was written into — which the ordinary user-message path already logs.

Source: [`packages/transcription/transcription/src/types.ts`](../../packages/transcription/transcription/src/types.ts)

## Public types

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

## Voice input types

Source: [`packages/transcription/voice-input/src/types.ts`](../../packages/transcription/voice-input/src/types.ts)

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

## Provider selection and payload bounds

The seam owns every transcription policy: the audio-byte ceiling, provider selection, and transcript trimming. A Consumer adds only what its own transport forces on it, so a headless deployment and the browser cannot diverge on a bound neither of them holds.

Selection resolves at execution time and never depends on registration order: a configured `provider` id must be both registered and `available()`, and without a configured id exactly one usable provider is required. The Cordis API section below enumerates the outcome for each case.

`maxAudioBytes` defaults to 25 MiB (`26214400`), the smallest documented per-request upload limit among the speech APIs the seam targets. It is checked against the decoded byte length before any provider is dispatched, so an oversized upload never reaches the network; an empty payload is rejected at the same point. The two payload failures are `TRANSCRIPTION_AUDIO_TOO_LARGE` and `TRANSCRIPTION_AUDIO_EMPTY`.

`TranscriptionError extends HarnessError` with an open-string `code`, so a provider raises its own codes without editing `dsh-transcription` and consumers must tolerate a code they do not recognize. The Groq provider adds `TRANSCRIPTION_CREDENTIAL_MISSING`, `TRANSCRIPTION_PROVIDER_ERROR`, and `TRANSCRIPTION_ABORTED`.

A provider's `available()` is a cheap local check — credential presence, parseable endpoint, non-empty model — and makes no network call. The seam therefore has no health signal: an endpoint that is configured but unreachable surfaces only as a failed transcription.

## The voiceInput Remote contract

The Typert RPC wire carries JSON only, with no binary channel, so audio crosses it base64-encoded inside the ordinary request at a 4/3 expansion. The 600 MiB default request-body budget absorbs that expansion at the default ceiling.

The Host validates the upload against a canonical base64 pattern before decoding it. `Buffer.from` silently skips characters outside the alphabet, so an unvalidated corrupt upload would decode into plausible-looking audio and fail deep inside the provider with an opaque message.

`transcribe` answers a closed business union of seven codes, each an outcome the user can act on. An infrastructure fault is rethrown rather than mapped, because it is a defect and not an outcome. `audio-undecodable` is raised before the seam is reached; the remaining codes project the seam's failures:

| Transcription error code | Wire failure |
|---|---|
| `TRANSCRIPTION_AUDIO_EMPTY` | `audio-empty` |
| `TRANSCRIPTION_AUDIO_TOO_LARGE` | `audio-too-large`, carrying the decoded `actualBytes` |
| `TRANSCRIPTION_ABORTED` | `aborted` |
| `TRANSCRIPTION_CREDENTIAL_MISSING` | `provider-unconfigured` |
| the four provider-selection codes | `provider-unavailable` |
| any other code | `provider-failed`, carrying the provider's message |

The final row is what keeps the seam's merge-extensible code set from escaping as an infrastructure exception when a provider raises a code this Consumer does not know.

## Providers

[`@deepseek-ai/dsh-transcription-groq`](../../packages/transcription/transcription-groq) calls Groq's OpenAI-compatible `POST {baseURL}/audio/transcriptions` with `multipart/form-data` and `response_format=verbose_json`. The model defaults to `whisper-large-v3-turbo` and the endpoint base to `https://api.groq.com/openai/v1`, which includes the `/openai/v1` prefix Groq serves that surface under. The wire format and its native `fetch` client are provider-private; this provider does not use `ctx.llm`.

The credential is resolved per transcription through the optional `ctx.credentials` seam, falling back to the launching environment, so a key stored or rotated after boot reaches the next call without a restart. Options are snapshotted once at each operation's entry, so one transcription never sends a key resolved from one settings section to the endpoint named by another.

The request sets `redirect: 'error'`. A credential-bearing request that follows a redirect hands the audio to whatever origin the response names, and the audio here is a recording of a person. Node's `fetch` strips `authorization` across origins but forwards the body, so the payload is what would leak. Every credentialed provider in this family opts into the same policy.

## Web surface

[`@deepseek-ai/dsh-client-ui-voice-input`](../../packages/client/ui-voice-input) is the browser consumer: a push-to-talk control in the `conversation.input.left` slot. It is presentation only and registers no Cordis service, calling `ctx.remote.voiceInput` through the mounted generated contribution.

The browser encodes the recording in 0x8000-byte chunks, because spreading an audio-sized buffer into `String.fromCharCode` exceeds the argument limit. It reads two envelopes: the carrier `RemoteResult` the generated Remote face wraps every call in, then the business union inside it. The transcript lands in the composer draft, and the human sends it.

## Boundaries and limitations

- There is no streaming transcription. One call carries one complete utterance, so a long recording produces no partial text until it finishes; interim results would need a streaming Remote operation the RPC layer does not have.
- The spoken language is not declared. The seam accepts a hint and the browser sends none, because the UI locale is not evidence of what the speaker is speaking; the provider auto-detects.
- A deployment that raises `maxAudioBytes` must confirm its request-body budget still covers the base64-expanded upload, or the request is refused before it reaches the seam.
- ACP stays audio-free: it refuses audio prompt content and advertises `promptCapabilities.audio: false`.
- Audio is never replayable. No log, attachment, or cache retains the recording, so a mistranscription can be corrected in the draft but not re-derived from the original utterance.

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
