/**
 * Register a Groq-backed provider in `ctx.transcription`. It calls Groq's
 * OpenAI-compatible transcriptions endpoint with a Whisper model. The credential
 * reference is resolved per transcription through the optional `ctx.credentials`
 * seam, so a key stored or rotated after boot reaches the next call without a
 * restart.
 * @module @deepseek-ai/dsh-transcription-groq
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type {} from '@deepseek-ai/dsh-settings'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import type {} from '@deepseek-ai/dsh-transcription'
import {
  GROQ_DEFAULT_BASE_URL,
  GROQ_DEFAULT_MODEL,
  GroqTranscriptionProvider,
} from './provider.ts'
import type { GroqTranscriptionProviderOptions } from './provider.ts'

export {
  GROQ_DEFAULT_BASE_URL,
  GROQ_DEFAULT_MODEL,
  GROQ_PROVIDER_ID,
  GroqTranscriptionProvider,
  mapGroqResponse,
} from './provider.ts'
export type { GroqTranscriptionProviderOptions } from './provider.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'transcription-groq'

/** The transcription seam this provider registers into. */
export const inject = ['transcription']

const DEFAULT_API_KEY_ENV = 'GROQ_API_KEY'

/** Environment variable naming this provider's endpoint. */
const BASE_URL_ENV = 'GROQ_BASE_URL'

/** Plugin config (all optional — `apply` fills env-var and constant defaults). */
export interface Config {
  /** Literal Groq API key; prefer {@link Config.apiKeyEnv} so no secret enters configuration files. */
  apiKey?: string
  /** Credential reference resolved for each transcription; defaults to `GROQ_API_KEY`. */
  apiKeyEnv?: string
  /** OpenAI-compatible endpoint base; `/audio/transcriptions` is appended. */
  baseURL?: string
  /** Groq transcription model name. Defaults to `whisper-large-v3-turbo`. */
  model?: string
  /** Language hint used when a request carries none, e.g. `pt`. */
  defaultLanguage?: string
}

export const Config: z<Config> = z.object({
  apiKey: z.string().role('secret'),
  apiKeyEnv: z.string().role('credential-ref').default(DEFAULT_API_KEY_ENV),
  // Declared here rather than only at the use site: a configuration surface
  // renders the resolved section, so a default the schema does not carry reads
  // there as no value at all.
  baseURL: z.string(),
  model: z.string().default(GROQ_DEFAULT_MODEL),
  defaultLanguage: z.string(),
})

/** Settings namespace carrying this provider's endpoint, model, and key reference. */
export const TRANSCRIPTION_GROQ_SETTINGS_NAMESPACE = 'transcription-groq'

/**
 * Project one resolved section into the options the provider serves its next
 * transcription with. Environment fallbacks stay here rather than in the
 * provider: every value it reads is already fully defaulted.
 * @param ctx - plugin context supplying the credential and environment planes.
 * @param config - the currently authoritative section.
 * @returns options for one transcription.
 */
function resolveOptions(ctx: Context, config: Config): GroqTranscriptionProviderOptions {
  const apiKeyEnv = credentialRef(config.apiKeyEnv ?? DEFAULT_API_KEY_ENV)
  const literalApiKey = config.apiKey !== undefined && config.apiKey.length > 0
    ? config.apiKey
    : undefined
  const defaultLanguage = config.defaultLanguage
  return {
    ...literalApiKey === undefined ? {} : { apiKey: literalApiKey },
    resolveApiKey: async () => {
      const credentials = ctx.get('credentials')
      if (credentials !== undefined) return (await credentials.resolve(apiKeyEnv))?.value
      // Without the seam the environment is the whole credential plane.
      const ambient = launchEnvironmentOf(ctx).get(apiKeyEnv)
      return ambient !== undefined && ambient.value.length > 0 ? ambient.value : undefined
    },
    apiKeyEnv,
    baseURL: config.baseURL
      ?? launchEnvironmentOf(ctx).get(BASE_URL_ENV)?.value
      ?? GROQ_DEFAULT_BASE_URL,
    model: config.model ?? GROQ_DEFAULT_MODEL,
    ...defaultLanguage === undefined || defaultLanguage.length === 0 ? {} : { defaultLanguage },
  }
}

/** Register the Groq transcription provider with `ctx.transcription`. */
export function apply(ctx: Context, config: Config): void {
  let current: () => Config = () => config
  ctx.inject(['settings'], (settingsCtx) => {
    settingsCtx.settings.installSection(ctx, TRANSCRIPTION_GROQ_SETTINGS_NAMESPACE, Config, config, {
      setSource: (source: () => Config) => {
        current = source
      },
      // The registration carries no resolved value: the provider projects the
      // section per call, so a committed change needs no re-registration.
      onChange: () => {},
    })
  })
  ctx.transcription.registerProvider(new GroqTranscriptionProvider(() => resolveOptions(ctx, current())))
}
