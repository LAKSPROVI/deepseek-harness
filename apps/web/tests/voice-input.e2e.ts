// Web e2e scenario: push-to-talk voice input over the real host and the real
// Groq endpoint. Chromium's fake audio device replaces the microphone, feeding
// a recorded utterance into a genuine MediaRecorder, so the chain under test is
// the whole delivery path: browser capture → base64 → the voiceInput Remote →
// the transcription seam → Groq → the transcript written into the composer draft.
//
// The suite self-skips without $GROQ_API_KEY. No model credential is involved:
// transcription never reaches an LLM, and the composer accepts a draft without
// sending it.
import { fileURLToPath } from 'node:url'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import { launchWebScaffold, watchConsole, type WebScaffold } from './scaffold.ts'
import { connectFreshWorkspace, newEnglishPage, saveFailureShot } from './support.ts'

// The same recorded utterance the provider's real-API e2e transcribes.
const UTTERANCE = fileURLToPath(
  new URL('../../../packages/transcription/transcription-groq/tests/fixtures/utterance-pt.wav', import.meta.url),
)

const SPOKEN = 'rato'

describe.skipIf(process.env.GROQ_API_KEY === undefined || process.env.GROQ_API_KEY === '')(
  'web e2e: voice input',
  () => {
    let scaffold: WebScaffold
    let browser: Browser
    let page: Page
    let tripwire: ReturnType<typeof watchConsole>

    beforeAll(async () => {
      scaffold = await launchWebScaffold({})
      browser = await chromium.launch({
        args: [
          '--use-fake-device-for-media-stream',
          '--use-fake-ui-for-media-stream',
          `--use-file-for-fake-audio-capture=${UTTERANCE}`,
        ],
      })
      page = await newEnglishPage(browser)
      await page.context().grantPermissions(['microphone'])
      tripwire = watchConsole(page)
      await page.goto(scaffold.baseUrl, { waitUntil: 'load' })
      await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
      await connectFreshWorkspace(page, scaffold.workspaceCwd)
    }, 180_000)

    afterAll(async () => {
      await browser?.close()
      await scaffold?.close()
    })

    it('writes what the microphone captured into the composer draft', async () => {
      onTestFailed(() => saveFailureShot(page, 'web-e2e-voice-input'))

      const composer = page.locator('textarea:enabled[placeholder="Describe what you want to build"]')
      expect(await composer.inputValue()).toBe('')

      const button = page.getByRole('button', { name: 'Hold to talk' })
      await button.waitFor({ timeout: 15_000 })

      // Press and hold: the control records for as long as the pointer is down,
      // so the fake device needs real time to play the utterance through.
      await button.hover()
      await page.mouse.down()
      await expect.poll(() => button.getAttribute('aria-label'), { timeout: 10_000 })
        .toBe('Release to send')
      await page.waitForTimeout(5_000)
      await page.mouse.up()

      await expect.poll(() => composer.inputValue(), { timeout: 60_000 })
        .toContain(SPOKEN)

      expect(tripwire.pageErrors).toEqual([])
    }, 120_000)
  },
)
