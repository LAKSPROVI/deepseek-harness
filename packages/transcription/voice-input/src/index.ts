/**
 * Browser-facing Remote surface for voice input: it accepts one base64 audio
 * upload, delegates to the transcription seam, and answers a transcript or a
 * stable business failure.
 *
 * Audio is transient. The bytes exist only for the duration of one call: they
 * are never written to the session log, never persisted, and never retained
 * after the answer. Only the returned text becomes model-visible, and only
 * once the human sends the composer draft it was written into — which the
 * ordinary user-message path already logs.
 * @module @deepseek-ai/dsh-voice-input
 */

import { Buffer } from 'node:buffer'
import type { Context } from '@deepseek-ai/cordis'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { TranscriptionError } from '@deepseek-ai/dsh-transcription'
import type {} from '@deepseek-ai/dsh-transcription'
import type {
  VoiceInputFailure,
  VoiceInputTranscribeRequest,
  VoiceInputTranscribeResult,
} from './types.ts'

export type * from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    voiceInput: VoiceInputService
  }
}

/** Canonical base64: full quartets, at most two padding characters. */
const BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u

/**
 * Decode one canonical base64 upload. `Buffer.from` silently skips characters
 * outside the alphabet, so a corrupted upload would otherwise decode to
 * plausible-looking audio the provider then rejects with an opaque message.
 * @param data - the base64 text as it arrived over the wire.
 * @returns the decoded bytes, or `undefined` when the text is not canonical base64.
 */
function decodeAudio(data: string): Uint8Array | undefined {
  if (!BASE64_PATTERN.test(data)) return undefined
  const decoded = Buffer.from(data, 'base64')
  return new Uint8Array(decoded.buffer, decoded.byteOffset, decoded.byteLength)
}

/**
 * Project one transcription failure onto the wire vocabulary. The seam's error
 * codes are merge-extensible, so an unrecognized code falls through to
 * `provider-failed` with the original message rather than escaping as an
 * infrastructure exception.
 * @param error - the rejection the transcription seam produced.
 * @param byteLength - decoded audio length, reported with a ceiling failure.
 * @returns the business failure to answer with.
 */
function mapFailure(error: TranscriptionError, byteLength: number): VoiceInputFailure {
  switch (error.code) {
    case 'TRANSCRIPTION_AUDIO_EMPTY':
      return { code: 'audio-empty' }
    case 'TRANSCRIPTION_AUDIO_TOO_LARGE':
      return { code: 'audio-too-large', actualBytes: byteLength }
    case 'TRANSCRIPTION_ABORTED':
      return { code: 'aborted' }
    case 'TRANSCRIPTION_CREDENTIAL_MISSING':
      return { code: 'provider-unconfigured', detail: error.message }
    case 'TRANSCRIPTION_PROVIDER_UNAVAILABLE':
    case 'TRANSCRIPTION_PROVIDER_CONFIGURED_MISSING':
    case 'TRANSCRIPTION_PROVIDER_CONFIGURED_UNAVAILABLE':
    case 'TRANSCRIPTION_PROVIDER_AMBIGUOUS':
      return { code: 'provider-unavailable', detail: error.message }
    default:
      return { code: 'provider-failed', detail: error.message }
  }
}

/**
 * The Remote namespace one browser recording reaches. It owns no transcription
 * policy of its own: the ceiling, provider selection, and trimming all belong
 * to `ctx.transcription`, so a headless deployment enforces the same rules.
 */
export class VoiceInputService extends TypertRemoteService {
  static inject = ['transcription']

  constructor(ctx: Context) {
    super(ctx, 'voiceInput')
  }

  /**
   * Transcribe one uploaded utterance.
   * @param request - the recorded audio, its declared container format, and an optional language hint.
   * @param signal - abort signal cancelling the upload's transcription.
   * @returns the transcript, or a stable business failure.
   */
  @Remote('transcribe')
  async transcribe(
    request: VoiceInputTranscribeRequest,
    signal?: AbortSignal,
  ): Promise<VoiceInputTranscribeResult> {
    const audio = decodeAudio(request.data)
    if (audio === undefined) return { ok: false, error: { code: 'audio-undecodable' } }

    try {
      const result = await this.ctx.transcription.transcribe({
        audio,
        format: request.mediaType,
        ...request.language === undefined || request.language.length === 0
          ? {}
          : { language: request.language },
      }, signal)
      return {
        ok: true,
        value: {
          text: result.text,
          ...result.language === undefined ? {} : { language: result.language },
        },
      }
    } catch (error: unknown) {
      if (error instanceof TranscriptionError) {
        return { ok: false, error: mapFailure(error, audio.byteLength) }
      }
      throw error
    }
  }
}

export default VoiceInputService
