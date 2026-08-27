/**
 * Host failure taxonomy rendered as this package's own localized copy.
 * @module @deepseek-ai/dsh-client-ui-voice-input/client/failures
 */

import type { VoiceInputFailure } from '@deepseek-ai/dsh-voice-input/types'
import type { VoiceInputKey } from './locales.ts'
import { assertNever } from './never.ts'

/** One localized line to announce: a dictionary key, its params, and whether it reads as a failure. */
export interface VoiceInputNotice {
  /** Dictionary key in this package's `voiceInput` namespace. */
  readonly key: VoiceInputKey
  /** Whether the line is a failure (rendered visibly) or ordinary progress (announced only). */
  readonly severity: 'error' | 'info'
  /** Template params the key's copy interpolates; absent when it takes none. */
  readonly params?: Record<string, unknown>
}

/**
 * The carrier envelope's failure line. `RemoteFailure.code` is an open string
 * and its message is operator-facing, so neither is switched on nor shown: the
 * user reads one line for every outcome where the request did not complete.
 */
export const CARRIER_NOTICE: VoiceInputNotice = { key: 'error.carrier', severity: 'error' }

/**
 * Map one Host business failure onto this package's copy. Each code gets its
 * own line: `provider-unconfigured` tells the user the deployment holds no
 * transcription credential, naming no provider because the seam accepts any
 * registered one. No `detail` string reaches the UI — operator-facing text is
 * not user copy, and an arbitrary-length provider message does not fit a
 * one-row composer control.
 * @param failure - the closed business failure the inner envelope carried.
 * @returns the notice to announce and display.
 */
export function describeFailure(failure: VoiceInputFailure): VoiceInputNotice {
  switch (failure.code) {
    case 'audio-empty':
      return { key: 'error.audio-empty', severity: 'error' }
    case 'audio-undecodable':
      return { key: 'error.audio-undecodable', severity: 'error' }
    case 'audio-too-large':
      return { key: 'error.audio-too-large', severity: 'error', params: { bytes: failure.actualBytes } }
    case 'provider-unavailable':
      return { key: 'error.provider-unavailable', severity: 'error' }
    case 'provider-unconfigured':
      return { key: 'error.provider-unconfigured', severity: 'error' }
    case 'provider-failed':
      return { key: 'error.provider-failed', severity: 'error' }
    case 'aborted':
      return { key: 'error.aborted', severity: 'error' }
    default:
      return assertNever(failure)
  }
}
