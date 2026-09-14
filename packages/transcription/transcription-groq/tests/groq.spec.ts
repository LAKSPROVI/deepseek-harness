import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import TranscriptionRuntime from '@deepseek-ai/dsh-transcription'
import {
  GROQ_DEFAULT_BASE_URL,
  GROQ_DEFAULT_MODEL,
  GROQ_PROVIDER_ID,
  GroqTranscriptionProvider,
  mapGroqResponse,
} from '@deepseek-ai/dsh-transcription-groq'
import type { GroqTranscriptionProviderOptions } from '@deepseek-ai/dsh-transcription-groq'
import * as groqPlugin from '@deepseek-ai/dsh-transcription-groq'
import type { TranscriptionRequest } from '@deepseek-ai/dsh-transcription'

/** Construct the provider over a fixed options value; production passes a live thunk. */
const provider = (options: GroqTranscriptionProviderOptions): GroqTranscriptionProvider =>
  new GroqTranscriptionProvider(() => options)

const options: GroqTranscriptionProviderOptions = {
  apiKey: 'groq-key',
  baseURL: 'https://api.groq.test/openai/v1',
  model: 'whisper-large-v3-turbo',
}

const request = (overrides: Partial<TranscriptionRequest> = {}): TranscriptionRequest => ({
  audio: new Uint8Array([1, 2, 3, 4]),
  format: 'audio/webm',
  ...overrides,
})

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  })
}

/** Stub global fetch and capture the single call's arguments. */
function stubFetch(response: Response | (() => Promise<Response>)): { calls: [string, RequestInit][] } {
  const calls: [string, RequestInit][] = []
  const impl = typeof response === 'function' ? response : () => Promise.resolve(response)
  vi.stubGlobal('fetch', (url: string, init: RequestInit) => {
    calls.push([url, init])
    return impl()
  })
  return { calls }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('mapGroqResponse', () => {
  it('maps text and reported language', () => {
    expect(mapGroqResponse({ text: 'olá mundo', language: 'portuguese' }))
      .toEqual({ text: 'olá mundo', language: 'portuguese' })
  })

  it('omits language when the provider reports none', () => {
    expect(mapGroqResponse({ text: 'olá' })).toEqual({ text: 'olá' })
  })

  it('omits language when the provider reports an empty string', () => {
    expect(mapGroqResponse({ text: 'olá', language: '' })).toEqual({ text: 'olá' })
  })

  it('preserves an empty transcript for silent audio', () => {
    expect(mapGroqResponse({ text: '' })).toEqual({ text: '' })
  })

  it('throws TRANSCRIPTION_PROVIDER_ERROR when the body carries no text member', () => {
    expect(() => mapGroqResponse({})).toThrow(
      expect.objectContaining({ code: 'TRANSCRIPTION_PROVIDER_ERROR' }),
    )
  })
})

describe('GroqTranscriptionProvider availability', () => {
  it('is available with a literal key, a parseable base, and a model', () => {
    expect(provider(options).available()).toBe(true)
  })

  it('is available with a credential resolver instead of a literal key', () => {
    const { apiKey: _omitted, ...rest } = options
    expect(provider({ ...rest, resolveApiKey: () => Promise.resolve('k') }).available()).toBe(true)
  })

  it('is unavailable without any credential source', () => {
    const { apiKey: _omitted, ...rest } = options
    expect(provider(rest).available()).toBe(false)
  })

  it('is unavailable with an empty literal key and no resolver', () => {
    const { apiKey: _omitted, ...rest } = options
    expect(provider({ ...rest, apiKey: '' }).available()).toBe(false)
  })

  it('is unavailable with an unparseable base URL', () => {
    expect(provider({ ...options, baseURL: 'not a url' }).available()).toBe(false)
  })

  it('is unavailable with an empty model', () => {
    expect(provider({ ...options, model: '' }).available()).toBe(false)
  })

  it('registers under the stable id', () => {
    expect(provider(options).id).toBe(GROQ_PROVIDER_ID)
    expect(GROQ_PROVIDER_ID).toBe('groq')
  })
})

describe('GroqTranscriptionProvider request construction', () => {
  it('posts multipart form data to the transcriptions endpoint with the bearer key', async () => {
    const { calls } = stubFetch(jsonResponse({ text: 'olá' }))

    await provider(options).transcribe(request())

    const [url, init] = calls[0]!
    expect(url).toBe('https://api.groq.test/openai/v1/audio/transcriptions')
    expect(init.method).toBe('POST')
    expect(init.redirect).toBe('error')
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer groq-key')
    const form = init.body as FormData
    expect(form.get('model')).toBe('whisper-large-v3-turbo')
    expect(form.get('response_format')).toBe('verbose_json')
    const file = form.get('file') as File
    expect(file.name).toBe('utterance.webm')
    expect(file.type).toBe('audio/webm')
    expect(file.size).toBe(4)
  })

  it('sends the request language hint over the configured default', async () => {
    const { calls } = stubFetch(jsonResponse({ text: 'olá' }))

    await provider({ ...options, defaultLanguage: 'en' }).transcribe(request({ language: 'pt' }))

    expect((calls[0]![1].body as FormData).get('language')).toBe('pt')
  })

  it('falls back to the configured default language', async () => {
    const { calls } = stubFetch(jsonResponse({ text: 'olá' }))

    await provider({ ...options, defaultLanguage: 'pt' }).transcribe(request())

    expect((calls[0]![1].body as FormData).get('language')).toBe('pt')
  })

  it('omits language entirely when neither the request nor the config carries one', async () => {
    const { calls } = stubFetch(jsonResponse({ text: 'olá' }))

    await provider(options).transcribe(request())

    expect((calls[0]![1].body as FormData).get('language')).toBeNull()
  })

  it('names the multipart part per accepted container format', async () => {
    const expected: Record<string, string> = {
      'audio/webm': 'utterance.webm',
      'audio/ogg': 'utterance.ogg',
      'audio/wav': 'utterance.wav',
      'audio/mp4': 'utterance.mp4',
      'audio/mpeg': 'utterance.mp3',
    }
    for (const [format, filename] of Object.entries(expected)) {
      const { calls } = stubFetch(jsonResponse({ text: 'olá' }))
      await provider(options).transcribe(request({ format: format as TranscriptionRequest['format'] }))
      expect((calls[0]![1].body as FormData).get('file')).toMatchObject({ name: filename })
      vi.unstubAllGlobals()
    }
  })
})

describe('GroqTranscriptionProvider failures', () => {
  it('surfaces a structured API error message', async () => {
    stubFetch(jsonResponse({ error: { message: 'rate limit reached' } }, { status: 429 }))
    await expect(provider(options).transcribe(request())).rejects.toThrow(
      expect.objectContaining({ code: 'TRANSCRIPTION_PROVIDER_ERROR', message: 'rate limit reached' }),
    )
  })

  it('accepts a string error member', async () => {
    stubFetch(jsonResponse({ error: 'bad request' }, { status: 400 }))
    await expect(provider(options).transcribe(request())).rejects.toThrow(
      expect.objectContaining({ message: 'bad request' }),
    )
  })

  it('accepts a top-level message member', async () => {
    stubFetch(jsonResponse({ message: 'gateway said no' }, { status: 502 }))
    await expect(provider(options).transcribe(request())).rejects.toThrow(
      expect.objectContaining({ message: 'gateway said no' }),
    )
  })

  it('keeps the HTTP status message when the error body is not JSON', async () => {
    stubFetch(new Response('<html>502</html>', { status: 502 }))
    await expect(provider(options).transcribe(request())).rejects.toThrow(
      expect.objectContaining({ code: 'TRANSCRIPTION_PROVIDER_ERROR', message: 'Groq API error (HTTP 502)' }),
    )
  })

  it('keeps the HTTP status message when the error body has an empty detail', async () => {
    stubFetch(jsonResponse({ error: { message: '' } }, { status: 500 }))
    await expect(provider(options).transcribe(request())).rejects.toThrow(
      expect.objectContaining({ message: 'Groq API error (HTTP 500)' }),
    )
  })

  it('maps a transport failure to TRANSCRIPTION_PROVIDER_ERROR', async () => {
    stubFetch(() => Promise.reject(new Error('socket hang up')))
    await expect(provider(options).transcribe(request())).rejects.toThrow(
      expect.objectContaining({ code: 'TRANSCRIPTION_PROVIDER_ERROR' }),
    )
  })

  it('maps an unprocessable success body to TRANSCRIPTION_PROVIDER_ERROR', async () => {
    stubFetch(new Response('not json', { status: 200, headers: { 'content-type': 'application/json' } }))
    await expect(provider(options).transcribe(request())).rejects.toThrow(
      expect.objectContaining({ code: 'TRANSCRIPTION_PROVIDER_ERROR' }),
    )
  })

  it('rethrows a mapping TranscriptionError from a well-formed but wrong body', async () => {
    stubFetch(jsonResponse({ language: 'pt' }))
    await expect(provider(options).transcribe(request())).rejects.toThrow(
      expect.objectContaining({ code: 'TRANSCRIPTION_PROVIDER_ERROR' }),
    )
  })
})

describe('GroqTranscriptionProvider cancellation', () => {
  it('throws TRANSCRIPTION_ABORTED when the caller already aborted', async () => {
    const controller = new AbortController()
    controller.abort(new Error('user cancelled'))
    await expect(provider(options).transcribe(request(), controller.signal)).rejects.toThrow(
      expect.objectContaining({ code: 'TRANSCRIPTION_ABORTED' }),
    )
  })

  it('maps a fetch AbortError to TRANSCRIPTION_ABORTED', async () => {
    const abortError = Object.assign(new Error('aborted'), { name: 'AbortError' })
    stubFetch(() => Promise.reject(abortError))
    await expect(provider(options).transcribe(request())).rejects.toThrow(
      expect.objectContaining({ code: 'TRANSCRIPTION_ABORTED' }),
    )
  })

  it('maps an abort during error-body parsing to TRANSCRIPTION_ABORTED', async () => {
    const controller = new AbortController()
    const body = { json: () => Promise.reject(new Error('interrupted')), ok: false, status: 500 } as unknown as Response
    stubFetch(() => {
      controller.abort(new Error('mid-body'))
      return Promise.resolve(body)
    })
    await expect(provider(options).transcribe(request(), controller.signal)).rejects.toThrow(
      expect.objectContaining({ code: 'TRANSCRIPTION_ABORTED' }),
    )
  })

  it('maps an abort during success-body parsing to TRANSCRIPTION_ABORTED', async () => {
    const controller = new AbortController()
    const body = { json: () => Promise.reject(new Error('interrupted')), ok: true, status: 200 } as unknown as Response
    stubFetch(() => {
      controller.abort(new Error('mid-body'))
      return Promise.resolve(body)
    })
    await expect(provider(options).transcribe(request(), controller.signal)).rejects.toThrow(
      expect.objectContaining({ code: 'TRANSCRIPTION_ABORTED' }),
    )
  })

  it('aborts a credential resolution that never settles', async () => {
    const controller = new AbortController()
    const { apiKey: _omitted, ...rest } = options
    const pending = provider({ ...rest, resolveApiKey: () => new Promise<string>(() => {}) })
      .transcribe(request(), controller.signal)
    controller.abort(new Error('cancelled while resolving'))
    await expect(pending).rejects.toThrow(expect.objectContaining({ code: 'TRANSCRIPTION_ABORTED' }))
  })
})

describe('GroqTranscriptionProvider credentials', () => {
  it('prefers a literal key over the resolver', async () => {
    const resolveApiKey = vi.fn(() => Promise.resolve('resolved'))
    const { calls } = stubFetch(jsonResponse({ text: 'olá' }))

    await provider({ ...options, resolveApiKey }).transcribe(request())

    expect(resolveApiKey).not.toHaveBeenCalled()
    expect((calls[0]![1].headers as Record<string, string>).authorization).toBe('Bearer groq-key')
  })

  it('resolves the key per call when no literal is configured', async () => {
    const { apiKey: _omitted, ...rest } = options
    const { calls } = stubFetch(jsonResponse({ text: 'olá' }))

    await provider({ ...rest, resolveApiKey: () => Promise.resolve('rotated') }).transcribe(request())

    expect((calls[0]![1].headers as Record<string, string>).authorization).toBe('Bearer rotated')
  })

  it('throws TRANSCRIPTION_CREDENTIAL_MISSING naming the reference when resolution is empty', async () => {
    const { apiKey: _omitted, ...rest } = options
    await expect(
      provider({ ...rest, resolveApiKey: () => Promise.resolve(undefined) }).transcribe(request()),
    ).rejects.toThrow(expect.objectContaining({ code: 'TRANSCRIPTION_CREDENTIAL_MISSING', message: expect.stringContaining('GROQ_API_KEY') as unknown }))
  })

  it('names the configured reference in the missing-credential message', async () => {
    const { apiKey: _omitted, ...rest } = options
    await expect(
      provider({ ...rest, apiKeyEnv: credentialRef('MY_KEY'), resolveApiKey: () => Promise.resolve('') }).transcribe(request()),
    ).rejects.toThrow(expect.objectContaining({ message: expect.stringContaining('MY_KEY') as unknown }))
  })

  it('maps a throwing credential resolver to TRANSCRIPTION_PROVIDER_ERROR', async () => {
    const { apiKey: _omitted, ...rest } = options
    await expect(
      provider({ ...rest, resolveApiKey: () => Promise.reject(new Error('keyring locked')) }).transcribe(request()),
    ).rejects.toThrow(expect.objectContaining({ code: 'TRANSCRIPTION_PROVIDER_ERROR' }))
  })
})

describe('transcription-groq plugin', () => {
  it('registers the provider into a mounted transcription seam', async () => {
    const ctx = new Context()
    await ctx.plugin(TranscriptionRuntime, {})
    await ctx.plugin(groqPlugin, { apiKey: 'groq-key' })

    stubFetch(jsonResponse({ text: 'olá do plugin' }))
    await expect(ctx.transcription.transcribe(request())).resolves.toEqual({ text: 'olá do plugin' })
  })

  it('exposes the documented defaults', () => {
    expect(GROQ_DEFAULT_BASE_URL).toBe('https://api.groq.com/openai/v1')
    expect(GROQ_DEFAULT_MODEL).toBe('whisper-large-v3-turbo')
    expect(groqPlugin.name).toBe('transcription-groq')
    expect(groqPlugin.inject).toEqual(['transcription'])
  })

  it('defaults the endpoint and model when the config omits them', async () => {
    const ctx = new Context()
    await ctx.plugin(TranscriptionRuntime, {})
    await ctx.plugin(groqPlugin, { apiKey: 'groq-key' })

    const { calls } = stubFetch(jsonResponse({ text: 'olá' }))
    await ctx.transcription.transcribe(request())

    expect(calls[0]![0]).toBe('https://api.groq.com/openai/v1/audio/transcriptions')
    expect((calls[0]![1].body as FormData).get('model')).toBe('whisper-large-v3-turbo')
  })
})
