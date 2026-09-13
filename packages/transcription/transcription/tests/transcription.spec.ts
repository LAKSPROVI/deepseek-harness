import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import TranscriptionRuntime, {
  DEFAULT_MAX_AUDIO_BYTES,
  TranscriptionError,
  type TranscriptionProvider,
  type TranscriptionRequest,
  type TranscriptionResult,
} from '@deepseek-ai/dsh-transcription'
import * as invariantCompanion from '@deepseek-ai/dsh-transcription/invariant'

const available = true
const unavailable = false

/** A scripted provider for contract tests. */
function makeProvider(
  id: string,
  usable: boolean,
  transcribe: (request: TranscriptionRequest, signal?: AbortSignal) => Promise<TranscriptionResult>,
): TranscriptionProvider {
  return { id, available: () => usable, transcribe: (request, signal) => transcribe(request, signal) }
}

/** A provider that always answers with the same transcript. */
function fixedProvider(id: string, text: string, usable = available): TranscriptionProvider {
  return makeProvider(id, usable, () => Promise.resolve({ text }))
}

const audio = (bytes = 8): Uint8Array => new Uint8Array(bytes).fill(1)

const request = (overrides: Partial<TranscriptionRequest> = {}): TranscriptionRequest => ({
  audio: audio(),
  format: 'audio/webm',
  ...overrides,
})

/** Mount a TranscriptionRuntime on a fresh root context with the given config. */
async function mount(
  config: ConstructorParameters<typeof TranscriptionRuntime>[1] = {},
): Promise<{ ctx: Context; transcription: TranscriptionRuntime }> {
  const ctx = new Context()
  await ctx.plugin(TranscriptionRuntime, config)
  return { ctx, transcription: ctx.transcription }
}

describe('TranscriptionRuntime registration', () => {
  it('registers a provider and unregisters it via the returned disposer', async () => {
    const { transcription } = await mount()

    const dispose = transcription.registerProvider(fixedProvider('groq', 'olá'))
    await expect(transcription.transcribe(request())).resolves.toEqual({ text: 'olá' })

    dispose()
    await expect(transcription.transcribe(request())).rejects.toThrow(
      expect.objectContaining({ code: 'TRANSCRIPTION_PROVIDER_UNAVAILABLE' }),
    )
  })

  it('throws TRANSCRIPTION_DUPLICATE_PROVIDER on a duplicate id', async () => {
    const { transcription } = await mount()
    transcription.registerProvider(fixedProvider('groq', 'first'))
    expect(() => transcription.registerProvider(fixedProvider('groq', 'second')))
      .toThrow(expect.objectContaining({ code: 'TRANSCRIPTION_DUPLICATE_PROVIDER' }))
  })

  it('disposes provider registrations when the contributing fiber is disposed (HMR safety)', async () => {
    const { ctx, transcription } = await mount()
    const fiber = await ctx.plugin(Object.assign((inner: Context) => {
      inner.transcription.registerProvider(fixedProvider('groq', 'olá'))
    }, { inject: ['transcription'] }))
    await expect(transcription.transcribe(request())).resolves.toEqual({ text: 'olá' })

    await fiber.dispose()
    await expect(transcription.transcribe(request())).rejects.toThrow(
      expect.objectContaining({ code: 'TRANSCRIPTION_PROVIDER_UNAVAILABLE' }),
    )
  })
})

describe('TranscriptionRuntime payload bounds', () => {
  it('rejects an empty payload before selecting a provider', async () => {
    const { transcription } = await mount()
    const transcribe = vi.fn(() => Promise.resolve({ text: 'unreachable' }))
    transcription.registerProvider(makeProvider('groq', available, transcribe))

    await expect(transcription.transcribe(request({ audio: new Uint8Array(0) }))).rejects.toThrow(
      expect.objectContaining({ code: 'TRANSCRIPTION_AUDIO_EMPTY' }),
    )
    expect(transcribe).not.toHaveBeenCalled()
  })

  it('rejects a payload above the configured ceiling without dispatching', async () => {
    const { transcription } = await mount({ maxAudioBytes: 4 })
    const transcribe = vi.fn(() => Promise.resolve({ text: 'unreachable' }))
    transcription.registerProvider(makeProvider('groq', available, transcribe))

    await expect(transcription.transcribe(request({ audio: audio(5) }))).rejects.toThrow(
      expect.objectContaining({ code: 'TRANSCRIPTION_AUDIO_TOO_LARGE' }),
    )
    expect(transcribe).not.toHaveBeenCalled()
  })

  it('accepts a payload of exactly the ceiling', async () => {
    const { transcription } = await mount({ maxAudioBytes: 4 })
    transcription.registerProvider(fixedProvider('groq', 'exact'))
    await expect(transcription.transcribe(request({ audio: audio(4) }))).resolves.toEqual({ text: 'exact' })
  })

  it('applies DEFAULT_MAX_AUDIO_BYTES through the constructor default when no config is supplied', async () => {
    const runtime = new TranscriptionRuntime(new Context())
    runtime.registerProvider(fixedProvider('groq', 'ok'))

    await expect(runtime.transcribe(request({ audio: audio(DEFAULT_MAX_AUDIO_BYTES + 1) }))).rejects.toThrow(
      expect.objectContaining({ code: 'TRANSCRIPTION_AUDIO_TOO_LARGE' }),
    )
    await expect(runtime.transcribe(request())).resolves.toEqual({ text: 'ok' })
  })

  it('applies DEFAULT_MAX_AUDIO_BYTES when the config omits a ceiling', async () => {
    const { transcription } = await mount()
    transcription.registerProvider(fixedProvider('groq', 'ok'))
    await expect(transcription.transcribe(request({ audio: audio(DEFAULT_MAX_AUDIO_BYTES + 1) }))).rejects.toThrow(
      expect.objectContaining({ code: 'TRANSCRIPTION_AUDIO_TOO_LARGE' }),
    )
  })
})

describe('TranscriptionRuntime execution resolution', () => {
  it('throws TRANSCRIPTION_PROVIDER_UNAVAILABLE when nothing is registered', async () => {
    const { transcription } = await mount()
    await expect(transcription.transcribe(request())).rejects.toThrow(
      expect.objectContaining({ code: 'TRANSCRIPTION_PROVIDER_UNAVAILABLE' }),
    )
  })

  it('throws TRANSCRIPTION_PROVIDER_UNAVAILABLE when providers exist but none are usable', async () => {
    const { transcription } = await mount()
    transcription.registerProvider(fixedProvider('groq', 'x', unavailable))
    await expect(transcription.transcribe(request())).rejects.toThrow(
      expect.objectContaining({ code: 'TRANSCRIPTION_PROVIDER_UNAVAILABLE' }),
    )
  })

  it('throws TRANSCRIPTION_PROVIDER_CONFIGURED_MISSING for an unregistered configured id', async () => {
    const { transcription } = await mount({ provider: 'local' })
    transcription.registerProvider(fixedProvider('groq', 'x'))
    await expect(transcription.transcribe(request())).rejects.toThrow(
      expect.objectContaining({ code: 'TRANSCRIPTION_PROVIDER_CONFIGURED_MISSING' }),
    )
  })

  it('throws TRANSCRIPTION_PROVIDER_CONFIGURED_UNAVAILABLE for an unusable configured id', async () => {
    const { transcription } = await mount({ provider: 'groq' })
    transcription.registerProvider(fixedProvider('groq', 'x', unavailable))
    await expect(transcription.transcribe(request())).rejects.toThrow(
      expect.objectContaining({ code: 'TRANSCRIPTION_PROVIDER_CONFIGURED_UNAVAILABLE' }),
    )
  })

  it('throws TRANSCRIPTION_PROVIDER_AMBIGUOUS rather than picking by order', async () => {
    const { transcription } = await mount()
    transcription.registerProvider(fixedProvider('groq', 'a'))
    transcription.registerProvider(fixedProvider('local', 'b'))
    await expect(transcription.transcribe(request())).rejects.toThrow(
      expect.objectContaining({ code: 'TRANSCRIPTION_PROVIDER_AMBIGUOUS' }),
    )
  })

  it('selects the configured provider when several are usable', async () => {
    const { transcription } = await mount({ provider: 'local' })
    transcription.registerProvider(fixedProvider('groq', 'from groq'))
    transcription.registerProvider(fixedProvider('local', 'from local'))
    await expect(transcription.transcribe(request())).resolves.toEqual({ text: 'from local' })
  })

  it('ignores unusable providers when exactly one is usable', async () => {
    const { transcription } = await mount()
    transcription.registerProvider(fixedProvider('groq', 'usable'))
    transcription.registerProvider(fixedProvider('local', 'unusable', unavailable))
    await expect(transcription.transcribe(request())).resolves.toEqual({ text: 'usable' })
  })
})

describe('TranscriptionRuntime result handling', () => {
  it('trims surrounding whitespace from the transcript', async () => {
    const { transcription } = await mount()
    transcription.registerProvider(fixedProvider('groq', '  olá mundo \n'))
    await expect(transcription.transcribe(request())).resolves.toEqual({ text: 'olá mundo' })
  })

  it('preserves the provider result object when no trimming is needed', async () => {
    const { transcription } = await mount()
    const result: TranscriptionResult = { text: 'exato', language: 'pt' }
    transcription.registerProvider(makeProvider('groq', available, () => Promise.resolve(result)))
    await expect(transcription.transcribe(request())).resolves.toBe(result)
  })

  it('keeps a reported language while trimming the transcript', async () => {
    const { transcription } = await mount()
    transcription.registerProvider(makeProvider('groq', available, () => Promise.resolve({ text: ' oi ', language: 'pt' })))
    await expect(transcription.transcribe(request())).resolves.toEqual({ text: 'oi', language: 'pt' })
  })

  it('forwards the request and the abort signal to the provider unchanged', async () => {
    const { transcription } = await mount()
    const seen: { request?: TranscriptionRequest; signal?: AbortSignal | undefined } = {}
    transcription.registerProvider(makeProvider('groq', available, (req, signal) => {
      seen.request = req
      seen.signal = signal
      return Promise.resolve({ text: 'ok' })
    }))
    const controller = new AbortController()
    const sent = request({ format: 'audio/wav', language: 'pt' })

    await transcription.transcribe(sent, controller.signal)

    expect(seen.request).toBe(sent)
    expect(seen.signal).toBe(controller.signal)
  })

  it('propagates a provider failure unchanged', async () => {
    const { transcription } = await mount()
    const failure = new TranscriptionError('backend exploded', 'TRANSCRIPTION_PROVIDER_ERROR')
    transcription.registerProvider(makeProvider('groq', available, () => Promise.reject(failure)))
    await expect(transcription.transcribe(request())).rejects.toBe(failure)
  })
})

describe('transcription invariant companion', () => {
  it('reserves package ownership without installing a check', async () => {
    const register = vi.fn(() => () => {})
    const ctx = { invariants: { register } } as unknown as Context

    const dispose = await invariantCompanion.apply(ctx)

    expect(register).toHaveBeenCalledWith('@deepseek-ai/dsh-transcription', expect.any(Function))
    const [, installer] = register.mock.calls[0] as unknown as [string, (arg: unknown) => void]
    expect(() => {
      installer(undefined)
    }).not.toThrow()
    expect(dispose).toBeTypeOf('function')
  })
})
