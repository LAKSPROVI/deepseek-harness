/**
 * REAL-composition coverage for the transcription seam: a test-only cordis.yml
 * boots the Service Definition, the Groq provider, and the Remote Consumer
 * through the vendored Loader, and every assertion observes what one browser
 * upload gets back from `ctx.voiceInput.transcribe` — the user-visible value.
 *
 * Only Groq's HTTP endpoint is replaced, by a loopback server. The Loader,
 * Include tree, YAML parsing, Schemastery config validation, Cordis service
 * wiring, credential resolution, and the provider's own `fetch` all stay real.
 * `loader.internal.import` is the source-plane module map every
 * loader-composition suite in this repo uses: the Loader resolves through
 * Node, which would reach built `lib/` and load a second module singleton.
 */

import { createServer, type Server } from 'node:http'
import { Buffer } from 'node:buffer'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import TranscriptionRuntime from '@deepseek-ai/dsh-transcription'
import * as TranscriptionGroq from '@deepseek-ai/dsh-transcription-groq'
import VoiceInputService from '../src/index.ts'
import type { VoiceInputTranscribeRequest } from '../src/types.ts'

const DEFINITION = '@deepseek-ai/dsh-transcription'
const PROVIDER = '@deepseek-ai/dsh-transcription-groq'
const CONSUMER = '@deepseek-ai/dsh-voice-input'

const AUDIO = new Uint8Array([1, 2, 3, 4, 5])

const upload = (
  patch: Partial<VoiceInputTranscribeRequest> = {},
): VoiceInputTranscribeRequest => ({
  mediaType: 'audio/webm',
  data: Buffer.from(AUDIO).toString('base64'),
  ...patch,
})

/** One request the provider's real `fetch` delivered to the stub endpoint. */
interface StubRequest {
  readonly url: string
  readonly authorization: string | undefined
  readonly contentType: string | undefined
  readonly body: string
}

/** What the stub endpoint answers the next transcription with. */
interface StubReply {
  readonly status: number
  readonly body: string
}

/** The loopback stand-in for Groq's transcriptions endpoint. */
interface GroqStub {
  /** Endpoint base for the provider's `baseURL` config; `/audio/transcriptions` is appended. */
  readonly baseURL: string
  /** Every request that reached the endpoint, in arrival order. */
  readonly requests: readonly StubRequest[]
  /** Replace the reply served to subsequent requests. */
  answerWith(reply: StubReply): void
}

const servers: Server[] = []

/**
 * Start one loopback endpoint standing in for Groq.
 * @returns its base URL, the requests it received, and its reply control.
 */
async function startGroqStub(): Promise<GroqStub> {
  const requests: StubRequest[] = []
  let reply: StubReply = { status: 200, body: JSON.stringify({ text: 'stub transcript' }) }
  const server = createServer((request, response) => {
    const chunks: Buffer[] = []
    request.on('data', (chunk: Buffer) => { chunks.push(chunk) })
    request.on('end', () => {
      requests.push({
        url: request.url ?? '',
        authorization: request.headers.authorization,
        contentType: request.headers['content-type'],
        body: Buffer.concat(chunks).toString('utf8'),
      })
      response.writeHead(reply.status, { 'content-type': 'application/json' })
      response.end(reply.body)
    })
  })
  servers.push(server)
  await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', resolve) })
  const address = server.address()
  if (address === null || typeof address === 'string') {
    throw new Error('the Groq stub did not bind a TCP port')
  }
  return {
    baseURL: `http://127.0.0.1:${address.port}/openai/v1`,
    requests,
    answerWith: (next) => { reply = next },
  }
}

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  for (const server of servers.splice(0)) {
    server.closeAllConnections()
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error === undefined) resolve()
        else reject(error)
      })
    })
  }
  if (root !== undefined) await rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
  root = undefined
  vi.unstubAllEnvs()
})

/** Which rows the test-only cordis.yml carries. */
interface CompositionOptions {
  /** The seam's `provider` config; omitted leaves selection to auto-select. */
  readonly provider?: string
  /** The seam's `maxAudioBytes` config; omitted leaves the schema default. */
  readonly maxAudioBytes?: number
  /** Endpoint for the provider row; omitted mounts the Consumer with no provider at all. */
  readonly groqBaseURL?: string
}

/** Write the test-only cordis.yml and boot it through the real Loader. */
async function loadComposition(options: CompositionOptions = {}): Promise<Context> {
  root = await mkdtemp(join(tmpdir(), 'dsh-voice-input-loader-'))
  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, [
    `- name: '${DEFINITION}'`,
    ...options.provider === undefined && options.maxAudioBytes === undefined ? [] : ['  config:'],
    ...options.provider === undefined ? [] : [`    provider: ${JSON.stringify(options.provider)}`],
    ...options.maxAudioBytes === undefined ? [] : [`    maxAudioBytes: ${options.maxAudioBytes}`],
    ...options.groqBaseURL === undefined
      ? []
      : [
        `- name: '${PROVIDER}'`,
        '  config:',
        `    baseURL: ${JSON.stringify(options.groqBaseURL)}`,
      ],
    `- name: '${CONSUMER}'`,
    '',
  ].join('\n'))

  const ctx = new Context()
  context = ctx
  ctx.baseUrl = pathToFileURL(root).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    [DEFINITION, TranscriptionRuntime],
    [PROVIDER, TranscriptionGroq],
    [CONSUMER, VoiceInputService],
  ])
  ctx.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
      return modules.get(specifier)
    },
  } as unknown as NonNullable<typeof ctx.loader.internal>
  await ctx.loader.create({
    name: 'cordis:include',
    config: { path: pathToFileURL(configPath).href },
  })
  await ctx.loader.await()
  return ctx
}

/** Names of rows the Loader accepted but never brought up. */
function unloadedRows(ctx: Context): string[] {
  return [...ctx.loader.entries()]
    .filter(entry => entry.fiber === undefined && !entry.disabled)
    .map(entry => entry.options.name)
}

describe('the transcription seam assembled from a cordis.yml', () => {
  it('answers a browser upload with the transcript the provider endpoint returned', async () => {
    vi.stubEnv('GROQ_API_KEY', 'composition-key')
    const groq = await startGroqStub()
    groq.answerWith({ status: 200, body: JSON.stringify({ text: '  bom dia  ', language: 'pt' }) })
    const ctx = await loadComposition({ provider: 'groq', groqBaseURL: groq.baseURL })

    expect(unloadedRows(ctx)).toEqual([])
    expect(ctx.get('transcription')).toBeInstanceOf(TranscriptionRuntime)
    expect(ctx.get('voiceInput')).toBeInstanceOf(VoiceInputService)

    await expect(ctx.voiceInput.transcribe(upload({ language: 'pt' }))).resolves.toEqual({
      ok: true,
      value: { text: 'bom dia', language: 'pt' },
    })

    // One upload crossed Consumer, seam, and provider into a single HTTP call
    // carrying the credential the launch environment held.
    expect(groq.requests).toHaveLength(1)
    const [request] = groq.requests
    expect(request?.url).toBe('/openai/v1/audio/transcriptions')
    expect(request?.authorization).toBe('Bearer composition-key')
    expect(request?.contentType).toContain('multipart/form-data')
    expect(request?.body).toContain('whisper-large-v3-turbo')
    expect(request?.body).toContain('utterance.webm')
  })

  it('bounds the upload at the maxAudioBytes the cordis.yml set', async () => {
    vi.stubEnv('GROQ_API_KEY', 'composition-key')
    const groq = await startGroqStub()
    const ctx = await loadComposition({
      provider: 'groq',
      maxAudioBytes: AUDIO.byteLength - 1,
      groqBaseURL: groq.baseURL,
    })

    await expect(ctx.voiceInput.transcribe(upload())).resolves.toEqual({
      ok: false,
      error: { code: 'audio-too-large', actualBytes: AUDIO.byteLength },
    })
    expect(groq.requests).toEqual([])
  })

  it('accepts an upload at exactly the configured ceiling', async () => {
    vi.stubEnv('GROQ_API_KEY', 'composition-key')
    const groq = await startGroqStub()
    groq.answerWith({ status: 200, body: JSON.stringify({ text: 'at the ceiling' }) })
    const ctx = await loadComposition({
      provider: 'groq',
      maxAudioBytes: AUDIO.byteLength,
      groqBaseURL: groq.baseURL,
    })

    await expect(ctx.voiceInput.transcribe(upload())).resolves.toEqual({
      ok: true,
      value: { text: 'at the ceiling' },
    })
    expect(groq.requests).toHaveLength(1)
  })

  it('loads a composition whose configured provider is absent and fails at the first upload', async () => {
    vi.stubEnv('GROQ_API_KEY', 'composition-key')
    const groq = await startGroqStub()
    const ctx = await loadComposition({ provider: 'whisper-local', groqBaseURL: groq.baseURL })

    // Selection resolves per call, so naming an unmounted provider is not a
    // load-time failure: every row comes up and the seam is served.
    expect(unloadedRows(ctx)).toEqual([])
    expect(ctx.get('transcription')).toBeInstanceOf(TranscriptionRuntime)

    await expect(ctx.voiceInput.transcribe(upload())).resolves.toEqual({
      ok: false,
      error: {
        code: 'provider-unavailable',
        detail: 'configured transcription provider "whisper-local" is not registered',
      },
    })
    expect(groq.requests).toEqual([])
  })

  it('reports an unavailable provider when the Consumer is mounted with no provider row', async () => {
    const ctx = await loadComposition()

    expect(unloadedRows(ctx)).toEqual([])
    await expect(ctx.voiceInput.transcribe(upload())).resolves.toEqual({
      ok: false,
      error: {
        code: 'provider-unavailable',
        detail: 'no usable transcription provider is registered',
      },
    })
  })

  it('reports an unconfigured provider when the composition holds no credential', async () => {
    vi.stubEnv('GROQ_API_KEY', '')
    const groq = await startGroqStub()
    const ctx = await loadComposition({ provider: 'groq', groqBaseURL: groq.baseURL })

    const result = await ctx.voiceInput.transcribe(upload())
    expect(result).toMatchObject({ ok: false, error: { code: 'provider-unconfigured' } })
    expect(!result.ok && result.error.code === 'provider-unconfigured' && result.error.detail)
      .toContain('GROQ_API_KEY')
    expect(groq.requests).toEqual([])
  })

  it('forwards a refusal from the provider endpoint as a provider failure', async () => {
    vi.stubEnv('GROQ_API_KEY', 'composition-key')
    const groq = await startGroqStub()
    groq.answerWith({
      status: 429,
      body: JSON.stringify({ error: { message: 'Rate limit reached for whisper-large-v3-turbo' } }),
    })
    const ctx = await loadComposition({ provider: 'groq', groqBaseURL: groq.baseURL })

    await expect(ctx.voiceInput.transcribe(upload())).resolves.toEqual({
      ok: false,
      error: {
        code: 'provider-failed',
        detail: 'Rate limit reached for whisper-large-v3-turbo',
      },
    })
    expect(groq.requests).toHaveLength(1)
  })

  it('leaves the seam without a provider once the provider fiber is disposed', async () => {
    vi.stubEnv('GROQ_API_KEY', 'composition-key')
    const groq = await startGroqStub()
    groq.answerWith({ status: 200, body: JSON.stringify({ text: 'before disposal' }) })
    const ctx = await loadComposition({ groqBaseURL: groq.baseURL })

    await expect(ctx.voiceInput.transcribe(upload())).resolves.toEqual({
      ok: true,
      value: { text: 'before disposal' },
    })

    const entry = [...ctx.loader.entries()].find(row => row.options.name === PROVIDER)
    if (entry?.fiber === undefined) throw new Error(`expected a loaded ${PROVIDER} entry`)
    await entry.fiber.dispose()

    // The registration rode the provider's fiber, so the registry is empty
    // again while the seam and the Consumer keep serving.
    expect(ctx.get('transcription')).toBeInstanceOf(TranscriptionRuntime)
    await expect(ctx.voiceInput.transcribe(upload())).resolves.toEqual({
      ok: false,
      error: {
        code: 'provider-unavailable',
        detail: 'no usable transcription provider is registered',
      },
    })
    expect(groq.requests).toHaveLength(1)
  })
})
