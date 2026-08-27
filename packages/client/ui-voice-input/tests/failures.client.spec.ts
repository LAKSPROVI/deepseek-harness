/**
 * The Host failure taxonomy rendered as this package's own copy: one line per
 * code, operator-facing detail strings withheld, and the closed union's default
 * refusing a code the compiler says cannot arrive.
 */
import { describe, expect, it } from 'vitest'
import type { VoiceInputFailure } from '@deepseek-ai/dsh-voice-input/types'
import { describeFailure } from '../src/client/failures.ts'

describe('describeFailure', () => {
  it.each([
    ['audio-empty', { code: 'audio-empty' }],
    ['audio-undecodable', { code: 'audio-undecodable' }],
    ['provider-unavailable', { code: 'provider-unavailable', detail: 'no provider selected' }],
    ['provider-unconfigured', { code: 'provider-unconfigured', detail: 'groq api key missing' }],
    ['provider-failed', { code: 'provider-failed', detail: 'upstream said 503' }],
    ['aborted', { code: 'aborted' }],
  ] as [string, VoiceInputFailure][])('gives %s its own failure line', (code, failure) => {
    expect(describeFailure(failure)).toEqual({ key: `error.${code}`, severity: 'error' })
  })

  it('carries the measured byte length into the too-large line', () => {
    const failure: VoiceInputFailure = { code: 'audio-too-large', actualBytes: 26_214_400 }

    expect(describeFailure(failure)).toEqual({
      key: 'error.audio-too-large',
      severity: 'error',
      params: { bytes: 26_214_400 },
    })
  })

  it('withholds the operator-facing detail from every line that carries one', () => {
    const detailed: VoiceInputFailure[] = [
      { code: 'provider-unavailable', detail: 'no provider selected' },
      { code: 'provider-unconfigured', detail: 'groq api key missing' },
      { code: 'provider-failed', detail: 'upstream said 503' },
    ]

    for (const failure of detailed) {
      expect(describeFailure(failure).params).toBeUndefined()
    }
  })

  it('refuses a code outside the taxonomy', () => {
    const unknown = { code: 'quota-exhausted' } as unknown as VoiceInputFailure

    expect(() => describeFailure(unknown)).toThrow('unexpected voice-input variant')
  })
})
