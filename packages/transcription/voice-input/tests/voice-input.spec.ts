/** The Remote voice-input surface over a stubbed transcription seam. */

import { describe, expect, it, vi } from 'vitest'
import { Buffer } from 'node:buffer'
import { Context } from '@deepseek-ai/cordis'
import TranscriptionRuntime, { TranscriptionError } from '@deepseek-ai/dsh-transcription'
import type { TranscriptionProvider, TranscriptionRequest, TranscriptionResult } from '@deepseek-ai/dsh-transcription'
import VoiceInputService from '@deepseek-ai/dsh-voice-input'
import * as invariantCompanion from '@deepseek-ai/dsh-voice-input/invariant'
import type { VoiceInputTranscribeRequest } from '@deepseek-ai/dsh-voice-input'

const AUDIO = new Uint8Array([1, 2, 3, 4, 5])
const DATA = Buffer.from(AUDIO).toString('base64')

const upload = (patch: Partial<VoiceInputTranscribeRequest> = {}): VoiceInputTranscribeRequest => ({
  mediaType: 'audio/webm',
  data: DATA,
  ...patch,
})

/** A provider that answers a fixed transcript and records what it received. */
function recordingProvider(result: TranscriptionResult, seen: { request?: TranscriptionRequest }): TranscriptionProvider {
  return {
    id: 'stub',
    available: () => true,
    transcribe: (request) => {
      seen.request = request
      return Promise.resolve(result)
    },
  }
}

/** A provider that always rejects with one transcription error. */
function failingProvider(error: TranscriptionError): TranscriptionProvider {
  return { id: 'stub', available: () => true, transcribe: () => Promise.reject(error) }
}

/**
 * Mount the seam and the Remote surface over one provider.
 * @param provider - the transcription backend the seam should select.
 * @param maxAudioBytes - optional ceiling override for bound tests.
 * @returns the context whose `ctx.voiceInput` serves the calls.
 */
async function boot(provider: TranscriptionProvider | undefined, maxAudioBytes?: number): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(TranscriptionRuntime, {
    provider: 'stub',
    ...maxAudioBytes === undefined ? {} : { maxAudioBytes },
  })
  if (provider !== undefined) ctx.transcription.registerProvider(provider)
  await ctx.plugin(VoiceInputService)
  return ctx
}

describe('VoiceInputService.transcribe', () => {
  it('answers the transcript for one accepted upload', async () => {
    const seen: { request?: TranscriptionRequest } = {}
    const ctx = await boot(recordingProvider({ text: 'bom dia' }, seen))

    await expect(ctx.voiceInput.transcribe(upload())).resolves.toEqual({
      ok: true,
      value: { text: 'bom dia' },
    })
    expect(seen.request?.audio).toEqual(AUDIO)
    expect(seen.request?.format).toBe('audio/webm')
  })

  it('forwards the language the provider reported', async () => {
    const seen: { request?: TranscriptionRequest } = {}
    const ctx = await boot(recordingProvider({ text: 'bom dia', language: 'pt' }, seen))

    await expect(ctx.voiceInput.transcribe(upload())).resolves.toEqual({
      ok: true,
      value: { text: 'bom dia', language: 'pt' },
    })
  })

  it.each([
    ['a hint', 'pt', 'pt'],
    ['no hint when absent', undefined, undefined],
    ['no hint when empty', '', undefined],
  ])('sends %s to the seam', async (_label, language, expected) => {
    const seen: { request?: TranscriptionRequest } = {}
    const ctx = await boot(recordingProvider({ text: 'ok' }, seen))

    await ctx.voiceInput.transcribe(upload(language === undefined ? {} : { language }))

    expect(seen.request?.language).toBe(expected)
  })

  it('forwards each accepted container format unchanged', async () => {
    const seen: { request?: TranscriptionRequest } = {}
    const ctx = await boot(recordingProvider({ text: 'ok' }, seen))

    for (const mediaType of ['audio/webm', 'audio/ogg', 'audio/wav', 'audio/mp4', 'audio/mpeg'] as const) {
      await ctx.voiceInput.transcribe(upload({ mediaType }))
      expect(seen.request?.format).toBe(mediaType)
    }
  })

  it('forwards the caller signal so a cancelled upload stops the provider', async () => {
    const controller = new AbortController()
    const seen: { signal?: AbortSignal | undefined } = {}
    const ctx = await boot({
      id: 'stub',
      available: () => true,
      transcribe: (_request, signal) => {
        seen.signal = signal
        return Promise.resolve({ text: 'ok' })
      },
    })

    await ctx.voiceInput.transcribe(upload(), controller.signal)

    expect(seen.signal).toBe(controller.signal)
  })
})

describe('VoiceInputService upload validation', () => {
  it.each([
    ['a character outside the alphabet', 'not base64!!'],
    ['an incomplete quartet', 'AAAAA'],
    ['padding in the middle', 'AA==AA=='],
  ])('rejects %s as undecodable without reaching the seam', async (_label, data) => {
    const seen: { request?: TranscriptionRequest } = {}
    const ctx = await boot(recordingProvider({ text: 'unused' }, seen))

    await expect(ctx.voiceInput.transcribe(upload({ data }))).resolves.toEqual({
      ok: false,
      error: { code: 'audio-undecodable' },
    })
    expect(seen.request).toBeUndefined()
  })

  it('reports an empty upload through the seam bound, not as undecodable', async () => {
    const ctx = await boot(recordingProvider({ text: 'unused' }, {}))

    await expect(ctx.voiceInput.transcribe(upload({ data: '' }))).resolves.toEqual({
      ok: false,
      error: { code: 'audio-empty' },
    })
  })

  it('reports the measured length when the upload exceeds the seam ceiling', async () => {
    const ctx = await boot(recordingProvider({ text: 'unused' }, {}), 4)

    await expect(ctx.voiceInput.transcribe(upload())).resolves.toEqual({
      ok: false,
      error: { code: 'audio-too-large', actualBytes: AUDIO.byteLength },
    })
  })

  it('accepts an upload of exactly the ceiling', async () => {
    const seen: { request?: TranscriptionRequest } = {}
    const ctx = await boot(recordingProvider({ text: 'ok' }, seen), AUDIO.byteLength)

    await expect(ctx.voiceInput.transcribe(upload())).resolves.toMatchObject({ ok: true })
  })
})

describe('VoiceInputService failure projection', () => {
  it('reports a missing credential as unconfigured, naming the reference', async () => {
    const ctx = await boot(failingProvider(
      new TranscriptionError('no API key for "GROQ_API_KEY"', 'TRANSCRIPTION_CREDENTIAL_MISSING'),
    ))

    await expect(ctx.voiceInput.transcribe(upload())).resolves.toEqual({
      ok: false,
      error: { code: 'provider-unconfigured', detail: 'no API key for "GROQ_API_KEY"' },
    })
  })

  it('reports a cancelled transcription as aborted', async () => {
    const ctx = await boot(failingProvider(new TranscriptionError('cancelled', 'TRANSCRIPTION_ABORTED')))

    await expect(ctx.voiceInput.transcribe(upload())).resolves.toEqual({
      ok: false,
      error: { code: 'aborted' },
    })
  })

  it.each([
    'TRANSCRIPTION_PROVIDER_UNAVAILABLE',
    'TRANSCRIPTION_PROVIDER_CONFIGURED_MISSING',
    'TRANSCRIPTION_PROVIDER_CONFIGURED_UNAVAILABLE',
    'TRANSCRIPTION_PROVIDER_AMBIGUOUS',
  ])('reports %s as an unavailable provider', async (code) => {
    const ctx = await boot(failingProvider(new TranscriptionError('selection failed', code)))

    await expect(ctx.voiceInput.transcribe(upload())).resolves.toEqual({
      ok: false,
      error: { code: 'provider-unavailable', detail: 'selection failed' },
    })
  })

  it('reports an unrecognized transcription code as a provider failure', async () => {
    const ctx = await boot(failingProvider(
      new TranscriptionError('Groq API error (HTTP 429)', 'TRANSCRIPTION_PROVIDER_ERROR'),
    ))

    await expect(ctx.voiceInput.transcribe(upload())).resolves.toEqual({
      ok: false,
      error: { code: 'provider-failed', detail: 'Groq API error (HTTP 429)' },
    })
  })

  it('rethrows an infrastructure failure instead of projecting it onto the wire', async () => {
    const ctx = await boot({
      id: 'stub',
      available: () => true,
      transcribe: () => Promise.reject(new TypeError('bug in the provider')),
    })

    await expect(ctx.voiceInput.transcribe(upload())).rejects.toThrow('bug in the provider')
  })
})

describe('voice-input invariant companion', () => {
  it('reserves package ownership without installing a check', async () => {
    const register = vi.fn(() => () => {})
    const ctx = { invariants: { register } } as unknown as Context

    const dispose = await invariantCompanion.apply(ctx)

    expect(register).toHaveBeenCalledWith('@deepseek-ai/dsh-voice-input', expect.any(Function))
    const [, installer] = register.mock.calls[0] as unknown as [string, (arg: unknown) => void]
    expect(() => {
      installer(undefined)
    }).not.toThrow()
    expect(dispose).toBeTypeOf('function')
  })
})
