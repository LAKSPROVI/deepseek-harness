// @vitest-environment jsdom
/**
 * ui-voice-input browser half on a real cordis Context with fake slots/remote
 * faces: the plugin registers the push-to-talk entry into the composer tool row
 * with its documented id, order, and locale seat, its injected callback reaches
 * the voiceInput Remote namespace, both dictionaries resolve through the locale
 * service, and the contribution rides the plugin fiber (HMR safety). The node
 * half and the invariant companion are exercised over the same Context.
 */
import { Context, Service } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup } from '@testing-library/react'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import type { VoiceInputTranscribeRequest } from '@deepseek-ai/dsh-voice-input/types'
import type { VoiceInputInjected } from '../src/client/slots.ts'
import { apply, inject } from '../src/client/index.ts'
import { apply as nodeApply } from '../src/index.ts'
import { en, zh } from '../src/client/locales.ts'

afterEach(cleanup)

/** Boot the plugin over fake faces; the Remote namespace records every call. */
async function bench() {
  const ctx = new Context()
  const calls: { request: VoiceInputTranscribeRequest; signal: AbortSignal }[] = []
  const voiceInput = {
    transcribe: (request: VoiceInputTranscribeRequest, signal: AbortSignal) => {
      calls.push({ request, signal })
      // The generated face wraps every business result in the carrier envelope.
      return Promise.resolve({ ok: true as const, value: { ok: true as const, value: { text: 'spoken' } } })
    },
  }
  class RemoteService extends Service {
    constructor(serviceCtx: Context) {
      super(serviceCtx, 'remote')
    }
  }
  new RemoteService(ctx)
  ctx.provide('remote.voiceInput', voiceInput)
  await ctx.plugin(SlotRegistry).await()
  ctx.slots.register({
    name: 'root',
    children: { 'conversation.input.left': { kind: 'list', scope: 'session' } },
  } as never, (() => null) as never)
  const locale = new LocaleRuntime(ctx)
  ctx.provide('locale', locale)
  const fiber = ctx.plugin({ inject: [...inject], apply })
  return {
    ctx,
    fiber,
    calls,
    locale,
    entry: () => {
      const entry = ctx.slots.entries('conversation.input.left')[0]
      if (entry === undefined) return undefined
      return {
        ...entry.options,
        locale: entry.locale,
        inject: entry.inject as unknown as (() => VoiceInputInjected) | undefined,
      }
    },
  }
}

describe('ui-voice-input browser plugin', () => {
  it('registers the microphone entry with the documented id, order, and locale seat', async () => {
    const b = await bench()
    await b.fiber.await()

    expect(inject).toEqual(['slots', 'remote', 'locale'])
    expect(b.entry()).toMatchObject({ id: 'voice-input', order: 20, locale: 'voiceInput' })
    expect(b.entry()?.inject).toBeTypeOf('function')
  })

  it('activates before the voiceInput namespace and registers when it arrives', async () => {
    const ctx = new Context()
    class RemoteService extends Service {
      constructor(serviceCtx: Context) {
        super(serviceCtx, 'remote')
      }
    }
    new RemoteService(ctx)
    await ctx.plugin(SlotRegistry).await()
    ctx.slots.register({
      name: 'root',
      children: { 'conversation.input.left': { kind: 'list', scope: 'session' } },
    } as never, (() => null) as never)
    ctx.provide('locale', new LocaleRuntime(ctx))

    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    expect(ctx.slots.entries('conversation.input.left')).toHaveLength(0)

    ctx.provide('remote.voiceInput', {
      transcribe: () => Promise.resolve({ ok: true as const, value: { ok: true as const, value: { text: 'late' } } }),
    })
    await Promise.resolve()

    expect(ctx.slots.entries('conversation.input.left')).toHaveLength(1)
    await fiber.dispose()
  })

  it('carries a recorded utterance to the voiceInput Remote namespace', async () => {
    const b = await bench()
    await b.fiber.await()
    const face = b.entry()!.inject!()

    const signal = new AbortController().signal
    const answer = await face.transcribe({ mediaType: 'audio/webm', data: 'AQID' }, signal)

    expect(answer).toEqual({ ok: true, value: { ok: true, value: { text: 'spoken' } } })
    expect(b.calls).toEqual([{ request: { mediaType: 'audio/webm', data: 'AQID' }, signal }])
  })

  it('resolves the control copy in both shipped locales', async () => {
    const b = await bench()
    await b.fiber.await()
    const t = b.locale.bind('voiceInput')

    b.locale.setLocale('zh')
    expect(t('button.idle')).toBe(zh['button.idle'])

    b.locale.setLocale('en')

    expect(t('button.idle')).toBe(en['button.idle'])
    expect(t('error.audio-too-large', { bytes: 42 })).toBe(
      'The recording is too long (42 bytes). Please split it into shorter takes.',
    )
  })

  it('takes the entry and the dictionaries away when the plugin fiber is disposed', async () => {
    const b = await bench()
    await b.fiber.await()
    expect(b.ctx.slots.entries('conversation.input.left')).toHaveLength(1)

    await b.fiber.dispose()

    expect(b.ctx.slots.entries('conversation.input.left')).toHaveLength(0)
    // The key itself stays visible once its dictionary is gone.
    expect(b.locale.bind('voiceInput')('button.idle')).toBe('button.idle')
  })

  it('re-registers cleanly when the plugin is reloaded', async () => {
    const b = await bench()
    await b.fiber.await()
    await b.fiber.dispose()

    const reloaded = b.ctx.plugin({ inject: [...inject], apply })
    await reloaded.await()

    expect(b.ctx.slots.entries('conversation.input.left')).toHaveLength(1)
    expect(b.entry()).toMatchObject({ id: 'voice-input' })
  })

  it('the node half applies without host-side behavior', () => {
    // The invariant companion is mounted by the vitest-wide invariant host on
    // every Context this suite creates; its registration is covered there.
    expect(() => { nodeApply() }).not.toThrow()
  })
})
