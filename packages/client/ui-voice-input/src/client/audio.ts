/**
 * Browser-side audio packaging: the recorded container format mapped onto the
 * Host's accepted media types, and the base64 encoding the JSON-only RPC needs.
 * @module @deepseek-ai/dsh-client-ui-voice-input/client/audio
 */

import type { VoiceInputTranscribeRequest } from '@deepseek-ai/dsh-voice-input/types'

/** The media type the Host accepts, as this package addresses it. */
export type VoiceMediaType = VoiceInputTranscribeRequest['mediaType']

/**
 * Every media type the Host accepts, keyed so the compiler reports the day the
 * Host widens its closed union. Protocol constant: the accepted set is the
 * transcription seam's own vocabulary, not a deployment choice.
 */
const ACCEPTED: Readonly<Record<VoiceMediaType, true>> = {
  'audio/webm': true,
  'audio/ogg': true,
  'audio/wav': true,
  'audio/mp4': true,
  'audio/mpeg': true,
}

/**
 * Narrow what MediaRecorder actually produced onto an accepted media type.
 * Recorders report a full container declaration such as
 * `audio/webm;codecs=opus`, so the parameters are dropped before matching; a
 * browser-specific container outside the accepted set stays unresolved and the
 * caller refuses the upload rather than sending bytes the Host would reject.
 * @param declared - the recorder's own `mimeType`, parameters included.
 * @returns the accepted media type, or undefined when the container is not one.
 */
export function resolveMediaType(declared: string): VoiceMediaType | undefined {
  /* v8 ignore next -- split with limit 1 always yields a first element, so the empty-string guard is unreachable */
  const container = declared.split(';', 1)[0]?.trim().toLowerCase() ?? ''
  return container in ACCEPTED ? container as VoiceMediaType : undefined
}

/**
 * Canonical base64 of the recorded bytes: the chunked encoder from
 * `@deepseek-ai/dsh-util-crypto`, because spreading an audio-sized buffer into
 * `String.fromCharCode` exceeds the argument limit and throws.
 */
export { bytesToBase64 } from '@deepseek-ai/dsh-util-crypto'
