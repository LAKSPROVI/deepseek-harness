/** The `transcription-groq` settings section layered over the composition entry. */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Fiber } from '@deepseek-ai/cordis'
import { SettingsProvider } from '@deepseek-ai/dsh-settings'
import type { SettingsNamespace } from '@deepseek-ai/dsh-settings'
import TranscriptionRuntime from '@deepseek-ai/dsh-transcription'
import type { TranscriptionRequest } from '@deepseek-ai/dsh-transcription'
import * as groqPlugin from '@deepseek-ai/dsh-transcription-groq'
import { GROQ_PROVIDER_ID, TRANSCRIPTION_GROQ_SETTINGS_NAMESPACE } from '@deepseek-ai/dsh-transcription-groq'

/** The smallest real provider: one in-memory document, always writable. */
class MemorySettings extends SettingsProvider {
  doc: Record<string, unknown> = {}

  get writable(): boolean {
    return true
  }

  protected load(): Promise<Record<string, unknown>> {
    return Promise.resolve(structuredClone(this.doc))
  }

  protected persist(ns: SettingsNamespace, section: Record<string, unknown>): Promise<void> {
    this.doc = { ...this.doc, [ns]: structuredClone(section) }
    return Promise.resolve()
  }
}

const request = (): TranscriptionRequest => ({ audio: new Uint8Array([1, 2, 3, 4]), format: 'audio/webm' })

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
}

async function boot(): Promise<{ ctx: Context; settingsFiber: Fiber; pluginFiber: Fiber }> {
  const ctx = new Context()
  await ctx.plugin(TranscriptionRuntime, { provider: GROQ_PROVIDER_ID })
  const settingsFiber = ctx.plugin(MemorySettings)
  await settingsFiber.await()
  const pluginFiber = ctx.plugin(groqPlugin, {
    apiKey: 'groq-key',
    baseURL: 'https://groq.entry.test/openai/v1',
  })
  await pluginFiber.await()
  return { ctx, settingsFiber, pluginFiber }
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

/**
 * Run one transcription and answer the endpoint it reached. A fresh `Response`
 * per call because a body can only be read once.
 * @param ctx - context whose `ctx.transcription` serves the call.
 * @returns the URL the provider fetched.
 */
async function transcribeOnce(ctx: Context): Promise<string> {
  const fetchSpy = vi.spyOn(globalThis, 'fetch')
    .mockImplementation(() => Promise.resolve(jsonResponse({ text: 'olá' })))
  fetchSpy.mockClear()
  await ctx.transcription.transcribe(request())
  return String((fetchSpy.mock.calls.at(-1)?.[0] as URL | string | undefined) ?? '')
}

describe('transcription-groq settings section', () => {
  it('serves a stored endpoint to the next transcription without re-registering the provider', async () => {
    const bench = await boot()
    expect(await transcribeOnce(bench.ctx)).toContain('https://groq.entry.test/openai/v1')

    await bench.ctx.settings.update(TRANSCRIPTION_GROQ_SETTINGS_NAMESPACE, {
      baseURL: 'https://groq.stored.test/openai/v1',
    })

    expect(await transcribeOnce(bench.ctx)).toContain('https://groq.stored.test/openai/v1')
    await bench.ctx.fiber.dispose()
  })

  it('serves a stored model to the next transcription', async () => {
    const bench = await boot()
    await bench.ctx.settings.update(TRANSCRIPTION_GROQ_SETTINGS_NAMESPACE, { model: 'whisper-large-v3' })

    const fetchSpy = vi.spyOn(globalThis, 'fetch')
      .mockImplementation(() => Promise.resolve(jsonResponse({ text: 'olá' })))
    await bench.ctx.transcription.transcribe(request())

    const [, init] = fetchSpy.mock.calls.at(-1) as unknown as [string, RequestInit]
    expect((init.body as FormData).get('model')).toBe('whisper-large-v3')
    await bench.ctx.fiber.dispose()
  })

  it('keeps the literal key out of every described layer', async () => {
    const bench = await boot()
    await bench.ctx.settings.update(TRANSCRIPTION_GROQ_SETTINGS_NAMESPACE, { apiKey: 'groq-stored-secret' })

    const [descriptor] = bench.ctx.settings.describe({ redactSecrets: true })
      .filter(row => String(row.ns) === 'transcription-groq')

    expect(JSON.stringify(descriptor)).not.toContain('groq-stored-secret')
    expect(descriptor?.secrets).toEqual([{ path: ['apiKey'], set: true }])
    await bench.ctx.fiber.dispose()
  })

  it('falls back to the composition entry when the settings provider detaches', async () => {
    const bench = await boot()
    await bench.ctx.settings.update(TRANSCRIPTION_GROQ_SETTINGS_NAMESPACE, {
      baseURL: 'https://groq.stored.test/openai/v1',
    })
    expect(await transcribeOnce(bench.ctx)).toContain('https://groq.stored.test/openai/v1')

    await bench.settingsFiber.dispose()

    expect(await transcribeOnce(bench.ctx)).toContain('https://groq.entry.test/openai/v1')
    await bench.ctx.fiber.dispose()
  })

  it('releases the namespace when the plugin unloads', async () => {
    const bench = await boot()
    expect(bench.ctx.settings.describe().map(row => String(row.ns))).toContain('transcription-groq')

    await bench.pluginFiber.dispose()

    expect(bench.ctx.settings.describe().map(row => String(row.ns))).not.toContain('transcription-groq')
    await bench.ctx.fiber.dispose()
  })
})
