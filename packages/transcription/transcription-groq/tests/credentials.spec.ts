/** Credential resolution and endpoint defaulting for the `transcription-groq` provider. */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import LocalCredentialProvider from '@deepseek-ai/dsh-credentials-local'
import TranscriptionRuntime from '@deepseek-ai/dsh-transcription'
import type { TranscriptionRequest } from '@deepseek-ai/dsh-transcription'
import * as groqPlugin from '@deepseek-ai/dsh-transcription-groq'
import { GROQ_PROVIDER_ID, GroqTranscriptionProvider } from '@deepseek-ai/dsh-transcription-groq'
import type { GroqTranscriptionProviderOptions } from '@deepseek-ai/dsh-transcription-groq'

const request = (): TranscriptionRequest => ({ audio: new Uint8Array([1, 2, 3, 4]), format: 'audio/webm' })

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
}

/** Stub fetch with a fresh body per call; a Response body reads only once. */
function stubFetch(): ReturnType<typeof vi.fn> {
  const mock = vi.fn(() => Promise.resolve(jsonResponse({ text: 'olá' })))
  vi.stubGlobal('fetch', mock)
  return mock
}

/** Construct the provider over a fixed options value; production passes a live thunk. */
const provider = (options: GroqTranscriptionProviderOptions): GroqTranscriptionProvider =>
  new GroqTranscriptionProvider(() => options)

const options: GroqTranscriptionProviderOptions = {
  baseURL: 'https://api.groq.test/openai/v1',
  model: 'whisper-large-v3-turbo',
}

/** Run one body with GROQ_API_KEY set to `value`, restoring the previous entry. */
async function withEnvKey(value: string | undefined, body: () => Promise<void>): Promise<void> {
  const previous = process.env.GROQ_API_KEY
  if (value === undefined) delete process.env.GROQ_API_KEY
  else process.env.GROQ_API_KEY = value
  try {
    await body()
  } finally {
    if (previous === undefined) delete process.env.GROQ_API_KEY
    else process.env.GROQ_API_KEY = previous
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('transcription-groq credential resolution', () => {
  it('resolves the credential for each transcription so a rotated key needs no restart', async () => {
    await withEnvKey(undefined, async () => {
      const dir = await mkdtemp(join(tmpdir(), 'dsh-transcription-credentials-'))
      const fetchMock = stubFetch()
      const ctx = new Context()
      try {
        await ctx.plugin(TranscriptionRuntime, { provider: GROQ_PROVIDER_ID })
        await ctx.plugin(LocalCredentialProvider, { path: join(dir, '.credentials.yaml'), watch: false })
        await ctx.plugin(groqPlugin, { baseURL: 'https://api.groq.test/openai/v1' })

        await expect(ctx.transcription.transcribe(request()))
          .rejects.toThrow(expect.objectContaining({ code: 'TRANSCRIPTION_CREDENTIAL_MISSING' }))

        const ref = credentialRef('GROQ_API_KEY')
        await ctx.credentials.set(ref, 'stored-key')
        await ctx.transcription.transcribe(request())
        await ctx.credentials.set(ref, 'rotated-key')
        await ctx.transcription.transcribe(request())

        const headers = fetchMock.mock.calls.map(([, init]) => (init as RequestInit).headers as Record<string, string>)
        expect(headers.map(value => value.authorization)).toEqual(['Bearer stored-key', 'Bearer rotated-key'])
      } finally {
        await ctx.fiber.dispose()
        await rm(dir, { recursive: true, force: true })
      }
    })
  })

  it('falls back to the launch environment when the credentials seam is absent', async () => {
    await withEnvKey('env-key', async () => {
      const fetchMock = stubFetch()
      const ctx = new Context()
      await ctx.plugin(TranscriptionRuntime, { provider: GROQ_PROVIDER_ID })
      groqPlugin.apply(ctx, {})

      await ctx.transcription.transcribe(request())

      const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
      expect(url).toBe('https://api.groq.com/openai/v1/audio/transcriptions')
      expect((init.headers as Record<string, string>).authorization).toBe('Bearer env-key')
      expect((init.body as FormData).get('model')).toBe('whisper-large-v3-turbo')
      await ctx.fiber.dispose()
    })
  })

  it('treats an empty launch-environment entry as no credential', async () => {
    await withEnvKey('', async () => {
      const ctx = new Context()
      await ctx.plugin(TranscriptionRuntime, { provider: GROQ_PROVIDER_ID })
      groqPlugin.apply(ctx, {})

      await expect(ctx.transcription.transcribe(request()))
        .rejects.toThrow(expect.objectContaining({ code: 'TRANSCRIPTION_CREDENTIAL_MISSING' }))
      await ctx.fiber.dispose()
    })
  })

  it('reads the endpoint from the launch environment when the config omits it', async () => {
    await withEnvKey('env-key', async () => {
      const previous = process.env.GROQ_BASE_URL
      process.env.GROQ_BASE_URL = 'https://groq.env.test/openai/v1'
      const fetchMock = stubFetch()
      const ctx = new Context()
      try {
        await ctx.plugin(TranscriptionRuntime, { provider: GROQ_PROVIDER_ID })
        groqPlugin.apply(ctx, {})
        await ctx.transcription.transcribe(request())
        expect(fetchMock.mock.calls[0]?.[0]).toBe('https://groq.env.test/openai/v1/audio/transcriptions')
      } finally {
        await ctx.fiber.dispose()
        if (previous === undefined) delete process.env.GROQ_BASE_URL
        else process.env.GROQ_BASE_URL = previous
      }
    })
  })

  it('sends the configured language hint and omits an empty one', async () => {
    const fetchMock = stubFetch()
    const ctx = new Context()
    await ctx.plugin(TranscriptionRuntime, { provider: GROQ_PROVIDER_ID })
    groqPlugin.apply(ctx, { apiKey: 'groq-key', defaultLanguage: 'pt' })
    await ctx.transcription.transcribe(request())
    expect((fetchMock.mock.calls[0]?.[1] as RequestInit | undefined as RequestInit).body as FormData).toBeInstanceOf(FormData)
    expect(((fetchMock.mock.calls[0]?.[1] as RequestInit).body as FormData).get('language')).toBe('pt')
    await ctx.fiber.dispose()

    const secondMock = stubFetch()
    const blank = new Context()
    await blank.plugin(TranscriptionRuntime, { provider: GROQ_PROVIDER_ID })
    groqPlugin.apply(blank, { apiKey: 'groq-key', defaultLanguage: '' })
    await blank.transcription.transcribe(request())
    expect(((secondMock.mock.calls[0]?.[1] as RequestInit).body as FormData).get('language')).toBeNull()
    await blank.fiber.dispose()
  })

  it('treats an empty configured key as no literal credential', async () => {
    await withEnvKey('env-key', async () => {
      const fetchMock = stubFetch()
      const ctx = new Context()
      await ctx.plugin(TranscriptionRuntime, { provider: GROQ_PROVIDER_ID })
      groqPlugin.apply(ctx, { apiKey: '' })
      await ctx.transcription.transcribe(request())
      const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
      expect((init.headers as Record<string, string>).authorization).toBe('Bearer env-key')
      await ctx.fiber.dispose()
    })
  })
})

describe('GroqTranscriptionProvider credential preflight', () => {
  it('reports the default reference when no credential source is configured at all', async () => {
    await expect(provider(options).transcribe(request()))
      .rejects.toThrow('Groq transcription has no API key for "GROQ_API_KEY"')
  })

  it('observes cancellation triggered synchronously by credential resolution', async () => {
    const controller = new AbortController()
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expect(provider({
      ...options,
      resolveApiKey: () => {
        controller.abort(new Error('resolver cancelled caller'))
        return Promise.resolve('unused-key')
      },
    }).transcribe(request(), controller.signal))
      .rejects.toThrow(expect.objectContaining({ code: 'TRANSCRIPTION_ABORTED' }))
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('resolves a credential under an active signal that never aborts', async () => {
    const controller = new AbortController()
    const fetchMock = stubFetch()

    await provider({ ...options, resolveApiKey: () => Promise.resolve('live-key') })
      .transcribe(request(), controller.signal)

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer live-key')
  })

  it('maps a credential resolver rejection under an active signal to TRANSCRIPTION_PROVIDER_ERROR', async () => {
    const controller = new AbortController()
    await expect(provider({
      ...options,
      resolveApiKey: () => Promise.reject(new Error('credential backend failed')),
    }).transcribe(request(), controller.signal))
      .rejects.toThrow(expect.objectContaining({ code: 'TRANSCRIPTION_PROVIDER_ERROR' }))
  })
})
