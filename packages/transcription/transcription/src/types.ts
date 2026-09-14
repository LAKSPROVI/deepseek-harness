/**
 * Vocabulary for the transcription capability seam (`ctx.transcription`): what one
 * speech-to-text backend is asked to transcribe, what it returns, and the error
 * taxonomy callers route on. Audio never becomes durable session data here — the
 * seam carries transient bytes and returns text.
 * @module @deepseek-ai/dsh-transcription/types
 */

import { HarnessError } from '@deepseek-ai/dsh-llm'

/**
 * Container formats the seam accepts. A CLOSED union owned by `dsh-transcription`:
 * providers `switch` to exhaustiveness, so adding a format breaks compilation at
 * every provider until it declares real support. Browser capture produces
 * `audio/webm` or `audio/mp4` depending on the engine; the WAV and MPEG arms serve
 * file-backed callers.
 */
export type TranscriptionAudioFormat =
  | 'audio/webm'
  | 'audio/ogg'
  | 'audio/wav'
  | 'audio/mp4'
  | 'audio/mpeg'

/**
 * One utterance to transcribe. `audio` is the complete encoded payload, not a
 * stream: the seam bounds it before dispatch, which requires knowing its full
 * size. `language` is a BCP-47 or ISO-639-1 hint; omitting it asks the provider
 * to detect, which costs accuracy on short utterances.
 */
export interface TranscriptionRequest {
  /** Complete encoded audio payload. */
  readonly audio: Uint8Array
  /** Container format of {@link TranscriptionRequest.audio}. */
  readonly format: TranscriptionAudioFormat
  /** Language hint, e.g. `pt`; omitted = provider detects. */
  readonly language?: string
}

/**
 * Normalized transcription outcome. `text` is the transcript with surrounding
 * whitespace already trimmed by the seam. `language` is present only when the
 * provider reports what it detected or honored — the seam never echoes the
 * request hint back, so a caller can distinguish detection from assumption.
 */
export interface TranscriptionResult {
  /** The transcript. Empty string when the audio carried no speech. */
  readonly text: string
  /** Language the provider reports for the audio, when it reports one. */
  readonly language?: string
}

/**
 * A speech-to-text backend. Registered with `ctx.transcription.registerProvider`.
 * `id` is a stable string, unique within the seam.
 */
export interface TranscriptionProvider {
  readonly id: string
  /** Cheap local usability check; must not make network calls. */
  available(): boolean
  /** Transcribe one utterance; honor `signal` for cancellation. */
  transcribe(request: TranscriptionRequest, signal?: AbortSignal): Promise<TranscriptionResult>
}

/**
 * Typed transcription error with a machine-routable, open-string `code` and
 * chained `cause`. Consumers must tolerate provider-specific codes. Seam-owned
 * codes cover duplicate registration, the four provider-selection failures,
 * an oversized payload, and an empty payload; providers add their own for
 * credential and transport failures.
 */
export class TranscriptionError extends HarnessError {}
