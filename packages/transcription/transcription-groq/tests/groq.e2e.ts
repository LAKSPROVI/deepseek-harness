import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import TranscriptionRuntime from '@deepseek-ai/dsh-transcription'
import * as TranscriptionGroq from '@deepseek-ai/dsh-transcription-groq'

/**
 * Real-API e2e for the Groq provider. The suite skips entirely without
 * $GROQ_API_KEY.
 *
 * The fixture is synthesized speech rather than a recording, so the assertions
 * pin what the service contract guarantees — a transcript carrying the spoken
 * words, and a reported language — instead of exact punctuation or casing,
 * which Whisper varies between runs.
 */

const UTTERANCE = fileURLToPath(new URL('./fixtures/utterance-pt.wav', import.meta.url))

describe.skipIf(process.env.GROQ_API_KEY === undefined || process.env.GROQ_API_KEY === '')(
  'transcription-groq e2e (real API)',
  () => {
    it('transcribes a spoken utterance through the seam', async () => {
      const ctx = new Context()
      await ctx.plugin(TranscriptionRuntime, { provider: 'groq' })
      await ctx.plugin(TranscriptionGroq, {})

      const result = await ctx.transcription.transcribe({
        audio: new Uint8Array(readFileSync(UTTERANCE)),
        format: 'audio/wav',
        language: 'pt',
      })

      expect(result.text.toLowerCase()).toContain('o rato roeu a roupa do rei de roma')
      // Groq answers with the language NAME, not the ISO code the request sent.
      expect(result.language).toBe('Portuguese')

      await ctx.fiber.dispose()
    })

    it('rejects an oversized upload before spending a request', async () => {
      const ctx = new Context()
      await ctx.plugin(TranscriptionRuntime, { provider: 'groq', maxAudioBytes: 16 })
      await ctx.plugin(TranscriptionGroq, {})

      await expect(ctx.transcription.transcribe({
        audio: new Uint8Array(readFileSync(UTTERANCE)),
        format: 'audio/wav',
      })).rejects.toMatchObject({ code: 'TRANSCRIPTION_AUDIO_TOO_LARGE' })

      await ctx.fiber.dispose()
    })

    it('reports a refusal from the real endpoint when the credential is wrong', async () => {
      vi.stubEnv('GROQ_API_KEY', 'gsk_deliberately-invalid-key')
      const ctx = new Context()
      await ctx.plugin(TranscriptionRuntime, { provider: 'groq' })
      await ctx.plugin(TranscriptionGroq, {})

      await expect(ctx.transcription.transcribe({
        audio: new Uint8Array(readFileSync(UTTERANCE)),
        format: 'audio/wav',
      })).rejects.toMatchObject({ code: 'TRANSCRIPTION_PROVIDER_ERROR' })

      await ctx.fiber.dispose()
      vi.unstubAllEnvs()
    })
  },
)
