/**
 * Groq-backed speech-to-text through the OpenAI-compatible transcriptions endpoint
 * (`POST {baseURL}/audio/transcriptions`, `multipart/form-data`). The wire format and
 * native `fetch` client are provider-private; this provider does not use `ctx.llm`.
 * @module @deepseek-ai/dsh-transcription-groq/provider
 */

import { TranscriptionError } from '@deepseek-ai/dsh-transcription'
import type {
  TranscriptionAudioFormat,
  TranscriptionProvider,
  TranscriptionRequest,
  TranscriptionResult,
} from '@deepseek-ai/dsh-transcription'
import type { CredentialRef } from '@deepseek-ai/dsh-credentials'

/** Stable id this provider registers under. */
export const GROQ_PROVIDER_ID = 'groq'

/**
 * Default endpoint base, `/openai/v1` included (`/audio/transcriptions` is
 * appended). Groq serves its OpenAI-compatible surface under `/openai/v1`, not
 * `/v1`: pointing at the bare host yields 404 for every request.
 */
export const GROQ_DEFAULT_BASE_URL = 'https://api.groq.com/openai/v1'

/**
 * Default model. `whisper-large-v3-turbo` is the cost/latency choice; the
 * non-turbo `whisper-large-v3` trades throughput for marginal accuracy.
 */
export const GROQ_DEFAULT_MODEL = 'whisper-large-v3-turbo'

/** Attribution header sent on every request. Bump with the package version. */
const USER_AGENT = 'deepseek-harness/0.0.1'

/** Filename extension the multipart part carries per accepted container format. */
const FORMAT_EXTENSIONS: Readonly<Record<TranscriptionAudioFormat, string>> = {
  'audio/webm': 'webm',
  'audio/ogg': 'ogg',
  'audio/wav': 'wav',
  'audio/mp4': 'mp4',
  'audio/mpeg': 'mp3',
}

/** Resolved provider options (the plugin's `apply` supplies credential and constant defaults). */
export interface GroqTranscriptionProviderOptions {
  /** Literal Groq API key; when present it wins over {@link GroqTranscriptionProviderOptions.resolveApiKey}. */
  apiKey?: string
  /** Resolve the current Groq API key for one transcription. */
  resolveApiKey?: () => Promise<string | undefined>
  /** Credential reference named by missing-credential diagnostics. */
  apiKeyEnv?: CredentialRef
  /** Endpoint base; `/audio/transcriptions` is appended. */
  baseURL: string
  /** Groq transcription model name. */
  model: string
  /**
   * Language sent when the request carries no hint. Omitted leaves detection to
   * the provider; a fixed hint measurably improves short-utterance accuracy.
   */
  defaultLanguage?: string
}

/** The JSON body Groq returns for `response_format=verbose_json`. */
interface GroqTranscriptionResponse {
  readonly text?: string
  readonly language?: string
}

/** The error body Groq returns for a non-2xx transcription response. */
interface GroqErrorResponse {
  readonly error?: { readonly message?: string } | string
  readonly message?: string
}

/**
 * Map a Groq transcriptions response to the seam's result. A response without a
 * `text` member is unprocessable rather than an empty transcript: silence
 * returns an empty string, so a missing member means the wire format changed.
 * @param response - the parsed response body.
 * @returns the normalized transcript and reported language.
 * @throws {@link TranscriptionError} when the body carries no `text` member.
 */
export function mapGroqResponse(response: GroqTranscriptionResponse): TranscriptionResult {
  if (typeof response.text !== 'string') {
    throw new TranscriptionError(
      'Groq returned a transcription body without a "text" member',
      'TRANSCRIPTION_PROVIDER_ERROR',
    )
  }
  return {
    text: response.text,
    ...response.language !== undefined && response.language.length > 0
      ? { language: response.language }
      : {},
  }
}

/** The Groq-backed transcription provider; HTTP redirects fail as `TRANSCRIPTION_PROVIDER_ERROR`. */
export class GroqTranscriptionProvider implements TranscriptionProvider {
  readonly id = GROQ_PROVIDER_ID

  /**
   * @param resolveOptions - the options for the NEXT operation, snapshotted once
   * at each operation's entry so one transcription never mixes two sections. A
   * thunk rather than a value because the plugin's settings section can change
   * between calls, and re-registering the provider to carry a new endpoint would
   * make the seam's selection observable to the user as a flicker.
   */
  constructor(private readonly resolveOptions: () => GroqTranscriptionProviderOptions) {}

  available(): boolean {
    const options = this.resolveOptions()
    return ((options.apiKey?.length ?? 0) > 0 || options.resolveApiKey !== undefined)
      && URL.canParse(options.baseURL)
      && options.model.length > 0
  }

  async transcribe(request: TranscriptionRequest, signal?: AbortSignal): Promise<TranscriptionResult> {
    // One snapshot for the whole operation: credential resolution awaits, and a
    // settings write landing inside that await must not send the key resolved
    // from the old section to the endpoint named by the new one.
    const options = this.resolveOptions()
    const apiKey = await this.apiKey(options, signal)
    throwIfAborted(signal)

    const endpoint = `${options.baseURL}/audio/transcriptions`
    const language = request.language ?? options.defaultLanguage
    const form = new FormData()
    form.append(
      'file',
      new Blob([request.audio as BlobPart], { type: request.format }),
      `utterance.${FORMAT_EXTENSIONS[request.format]}`,
    )
    form.append('model', options.model)
    form.append('response_format', 'verbose_json')
    if (language !== undefined && language.length > 0) form.append('language', language)

    let response: Response
    try {
      response = await fetch(endpoint, {
        method: 'POST',
        redirect: 'error',
        headers: {
          'authorization': `Bearer ${apiKey}`,
          'accept': 'application/json',
          'user-agent': USER_AGENT,
        },
        body: form,
        ...signal !== undefined ? { signal } : {},
      })
    } catch (error: unknown) {
      if (signal?.aborted === true || isAbortError(error)) throw aborted(signal, error)
      throw new TranscriptionError(
        `Groq transcription request failed: ${String(error)}`,
        'TRANSCRIPTION_PROVIDER_ERROR',
        { cause: error },
      )
    }

    if (!response.ok) {
      const status = response.status
      let message = `Groq API error (HTTP ${status})`
      try {
        const parsed = await response.json() as GroqErrorResponse
        const detail = typeof parsed.error === 'string' ? parsed.error : parsed.error?.message ?? parsed.message
        if (detail !== undefined && detail.length > 0) message = detail
      } catch (error: unknown) {
        // An abort fired mid-body must surface as cancellation, not be swallowed
        // into a generic HTTP-error message.
        if (signal?.aborted === true || isAbortError(error)) throw aborted(signal, error)
        // Otherwise: the HTTP status is already captured in `message` above; a
        // malformed or non-JSON error body (normal for gateway 5xx/429s) can only
        // cost a richer provider message, never the real error.
      }
      // 429 from Groq is a real, temporary rate limit; the code stays generic so
      // callers route on it uniformly, and the message carries the distinction.
      throw new TranscriptionError(message, 'TRANSCRIPTION_PROVIDER_ERROR')
    }

    try {
      const payload = await response.json() as GroqTranscriptionResponse
      return mapGroqResponse(payload)
    } catch (error: unknown) {
      if (signal?.aborted === true || isAbortError(error)) throw aborted(signal, error)
      if (error instanceof TranscriptionError) throw error
      throw new TranscriptionError(
        `Groq returned an unprocessable response body: ${String(error)}`,
        'TRANSCRIPTION_PROVIDER_ERROR',
        { cause: error },
      )
    }
  }

  // Credential resolution and the abort helpers below mirror
  // packages/web/web-search-deepseek/src/provider.ts; per-package copies are
  // the repository convention (lsp-stdio keeps its own abortable too).
  /* jscpd:ignore-start */
  /**
   * Resolve one operation's credential without retaining it on the provider.
   * @param options - the caller's snapshot, so the key and the endpoint it is sent to come from one section.
   * @param signal - abort signal for the surrounding transcription.
   * @returns the resolved key.
   */
  private async apiKey(options: GroqTranscriptionProviderOptions, signal?: AbortSignal): Promise<string> {
    throwIfAborted(signal)
    if (options.apiKey !== undefined && options.apiKey.length > 0) return options.apiKey
    let resolved: string | undefined
    try {
      resolved = await abortable(options.resolveApiKey?.() ?? Promise.resolve(undefined), signal)
    } catch (error: unknown) {
      if (signal?.aborted === true || isAbortError(error)) throw aborted(signal, error)
      throw new TranscriptionError(
        `Groq credential resolution failed: ${String(error)}`,
        'TRANSCRIPTION_PROVIDER_ERROR',
        { cause: error },
      )
    }
    if (resolved !== undefined && resolved.length > 0) return resolved
    const ref = options.apiKeyEnv ?? 'GROQ_API_KEY'
    throw new TranscriptionError(
      `Groq transcription has no API key for "${ref}"; store it through the credentials service,`
      + ' export it in the launching environment, or set a literal "apiKey" in the'
      + ' transcription-groq config',
      'TRANSCRIPTION_CREDENTIAL_MISSING',
    )
  }
}

/**
 * Race a same-process asynchronous preflight against caller cancellation. The
 * attached settlement handlers keep observing an uncooperative operation after
 * abort so a later rejection cannot become unhandled.
 */
function abortable<T>(operation: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (signal === undefined) return operation
  if (signal.aborted) return Promise.reject(aborted(signal))
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => { reject(aborted(signal)) }
    signal.addEventListener('abort', onAbort, { once: true })
    void operation.then(
      (value) => {
        signal.removeEventListener('abort', onAbort)
        resolve(value)
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort)
        reject(new Error(String(error).replace(/^Error: /u, ''), { cause: error }))
      },
    )
  })
}

/** Throw the provider's stable cancellation error when the caller already aborted. */
function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted === true) throw aborted(signal)
}
/* jscpd:ignore-end */

/** Build the provider's stable cancellation error while retaining the caller's reason. */
function aborted(signal?: AbortSignal, fallback?: unknown): TranscriptionError {
  return new TranscriptionError('Groq transcription aborted', 'TRANSCRIPTION_ABORTED', {
    cause: signal?.aborted === true ? signal.reason : fallback,
  })
}

/** Recognize a fetch/stream abort rejection without depending on its concrete class. */
function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}
