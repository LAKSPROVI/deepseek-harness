/**
 * Public request, value, and failure vocabulary for browser-originated voice
 * input. This module contains types only so generated Remote clients can
 * consume it without importing Host runtime code.
 * @module @deepseek-ai/dsh-voice-input/types
 */

/** One recorded utterance uploaded for transcription. */
export interface VoiceInputTranscribeRequest {
  /** Container format of the recorded bytes, as the recorder declared it. */
  readonly mediaType: 'audio/webm' | 'audio/ogg' | 'audio/mp4' | 'audio/mpeg' | 'audio/wav'
  /** Canonical base64 encoding of the audio bytes; the Host verifies the encoding. */
  readonly data: string
  /** Optional language hint, e.g. `pt`; absent leaves detection to the provider. */
  readonly language?: string
}

/** The transcript of one accepted utterance. */
export interface VoiceInputTranscribeValue {
  /** Transcribed text, already trimmed by the transcription seam; empty for silence. */
  readonly text: string
  /** Language the provider reported, when it reported one. */
  readonly language?: string
}

/** The upload carried no audio byte. */
export interface VoiceInputAudioEmpty {
  readonly code: 'audio-empty'
}

/** The upload is not canonical base64, so no audio can be recovered from it. */
export interface VoiceInputAudioUndecodable {
  readonly code: 'audio-undecodable'
}

/** The decoded audio exceeds the transcription seam's configured ceiling. */
export interface VoiceInputAudioTooLarge {
  readonly code: 'audio-too-large'
  /** Decoded byte length the Host measured. */
  readonly actualBytes: number
}

/** No transcription provider is currently usable in this deployment. */
export interface VoiceInputProviderUnavailable {
  readonly code: 'provider-unavailable'
  /** Operator-facing detail naming which selection step failed. */
  readonly detail: string
}

/** A provider is registered but holds no credential to authenticate with. */
export interface VoiceInputProviderUnconfigured {
  readonly code: 'provider-unconfigured'
  /** Operator-facing detail naming the missing credential reference. */
  readonly detail: string
}

/** The provider was reached and refused or failed the transcription. */
export interface VoiceInputProviderFailed {
  readonly code: 'provider-failed'
  /** The provider's own message, forwarded verbatim for display. */
  readonly detail: string
}

/** The caller cancelled before a transcript existed. */
export interface VoiceInputAborted {
  readonly code: 'aborted'
}

/** Failures the public voice-input operation can report. */
export type VoiceInputFailure =
  | VoiceInputAudioEmpty
  | VoiceInputAudioUndecodable
  | VoiceInputAudioTooLarge
  | VoiceInputProviderUnavailable
  | VoiceInputProviderUnconfigured
  | VoiceInputProviderFailed
  | VoiceInputAborted

/** Successful public operation result. */
export interface VoiceInputSuccess<T> {
  readonly ok: true
  readonly value: T
}

/** Rejected public operation result with a stable business failure. */
export interface VoiceInputRejected<E extends VoiceInputFailure> {
  readonly ok: false
  readonly error: E
}

/** Result returned by the voice-input `transcribe` operation. */
export type VoiceInputTranscribeResult =
  | VoiceInputSuccess<VoiceInputTranscribeValue>
  | VoiceInputRejected<VoiceInputFailure>
