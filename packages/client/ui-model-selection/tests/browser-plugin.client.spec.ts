/**
 * ui-model-selection browser half on a real cordis Context with fake command/slots/
 * connection faces and real session scopes: the plugin mounts ModelDirectoryResolver
 * as `models`, the /model contribution and the conversation.input.model
 * seat both register, and BOTH entries resolve the SAME per-session
 * directory through the service — a selection submitted through the seat's
 * inject face is the current the popup's next options pass marks active
 * (and the reverse), the one-shared-state contract of the dual entry.
 * Session or plugin disposal drops the directory and composer policy (HMR safety).
 */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { createScope, createSnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { SessionId, SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { TestRemote } from '@deepseek-ai/dsh-client-test-runtime'
import type { ModelSelection } from '@deepseek-ai/dsh-api-remotes/client'
import type { ComposerAttachment, DraftAttachmentId } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { CommandContribution, SelectOption } from '@deepseek-ai/dsh-client-ui-commands/client'
import type { ModelSelectInjected } from '../src/client/slots.ts'
import { apply, inject } from '../src/client/index.ts'
import { zh } from '../src/client/locales.ts'

const sid = (k: string): SessionId => k as SessionId

interface FakeInputState {
  readonly draft: string
  readonly attachmentIds: readonly DraftAttachmentId[]
  readonly draftRev: number
  readonly phase: 'plain'
  readonly occurrences: readonly never[]
  readonly queue: readonly never[]
}

interface FakeModel {
  readonly id: string
  readonly name: string
  readonly inputModalities?: ('text' | 'image')[]
  readonly reasoning?: {
    readonly efforts: { readonly id: string; readonly name: string }[]
    readonly defaultEffort?: string
  }
}

interface FakeProviderGroup {
  readonly id: string
  readonly name: string
  readonly models: FakeModel[]
}

const GROUPS: FakeProviderGroup[] = [{
  id: 'deepseek-official',
  name: 'DeepSeek',
  models: [
    {
      id: 'deepseek-v4-flash',
      name: 'DeepSeek-V4-Flash',
      inputModalities: ['text', 'image'],
      reasoning: {
        efforts: [
          { id: 'off', name: 'Off' },
          { id: 'high', name: 'High' },
          { id: 'max', name: 'Max' },
        ],
        defaultEffort: 'high',
      },
    },
    {
      id: 'deepseek-v4-pro',
      name: 'DeepSeek-V4-Pro',
      inputModalities: ['text'],
      reasoning: {
        efforts: [
          { id: 'off', name: 'Off' },
          { id: 'high', name: 'High' },
          { id: 'max', name: 'Max' },
        ],
        defaultEffort: 'high',
      },
    },
  ],
}]

/** Boot the plugin over fake faces + a stateful fake host (current moves on selectModel). */
async function bench() {
  const ctx = new Context()
  let current: ModelSelection = { provider: 'deepseek-official', model: 'deepseek-v4-flash' }
  let currentModel: FakeModel | undefined = GROUPS[0]?.models[0]
  const calls = { models: 0, select: 0 }
  const modelFor = (selection: ModelSelection): FakeModel => {
    const model = GROUPS.find(group => group.id === selection.provider)?.models
      .find(entry => entry.id === selection.model)
    return model ?? { id: selection.model, name: selection.model }
  }
  ctx.provide('connection', { api: { sessions: {
    models: () => {
      calls.models += 1
      return Promise.resolve({
        result: {
          ok: true as const,
          value: { current, ...currentModel === undefined ? {} : { currentModel }, routable, groups: GROUPS, failures: [] },
        },
      })
    },
    selectModel: (payload: { provider: string; model: string; reasoningEffort?: string }) => {
      calls.select += 1
      current = {
        provider: payload.provider,
        model: payload.model,
        ...payload.reasoningEffort === undefined
          ? {}
          : { reasoningEffort: payload.reasoningEffort },
      }
      currentModel = modelFor(current)
      return Promise.resolve({ result: { ok: true as const, value: { selected: current, currentModel } } })
    },
  } } })
  // Whether the Host reports an adapter for the current route; the composer
  // block follows this, never catalog membership.
  let routable = true
  const scopes = new Map<SessionId, Context>()
  const blocks = new Map<SessionId, { reason: string } | undefined>()
  const admissions = new Map<SessionId, (attachments: readonly ComposerAttachment[]) => string | undefined>()
  const attachments = new Map<DraftAttachmentId, ComposerAttachment>()
  const inputStores = new Map<SessionId, SnapshotStore<FakeInputState>>()
  const inputStore = (id: SessionId): SnapshotStore<FakeInputState> => {
    const existing = inputStores.get(id)
    if (existing !== undefined) return existing
    const created = createSnapshotStore<FakeInputState>({
      draft: '', attachmentIds: [], draftRev: 0,
      phase: 'plain', occurrences: [], queue: [],
    })
    inputStores.set(id, created)
    return created
  }
  ctx.provide('conversation', {
    input: {
      for: (actx: Context) => {
        const entry = [...scopes].find(([, scope]) => scope === actx)
        if (entry === undefined) throw new Error('fake conversation: unknown scope')
        return { state: inputStore(entry[0]) }
      },
    },
    blocks: {
      set: (id: SessionId, block: { reason: string } | undefined) => { blocks.set(id, block) },
    },
    draftAttachments: (ids: readonly DraftAttachmentId[]) => ids.flatMap((id) => {
      const attachment = attachments.get(id)
      return attachment === undefined ? [] : [attachment]
    }),
    registerPromptAdmission: (id: SessionId, check: (attachments: readonly ComposerAttachment[]) => string | undefined) => {
      admissions.set(id, check)
      return () => { admissions.delete(id) }
    },
  })
  let contribution: CommandContribution | undefined
  ctx.provide('commandUi', {
    register(c: CommandContribution) {
      contribution = c
      return () => { contribution = undefined }
    },
  })
  const seats = new Map<string, {
    inject: ((sessionId: SessionId) => ModelSelectInjected) | undefined
    locale: string | undefined
  }>()
  ctx.provide('slots', {
    inject(_name: string, callback: () => () => void) { return callback() },
    register(options: { name: string; locale?: string; inject?: (sessionId: SessionId) => ModelSelectInjected }) {
      seats.set(options.name, { inject: options.inject, locale: options.locale })
      return () => { seats.delete(options.name) }
    },
  })
  const localeRuntime = new LocaleRuntime(ctx)
  // This spec asserts the shipped Chinese copy. There is no jsdom `window` in
  // this lane, so browser-language detection never runs and the locale comes
  // from FALLBACK_LOCALE (en): state the asserted locale explicitly.
  localeRuntime.setLocale('zh')
  ctx.provide('locale', localeRuntime)
  const addressed = new Set<SessionId>()
  ctx.provide('sessions', {
    scope: (id: SessionId) => scopes.get(id),
    subagentAddress: (id: SessionId) => addressed.has(id)
      ? { parentSessionId: sid('parent'), childSessionId: id, mode: 'continuable' as const }
      : undefined,
  })
  new TestRemote(ctx)
  const fiber = ctx.plugin({ inject: [...inject], apply })
  await fiber.await()
  await ctx.plugin(function probe() {}).await()
  const mint = (key: string) => {
    const handle = createScope(ctx, sid(key))
    scopes.set(sid(key), handle.ctx)
    return handle
  }
  return {
    ctx, fiber, mint, calls,
    contribution: () => contribution!,
    seat: () => seats.get('conversation.input.model')!,
    hostCurrent: () => current,
    setHostCurrent: (selection: ModelSelection, model?: FakeModel) => {
      current = selection
      currentModel = model
    },
    address: (id: SessionId) => { addressed.add(id) },
    setRoutable: (next: boolean) => { routable = next },
    setAttachments: (key: string, next: readonly ComposerAttachment[]) => {
      for (const attachment of next) attachments.set(attachment.id, attachment)
      const store = inputStore(sid(key))
      store.set({ ...store.getSnapshot(), attachmentIds: next.map(attachment => attachment.id) })
    },
    blockOf: (key: string) => blocks.get(sid(key)),
    admissionOf: (key: string) => admissions.get(sid(key)),
  }
}

const projection = (id: string) => ({ sessionId: sid(id) })

describe('ui-model-selection dual entry', () => {
  it('registers the /model contribution and the composer model seat', async () => {
    const b = await bench()
    expect(b.contribution().name).toBe('model')
    expect(b.contribution().ui.kind).toBe('popupSelect')
    expect(b.seat().inject).toBeTypeOf('function')
    // Copy rides the standard locale seat.
    expect(b.seat().locale).toBe('model')
  })

  it('popup options mark the host current active with the provider group in the detail', async () => {
    const b = await bench()
    b.mint('s1')
    const options = await b.contribution().ui.options(projection('s1'), new AbortController().signal)
    expect(options.map((o: SelectOption) => o.label)).toEqual(['DeepSeek-V4-Flash', 'DeepSeek-V4-Pro'])
    expect(options[0]).toMatchObject({ active: true, detail: 'DeepSeek' })
    expect(options[1]?.active).toBeUndefined()
  })

  it('a seat selection is the current the popup marks active next — one shared state', async () => {
    const b = await bench()
    b.mint('s1')
    const seatFace = b.seat().inject!(sid('s1'))
    // Switch through the SEAT entry.
    expect(await seatFace.select({
      provider: 'deepseek-official',
      model: 'deepseek-v4-pro',
      reasoningEffort: 'max',
    })).toBe(true)
    expect(b.hostCurrent()).toEqual({
      provider: 'deepseek-official',
      model: 'deepseek-v4-pro',
      reasoningEffort: 'max',
    })
    expect(seatFace.directory.getSnapshot().current).toEqual({
      provider: 'deepseek-official',
      model: 'deepseek-v4-pro',
      reasoningEffort: 'max',
    })
    // The POPUP's next options pass reflects it without a seat-side reload.
    const options = await b.contribution().ui.options(projection('s1'), new AbortController().signal)
    expect(options.find((o: SelectOption) => o.label === 'DeepSeek-V4-Pro')).toMatchObject({ active: true })
  })

  it('a popup selection lands on the seat store — the reverse direction of the same state', async () => {
    const b = await bench()
    b.mint('s1')
    const seatFace = b.seat().inject!(sid('s1'))
    const options = await b.contribution().ui.options(projection('s1'), new AbortController().signal)
    const pro = options.find((o: SelectOption) => o.label === 'DeepSeek-V4-Pro')!
    await b.contribution().ui.onSelect(pro, projection('s1'))
    expect(seatFace.directory.getSnapshot().current).toEqual({
      provider: 'deepseek-official',
      model: 'deepseek-v4-pro',
      reasoningEffort: 'high',
    })
  })

  it('both entries share one directory instance per session, isolated across sessions', async () => {
    const b = await bench()
    b.mint('a')
    b.mint('b')
    const faceA = b.seat().inject!(sid('a'))
    const faceA2 = b.seat().inject!(sid('a'))
    const faceB = b.seat().inject!(sid('b'))
    expect(faceA.directory).toBe(faceA2.directory)
    expect(faceA.directory).not.toBe(faceB.directory)
    // The service face resolves the same instance the seat inject handed out.
    expect(b.ctx.modelDirectories.directoryFor(sid('a')).store).toBe(faceA.directory)
  })

  it('drops an unconsumed local selection and restores the Host target after reconnect', async () => {
    const b = await bench()
    b.mint('s1')
    const face = b.seat().inject!(sid('s1'))
    await face.select({ provider: 'deepseek-official', model: 'deepseek-v4-pro' })
    b.setHostCurrent({ provider: 'deepseek-official', model: 'deepseek-v4-flash' })

    b.ctx.emit('connection/reset')
    expect(face.directory.getSnapshot()).toMatchObject({ current: null, status: 'loading' })
    await Promise.resolve()
    expect(face.directory.getSnapshot()).toMatchObject({
      current: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
      status: 'ready',
    })
  })

  it('scope disposal drops the directory; a reborn scope gets a fresh one', async () => {
    const b = await bench()
    const first = b.mint('s1')
    const face1 = b.seat().inject!(sid('s1'))
    await first.fiber.dispose()
    b.mint('s1')
    const face2 = b.seat().inject!(sid('s1'))
    expect(face2.directory).not.toBe(face1.directory)
  })

  it('blocks the composer only once the Host reports the route unservable', async () => {
    const b = await bench()
    b.mint('s1')
    const face = b.seat().inject!(sid('s1'))

    // Before the first load nothing is known. `null` is not `false`: a slow
    // or unreachable Host must never lock a working composer.
    expect(b.blockOf('s1')).toBeUndefined()
    face.load()
    await Promise.resolve()
    await Promise.resolve()
    expect(b.blockOf('s1')).toBeUndefined()

    b.setRoutable(false)
    b.ctx.remote.$dispatch('llm/adapters-updated', [])
    await Promise.resolve()
    await Promise.resolve()
    expect(b.blockOf('s1')?.reason).toBe(zh['blocked.composer'])

    // Recovering clears it without a reload of the surface.
    b.setRoutable(true)
    b.ctx.remote.$dispatch('settings/document-updated', ['llm-deepseek', 1])
    await Promise.resolve()
    await Promise.resolve()
    expect(b.blockOf('s1')).toBeUndefined()
  })

  it('never blocks on catalog membership alone', async () => {
    const b = await bench()
    b.mint('s1')
    const face = b.seat().inject!(sid('s1'))
    // A model the route serves but no longer advertises: the seat prompts for
    // a selection, the composer stays usable. Blocking here would break a
    // supported configuration (a narrowed `models` list over a live route).
    b.setHostCurrent({ provider: 'deepseek-official', model: 'unlisted' })
    face.load()
    await Promise.resolve()
    await Promise.resolve()
    const snapshot = face.directory.getSnapshot()
    expect(snapshot.groups.flatMap(group => group.models.map(model => model.id))).not.toContain('unlisted')
    expect(b.blockOf('s1')).toBeUndefined()
  })

  it('blocks only known-incompatible image drafts and clears on removal, selection, or disposal', async () => {
    const b = await bench()
    const scope = b.mint('s1')
    const face = b.seat().inject!(sid('s1'))
    const image: ComposerAttachment = {
      kind: 'image',
      id: 'image-1' as DraftAttachmentId,
      file: new File([Uint8Array.of(1)], 'image.png', { type: 'image/png' }),
      previewUrl: 'blob:image-1',
    }

    await b.ctx.modelDirectories.directoryFor(sid('s1')).load()
    b.setAttachments('s1', [image])
    expect(b.blockOf('s1')).toBeUndefined()
    expect(b.admissionOf('s1')?.([image])).toBeUndefined()

    await face.select({ provider: 'deepseek-official', model: 'deepseek-v4-pro' })
    expect(face.directory.getSnapshot().currentModel?.inputModalities).toEqual(['text'])
    expect(b.blockOf('s1')?.reason).toBe(zh['blocked.images'])
    expect(b.admissionOf('s1')?.([image])).toBe(zh['blocked.images'])
    expect(b.admissionOf('s1')?.([])).toBeUndefined()

    b.setAttachments('s1', [])
    expect(b.blockOf('s1')).toBeUndefined()

    b.setAttachments('s1', [image])
    expect(b.blockOf('s1')?.reason).toBe(zh['blocked.images'])
    await face.select({ provider: 'deepseek-official', model: 'deepseek-v4-flash' })
    expect(face.directory.getSnapshot().currentModel?.inputModalities).toEqual(['text', 'image'])
    expect(b.blockOf('s1')).toBeUndefined()

    b.setHostCurrent({ provider: 'deepseek-official', model: 'private' })
    await b.ctx.modelDirectories.directoryFor(sid('s1')).load()
    expect(face.directory.getSnapshot().groups.flatMap(group => group.models.map(model => model.id)))
      .not.toContain('private')
    expect(face.directory.getSnapshot().currentModel?.inputModalities).toBeUndefined()
    expect(b.blockOf('s1')).toBeUndefined()
    expect(b.admissionOf('s1')?.([image])).toBeUndefined()

    await scope.fiber.dispose()
    expect(b.blockOf('s1')).toBeUndefined()
    expect(b.admissionOf('s1')).toBeUndefined()
  })

  it('clears its block when the session scope goes', async () => {
    const b = await bench()
    const scope = b.mint('s1')
    b.setRoutable(false)
    const face = b.seat().inject!(sid('s1'))
    face.load()
    await Promise.resolve()
    await Promise.resolve()
    expect(b.blockOf('s1')).toBeDefined()

    await scope.fiber.dispose()
    expect(b.blockOf('s1')).toBeUndefined()
  })

  it('drops stale policy and directory across plugin HMR while the session stays alive', async () => {
    const b = await bench()
    b.mint('s1')
    const first = b.seat().inject!(sid('s1'))
    await first.select({ provider: 'deepseek-official', model: 'deepseek-v4-pro' })
    const image: ComposerAttachment = {
      kind: 'image',
      id: 'hmr-image' as DraftAttachmentId,
      file: new File([Uint8Array.of(1)], 'hmr.png', { type: 'image/png' }),
      previewUrl: 'blob:hmr-image',
    }
    b.setAttachments('s1', [image])
    expect(b.admissionOf('s1')?.([image])).toBe(zh['blocked.images'])

    await b.fiber.dispose()
    expect(b.admissionOf('s1')).toBeUndefined()
    expect(b.blockOf('s1')).toBeUndefined()

    const reloaded = b.ctx.plugin({ inject: [...inject], apply })
    await reloaded.await()
    await b.ctx.plugin(function reloadProbe() {}).await()
    const second = b.seat().inject!(sid('s1'))
    expect(second.directory).not.toBe(first.directory)
    await b.ctx.modelDirectories.directoryFor(sid('s1')).load()
    expect(b.admissionOf('s1')?.([image])).toBe(zh['blocked.images'])
    await reloaded.dispose()
  })

  it('an unknown session fails loud at the seat inject', async () => {
    const b = await bench()
    expect(() => b.seat().inject!(sid('ghost'))).toThrow(/resolved no scope/)
  })

  it('withholds both model entries from addressed subagent sessions without Agent-bound RPCs', async () => {
    const b = await bench()
    b.mint('child')
    b.address(sid('child'))

    expect(b.contribution().available(projection('child'))).toBe(false)
    await expect(b.contribution().ui.options(
      projection('child'),
      new AbortController().signal,
    )).rejects.toThrow(/unavailable for addressed subagent/)

    const face = b.seat().inject!(sid('child'))
    expect(face.available).toBe(false)
    face.load()
    await expect(face.select({ provider: 'deepseek', model: 'deepseek-v4-pro' })).resolves.toBe(false)
    await expect(b.ctx.modelDirectories.directoryFor(sid('child')).load())
      .rejects.toThrow(/unavailable for addressed subagent/)
    await expect(b.ctx.modelDirectories.directoryFor(sid('child')).select({
      provider: 'deepseek',
      model: 'deepseek-v4-pro',
    })).rejects.toThrow(/unavailable for addressed subagent/)
    b.ctx.emit('connection/reset')
    await Promise.resolve()
    expect(b.calls).toEqual({ models: 0, select: 0 })
  })
})
