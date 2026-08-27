/**
 * Service Definition for the transcription capability seam (`ctx.transcription`):
 * a provider registry plus provider-selecting execution for speech-to-text.
 * Duplicate ids are rejected. At execution time a configured provider must exist
 * and be usable; without one, exactly one usable provider is required, so
 * selection never depends on registration order.
 *
 * The seam owns the payload bound: it rejects an oversized or empty utterance
 * before any provider is dispatched, because only the caller-facing entry point
 * knows the complete payload.
 * @module @deepseek-ai/dsh-transcription
 */

import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { TranscriptionProvider, TranscriptionRequest, TranscriptionResult } from './types.ts'
import { TranscriptionError } from './types.ts'

export { TranscriptionError } from './types.ts'
export type {
  TranscriptionAudioFormat,
  TranscriptionProvider,
  TranscriptionRequest,
  TranscriptionResult,
} from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    transcription: TranscriptionRuntime
  }
}

/**
 * Default payload ceiling: 25 MiB, the smallest documented per-request upload
 * limit among the speech APIs this seam targets. Deployments that front a
 * different backend set `maxAudioBytes` rather than relying on this value.
 */
export const DEFAULT_MAX_AUDIO_BYTES = 25 * 1024 * 1024

/**
 * Config for the transcription seam. `provider` pins which backend wins; omitted,
 * a single registered usable provider auto-selects. `maxAudioBytes` is the
 * payload ceiling enforced before dispatch.
 */
export interface TranscriptionRuntimeConfig {
  /** Explicit provider id. Omitted = auto-select when exactly one usable. */
  readonly provider?: string
  /** Positive-integer ceiling on one request's audio bytes. */
  readonly maxAudioBytes?: number
}

/**
 * The transcription service. Registered as `ctx.transcription` (one instance per
 * context).
 *
 * Selection semantics (resolved at execution time, never order-dependent):
 * - A configured id that is registered and `available()` → that provider.
 * - A configured id not registered → `TRANSCRIPTION_PROVIDER_CONFIGURED_MISSING`.
 * - A configured id registered but unavailable →
 *   `TRANSCRIPTION_PROVIDER_CONFIGURED_UNAVAILABLE`.
 * - No id configured, exactly one registered usable provider → that provider.
 * - No id configured, multiple usable providers → `TRANSCRIPTION_PROVIDER_AMBIGUOUS`.
 * - No id configured, no usable provider → `TRANSCRIPTION_PROVIDER_UNAVAILABLE`.
 */
export class TranscriptionRuntime extends Service {
  /** Provider selection and payload-bound config. */
  static Config: z<TranscriptionRuntimeConfig> = z.object({
    provider: z.string(),
    maxAudioBytes: z.number().step(1).min(1).default(DEFAULT_MAX_AUDIO_BYTES),
  })

  private providers = new Map<string, TranscriptionProvider>()
  private readonly providerId: string | undefined
  private readonly maxAudioBytes: number

  constructor(ctx: Context, config: TranscriptionRuntimeConfig = {}) {
    super(ctx, 'transcription')
    this.providerId = config.provider
    this.maxAudioBytes = config.maxAudioBytes ?? DEFAULT_MAX_AUDIO_BYTES
  }

  /**
   * Register a speech-to-text provider. Throws {@link TranscriptionError}
   * `TRANSCRIPTION_DUPLICATE_PROVIDER` if its id is already registered. Returns a
   * disposer; disposed with the calling fiber.
   * @param provider - the provider; its `id` is the registry key.
   * @returns the disposer that unregisters the provider.
   */
  registerProvider(provider: TranscriptionProvider): () => void {
    if (this.providers.has(provider.id)) {
      throw new TranscriptionError(
        `a transcription provider with id "${provider.id}" is already registered`,
        'TRANSCRIPTION_DUPLICATE_PROVIDER',
      )
    }
    const providers = this.providers
    const dispose = this.ctx.effect(function* () {
      providers.set(provider.id, provider)
      yield () => providers.delete(provider.id)
    }, 'transcription.registerProvider()')
    // ctx.effect's disposer returns Promise<void>; our disposer API is
    // synchronous fire-and-forget — discard the (always-resolved) promise.
    return () => void dispose()
  }

  /**
   * Transcribe one utterance through the selected provider. Enforces the payload
   * bound and rejects an empty payload before dispatch, resolves the provider
   * with the selection rules above, and trims the returned transcript. Throws
   * {@link TranscriptionError} when the capability cannot run.
   * @param request - the audio payload, its format, and an optional language hint.
   * @param signal - optional cancellation signal forwarded to the provider.
   * @returns the transcript, with surrounding whitespace removed.
   */
  async transcribe(request: TranscriptionRequest, signal?: AbortSignal): Promise<TranscriptionResult> {
    if (request.audio.byteLength === 0) {
      throw new TranscriptionError('the transcription request carries no audio', 'TRANSCRIPTION_AUDIO_EMPTY')
    }
    if (request.audio.byteLength > this.maxAudioBytes) {
      throw new TranscriptionError(
        `audio payload is ${request.audio.byteLength} bytes, above the ${this.maxAudioBytes}-byte ceiling`,
        'TRANSCRIPTION_AUDIO_TOO_LARGE',
      )
    }
    const provider = resolveProvider(this.providers, this.providerId)
    const result = await provider.transcribe(request, signal)
    const text = result.text.trim()
    return text === result.text ? result : { ...result, text }
  }
}

/** Resolve the selected provider or throw the matching {@link TranscriptionError}. */
function resolveProvider(
  providers: ReadonlyMap<string, TranscriptionProvider>,
  configuredId: string | undefined,
): TranscriptionProvider {
  if (configuredId !== undefined) {
    const provider = providers.get(configuredId)
    if (!provider) {
      throw new TranscriptionError(
        `configured transcription provider "${configuredId}" is not registered`,
        'TRANSCRIPTION_PROVIDER_CONFIGURED_MISSING',
      )
    }
    if (!provider.available()) {
      throw new TranscriptionError(
        `configured transcription provider "${configuredId}" is registered but unavailable`,
        'TRANSCRIPTION_PROVIDER_CONFIGURED_UNAVAILABLE',
      )
    }
    return provider
  }
  const usable = [...providers.values()].filter(provider => provider.available())
  const [single] = usable
  if (single === undefined) {
    throw new TranscriptionError(
      'no usable transcription provider is registered',
      'TRANSCRIPTION_PROVIDER_UNAVAILABLE',
    )
  }
  if (usable.length > 1) {
    const ids = usable.map(provider => provider.id).join(', ')
    throw new TranscriptionError(
      `multiple usable transcription providers are registered (${ids}); configure one explicitly`,
      'TRANSCRIPTION_PROVIDER_AMBIGUOUS',
    )
  }
  return single
}

export default TranscriptionRuntime
