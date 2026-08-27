/**
 * The voice-input entry's injected face. The target
 * `conversation.input.left` slot is declared and typed by ui-conversation, so
 * no SlotMap merge lives here — this package only contributes an entry. The
 * face carries one callback: audio in, transcript-or-failure out.
 * @module @deepseek-ai/dsh-client-ui-voice-input/client/slots
 */

import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: pulls the ui-conversation SlotMap merge (the input.left entry).
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {
  VoiceInputTranscribeRequest, VoiceInputTranscribeResult,
} from '@deepseek-ai/dsh-voice-input/types'
// Type-only: pulls this package's LocaleNamespaceMap merge (the 'voiceInput' seat).
import type {} from './locales.ts'

/** Injected business face of the push-to-talk entry. */
export interface VoiceInputInjected {
  /**
   * Upload one recorded utterance and await its transcript. The generated
   * Remote face wraps every business result in {@link RemoteResult} and folds
   * a carrier failure into that envelope's `ok: false` branch rather than
   * rejecting, so a caller reads two envelopes and never wraps the call to
   * recover a transport error.
   * @param request - the recorded audio as base64 plus its media type.
   * @param signal - abort signal the user's cancel gesture triggers.
   * @returns the carrier envelope around the transcript or the Host's business failure.
   */
  transcribe: (
    request: VoiceInputTranscribeRequest,
    signal: AbortSignal,
  ) => Promise<RemoteResult<VoiceInputTranscribeResult>>
}

/** Full props of the push-to-talk entry: runtime share, injected face, and the locale seat. */
export type VoiceInputButtonProps =
  PropsRuntime<'conversation.input.left'>
  & InjectFace<VoiceInputInjected>
  & PropsLocale<'voiceInput'>
