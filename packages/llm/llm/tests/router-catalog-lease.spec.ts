/** Native directory and dispatch obey the router lease even after its updater stops. */
import { mkdtemp, writeFile, rm, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, expect, it, vi, onTestFinished } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime, { LlmAdapter, createMessage } from '../src/index.ts'
import type { StreamChunk } from '../src/types.ts'
import { readRouterCatalogLease, watchRouterCatalog } from '../src/router-sync.ts'

const watchControl = vi.hoisted(() => ({ fail: false, last: undefined as import('node:fs').FSWatcher | undefined }))
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return { ...actual, watch: (...args: Parameters<typeof actual.watch>) => {
    if (watchControl.fail) throw new Error('watch unavailable')
    const watcher = actual.watch(...args); watchControl.last = watcher; return watcher
  } }
})
const contexts: Context[] = []
afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  vi.unstubAllEnvs(); vi.useRealTimers(); watchControl.fail = false
})
async function home() {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-router-native-'))
  onTestFinished(() => rm(dir, { recursive: true, force: true }))
  return dir
}
const lease = (ids = ['A'], deadline = Date.now() + 60000) => ({ ok: true, synchronizedAt: new Date().toISOString(), validUntil: new Date(deadline).toISOString(), catalogModelIds: ids })

it.each([
  { ok: false }, null, { ok: true }, { ...lease(), validUntil: '2026-10-07T20:00:00' },
  lease(['A', 'A']), lease(['']), lease(['A'], Date.now() - 60000), lease(['A'], Date.now() + 900000),
  { ...lease(), synchronizedAt: new Date(Date.now() + 60000).toISOString() },
])('withdraws an invalid or expired managed lease: %#', async (state) => {
  const dir = await home(); await writeFile(join(dir, 'router-live-catalog.enabled'), '1\n')
  await writeFile(join(dir, 'sync-9router-models-state.json'), JSON.stringify(state))
  expect([...(await readRouterCatalogLease(dir)).ids!]).toEqual([])
})

it('keeps unmanaged routes independent and fails closed on missing or malformed managed state', async () => {
  const dir = await home()
  expect(await readRouterCatalogLease()).toEqual({})
  expect(await readRouterCatalogLease(dir)).toEqual({})
  await writeFile(join(dir, 'router-live-catalog.enabled'), '1\n')
  expect([...(await readRouterCatalogLease(dir)).ids!]).toEqual([])
  await writeFile(join(dir, 'sync-9router-models-state.json'), '{')
  expect([...(await readRouterCatalogLease(dir)).ids!]).toEqual([])
})

class Adapter extends LlmAdapter {
  calls = 0
  override async listModels(provider: string) { return ['A', 'B'].map(id => ({ provider, id, name: id })) }
  override async * stream(): AsyncIterable<StreamChunk> { this.calls++; yield { type: 'block-start', index: 0, blockType: 'text' } }
}

it('filters native choices and rejects a prepared dispatch after its confirmation expires', async () => {
  const dir = await home(); vi.stubEnv('DSH_HOME', dir)
  await writeFile(join(dir, 'router-live-catalog.enabled'), '1\n')
  const stateFile = join(dir, 'sync-9router-models-state.json')
  await writeFile(stateFile, JSON.stringify(lease()))
  const ctx = new Context(); contexts.push(ctx); await ctx.plugin(LlmRuntime)
  const adapter = new Adapter(); ctx.llm.registerAdapter(['9router', 'other'], adapter)
  expect((await ctx.llm.listModels('9router')).map(model => model.id)).toEqual(['A'])
  expect((await ctx.llm.listModels('other')).map(model => model.id)).toEqual(['A', 'B'])
  const options = { provider: '9router', model: 'A', messages: [] }
  const prepared = await ctx.llm.prepareCall(options)
  await writeFile(stateFile, JSON.stringify(lease(['A'], Date.now() - 60000)))
  expect(await ctx.llm.listModels('9router')).toEqual([])
  await expect(ctx.llm.resolveModelInfo('9router', 'A')).rejects.toMatchObject({ code: 'ROUTER_MODEL_UNAVAILABLE' })
  await expect(ctx.llm.prepareCall(options)).rejects.toMatchObject({ code: 'ROUTER_MODEL_UNAVAILABLE' })
  const chunks = []; for await (const chunk of prepared.stream(options)) chunks.push(chunk)
  expect(JSON.stringify(chunks)).toContain('ROUTER_MODEL_UNAVAILABLE'); expect(adapter.calls).toBe(0)
  await writeFile(stateFile, JSON.stringify(lease(['B'])))
  expect((await ctx.llm.listModels('9router')).map(model => model.id)).toEqual(['B'])
})

it('notifies at expiration without a new write, on recovery, and stops after disposal', async () => {
  const dir = await home(); await writeFile(join(dir, 'router-live-catalog.enabled'), '1\n')
  const stateFile = join(dir, 'sync-9router-models-state.json')
  await writeFile(stateFile, JSON.stringify(lease(['A'], Date.now() + 250)))
  const changes = vi.fn()
  const stop = watchRouterCatalog(dir, changes); onTestFinished(stop)
  await vi.waitFor(() =>{  expect(changes).toHaveBeenCalled() }, { timeout: 5000 })
  expect([...(await readRouterCatalogLease(dir)).ids!]).toEqual([])
  const count = changes.mock.calls.length
  await writeFile(stateFile, JSON.stringify(lease(['B'])))
  await vi.waitFor(() =>{  expect(changes.mock.calls.length).toBeGreaterThan(count) }, { timeout: 5000 })
  await unlink(stateFile)
  await vi.waitFor(() =>{  expect(changes.mock.calls.length).toBeGreaterThan(count + 1) }, { timeout: 5000 })
  stop(); const after = changes.mock.calls.length
  await writeFile(stateFile, JSON.stringify(lease(['B'], Date.now() + 100)))
  await new Promise(resolve => setTimeout(resolve, 200))
  expect(changes).toHaveBeenCalledTimes(after)
  watchRouterCatalog(undefined, changes)()
})

it.each([false, true])('recovers using periodic notifications when native watch fails: %s', async (failsInitially) => {
  const dir = await home()
  await writeFile(join(dir, 'router-live-catalog.enabled'), '1\n')
  const stateFile = join(dir, 'sync-9router-models-state.json')
  await writeFile(stateFile, JSON.stringify(lease()))
  watchControl.fail = failsInitially
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
  const changes = vi.fn()
  const stop = watchRouterCatalog(dir, changes); onTestFinished(stop)
  await writeFile(join(dir, 'unrelated-file'), 'x')
  if (!failsInitially) watchControl.last!.emit('error', new Error('watch stopped'))
  await vi.waitFor(() =>{  expect(vi.getTimerCount()).toBeGreaterThan(0) })
  await writeFile(stateFile, JSON.stringify(lease(['B'])))
  const before = changes.mock.calls.length
  await vi.advanceTimersByTimeAsync(30000)
  await vi.waitFor(() =>{  expect(changes.mock.calls.length).toBeGreaterThan(before) })
  expect([...(await readRouterCatalogLease(dir)).ids!]).toEqual(['B'])
  stop(); expect(vi.getTimerCount()).toBe(0)
  watchRouterCatalog(join(dir, 'missing'), changes)()
})

it('refuses a lease longer than the maximum local confirmation window', async () => {
  const dir = await home(); await writeFile(join(dir, 'router-live-catalog.enabled'), '1\n')
  await writeFile(join(dir, 'sync-9router-models-state.json'), JSON.stringify(lease(['A'], Date.now() + 120000)))
  expect([...(await readRouterCatalogLease(dir)).ids!]).toEqual([])
})
it('rechecks confirmation after asynchronous adapter preparation and preserves an already started stream', async () => {
  const dir = await home(); vi.stubEnv('DSH_HOME', dir)
  await writeFile(join(dir, 'router-live-catalog.enabled'), '1\n')
  const stateFile = join(dir, 'sync-9router-models-state.json')
  await writeFile(stateFile, JSON.stringify(lease()))
  class DelayedAdapter extends Adapter {
    override async prepareCall(provider: string, model: string, signal?: AbortSignal) {
      const result = await super.prepareCall(provider, model, signal)
      await writeFile(stateFile, JSON.stringify({ ok: false }))
      return result
    }
  }
  const ctx = new Context(); contexts.push(ctx); await ctx.plugin(LlmRuntime)
  const delayed = new DelayedAdapter(); ctx.llm.registerAdapter(['9router'], delayed)
  const chunks = []; for await (const chunk of ctx.llm.stream({ provider: '9router', model: 'A', messages: [] })) chunks.push(chunk)
  expect(JSON.stringify(chunks)).toContain('ROUTER_MODEL_UNAVAILABLE'); expect(delayed.calls).toBe(0)
  await writeFile(stateFile, JSON.stringify(lease()))
  class StartedAdapter extends Adapter {
    override async * stream(): AsyncIterable<StreamChunk> {
      this.calls++; yield { type: 'block-start', index: 0, blockType: 'text' }
      await writeFile(stateFile, JSON.stringify({ ok: false }))
      yield { type: 'text-delta', index: 0, text: 'continued' }
      yield { type: 'block-end', index: 0, block: { type: 'text', text: 'continued' } }
      yield { type: 'finish', reason: { kind: 'stop' } }
    }
  }
  const startedContext = new Context(); contexts.push(startedContext); await startedContext.plugin(LlmRuntime)
  const started = new StartedAdapter(); startedContext.llm.registerAdapter(['9router'], started)
  const continued = []; for await (const chunk of startedContext.llm.stream({ provider: '9router', model: 'A', messages: [createMessage({ role: 'assistant', content: [{ type: 'text', text: 'previous' }], source: { kind: 'model', provider: '9router', model: 'A' } })] })) continued.push(chunk)
  expect(continued.at(-1)).toMatchObject({ type: 'finish', reason: { kind: 'stop' } }); expect(started.calls).toBe(1)
})
