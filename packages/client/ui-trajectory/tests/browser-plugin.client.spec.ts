/**
 * ui-trajectory plugin halves: the browser entry's dictionary and
 * conversation-view slot registrations against the real SlotRegistry (with
 * fiber teardown proving removal — HMR safety), the inert node entry, and the
 * invariant companion's ownership reservation. Real-stack acceptance of the
 * assembled view lives in views.client.spec.tsx and client-bundle.client.spec.ts;
 * this spec is the contract-level HMR-safety mirror over stubbed registries.
 */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import { SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import { stubSettingsScope } from '@deepseek-ai/dsh-client-test-runtime'
import { apply as applyLocale, inject as localeInject } from '@deepseek-ai/dsh-client-locale/client'
import { apply, inject } from '../src/client/index.ts'
import { apply as applyNode } from '../src/index.ts'
import * as TrajectoryInvariant from '../src/invariant.ts'
import { en, NS, zh } from '../src/client/locales.ts'

/** Slot ledger reader: entry ids currently registered in the conversation view list. */
function viewEntryIds(ctx: Context): (string | undefined)[] {
  return ctx.slots
    .entries('conversation.view')
    .map(entry => entry.options.id)
}

/** Boot the browser half over a real slot tree that declares the conversation view list. */
async function bench(): Promise<{ ctx: Context; fiber: ReturnType<Context['plugin']> }> {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  ctx.slots.register({
    name: 'root',
    children: {
      'conversation.view': { kind: 'list', scope: 'session' },
    },
  } as never, () => null)
  // The view and event definitions register synchronously at apply time; the
  // registries need only honor the register contract for this lane.
  ctx.provide('conversationEvents', { register: () => () => {} })
  ctx.provide('conversationViews', { register: () => () => {} })
  ctx.provide('sessions', {})
  // The locale plugin binds a settings scope, which reads the connection handle
  // and the forwarded-event port.
  ctx.provide('connection', { api: { settings: {} }, isLoopback: false } as never)
  ctx.provide('remote', { $on: () => () => {} } as never)
  ctx.provide('settingsScope', { bind: () => stubSettingsScope().scope } as never)
  await ctx.plugin({ inject: localeInject, apply: applyLocale }).await()
  // These specs assert the shipped Chinese copy. There is no jsdom `window` in
  // this lane, so browser-language detection never runs and the locale comes
  // from FALLBACK_LOCALE (en): state the asserted locale explicitly.
  ctx.locale.setLocale('zh')
  const fiber = ctx.plugin({ inject: [...inject], apply })
  await fiber.await()
  return { ctx, fiber }
}

describe('ui-trajectory browser half', () => {
  it('declares the services it binds', () => {
    expect(inject).toEqual(['slots', 'conversationEvents', 'conversationViews', 'sessions', 'locale'])
  })

  it('registers the trajectory view, and fiber teardown removes it (HMR safety)', async () => {
    const { ctx, fiber } = await bench()
    expect(viewEntryIds(ctx)).toContain('trajectory')
    await fiber.dispose()
    expect(viewEntryIds(ctx)).not.toContain('trajectory')
  })

  it('registers both dictionaries under its own namespace and releases them with the fiber', async () => {
    const { ctx, fiber } = await bench()
    const translate = ctx.locale.bind(NS)
    expect(translate('view.trajectory')).toBe(zh['view.trajectory'])
    ctx.locale.setLocale('en')
    expect(translate('view.trajectory')).toBe(en['view.trajectory'])

    // Withdrawn dictionaries leave the key unresolved rather than translated.
    await fiber.dispose()
    expect(translate('view.trajectory')).not.toBe(en['view.trajectory'])
  })

  it('keeps the English dictionary key-identical to the Chinese source of truth', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort())
  })
})

describe('ui-trajectory node half', () => {
  it('contributes no host behavior', () => {
    // The node half exists only so the plugin appears in the Loader tree.
    expect(applyNode).not.toThrow()
  })
})

describe('ui-trajectory invariant companion', () => {
  it('reserves package ownership under its declared companion name', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry, { enabled: true })
    const fiber = ctx.plugin(TrajectoryInvariant)
    await fiber.await()
    expect(TrajectoryInvariant.name).toBe('client-ui-trajectory-invariant')
    expect(TrajectoryInvariant.inject).toEqual(['invariants'])
    // Emitting an unrelated event proves the companion installed no audit.
    expect(() => { (ctx.emit as (event: string) => void)('slots/changed') }).not.toThrow()
    await fiber.dispose()
  })
})
