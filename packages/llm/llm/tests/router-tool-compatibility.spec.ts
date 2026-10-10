/** Router choices and dispatch respect the complete effective tool set. */
import { afterEach, expect, it, vi } from 'vitest'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { defineTool } from '@deepseek-ai/dsh-tools'
import PtcRuntime from '@deepseek-ai/dsh-ptc-runtime'
import type { PtcRunRequest, PtcRunSpec, PtcRunResult } from '@deepseek-ai/dsh-ptc-runtime'
import { createScope } from '@deepseek-ai/dsh-scope'
import { installModelSelection } from '@deepseek-ai/dsh-agent'
import type { ModelSelectionRef } from '@deepseek-ai/dsh-agent'
import LlmRuntime, { LlmAdapter } from '../src/index.ts'
import type { GenerateOptions, StreamChunk, ToolSchema } from '../src/types.ts'

const contexts: Context[] = []
const homes: string[] = []
afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  for (const home of homes.splice(0)) await rm(home, { recursive: true, force: true })
  vi.unstubAllEnvs()
})
const ids = ['gh/gpt-4.1', 'gh/other', 'nv/meta/muse-glimmer30b']
const schemas = (count: number): ToolSchema[] => Array.from({ length: count }, (_, i) => ({
  name: 'tool_' + String(i), description: 'Test tool', parameters: { type: 'object', properties: {} },
}))
class Adapter extends LlmAdapter {
  readonly requests: GenerateOptions[] = []
  override async listModels(provider: string) { return ids.map(id => ({ provider, id, name: id })) }
  override async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(options)
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}
class Runtime extends PtcRuntime {
  readonly language = 'typescript'
  readonly isolation = 'test'
  resolve(request: PtcRunRequest): PtcRunSpec {
    return { ...request, cwd: request.cwd ?? process.cwd(), timeoutMs: request.timeoutMs ?? 1000 }
  }
  async run(): Promise<PtcRunResult> { return { logs: [] } }
}
async function setup() {
  const home = await mkdtemp(join(tmpdir(), 'router-tools-')); homes.push(home)
  vi.stubEnv('DSH_HOME', home)
  await writeFile(join(home, 'router-live-catalog.enabled'), '1')
  await writeFile(join(home, 'sync-9router-models-state.json'), JSON.stringify({
    ok: true, synchronizedAt: new Date().toISOString(), validUntil: new Date(Date.now() + 55000).toISOString(),
    catalogModelIds: ids, publishedChatModels: 3, availableRoutes: 3, totalRoutes: 3,
  }))
  const ctx = new Context(); contexts.push(ctx)
  await ctx.plugin(LlmRuntime); await ctx.plugin(SystemPrompt); await ctx.plugin(ToolRuntime)
  const adapter = new Adapter(); ctx.llm.registerAdapter(['9router', 'other'], adapter)
  return { ctx, adapter }
}
function registerTools(ctx: Context, count: number) {
  return Array.from({ length: count }, (_, i) => ctx.tools.register(defineTool({
    name: 'test_' + String(i), description: 'Test tool', parameters: {},
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    execute: async () => 'ok',
  })))
}
async function chunks(stream: AsyncIterable<StreamChunk>) {
  const output: StreamChunk[] = []
  for await (const chunk of stream) output.push(chunk)
  return output
}
it.each([128, 129, 486])('filters the default catalog at %i schemas without removing tools', async (count) => {
  const { ctx } = await setup()
  registerTools(ctx, count)
  expect((await ctx.llm.listModels('9router')).map(m => m.id)).toEqual(count <= 128 ? ids : ids.slice(1))
  expect((await ctx.systemPrompt.assemble()).tools).toHaveLength(count)
  expect((await ctx.llm.listModels('other')).map(m => m.id)).toEqual(ids)
  expect((await ctx.llm.routerSyncStatus()).publishedChatModels).toBe(count <= 128 ? 3 : 2)
  if (count > 128) expect((await ctx.llm.routerSyncStatus()).error).toContain('1 confirmed router models')
})
it.each([128, 129, 486])('guards a prepared dispatch containing %i schemas', async (count) => {
  const { ctx, adapter } = await setup()
  const options = { provider: '9router', model: ids[0]!, messages: [], tools: schemas(count) }
  const prepared = await ctx.llm.prepareCall(options)
  const result = await chunks(prepared.stream(options))
  if (count > 128) {
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      type: 'finish', reason: { kind: 'error', failure: { code: 'ROUTER_MODEL_TOOL_LIMIT' } },
    })
    expect(adapter.requests).toHaveLength(0)
  } else expect(adapter.requests[0]?.tools).toHaveLength(128)
  expect(options.tools).toHaveLength(count)
})
it('uses scoped PTC assembly while keeping all native tools and notifying catalog observers', async () => {
  const { ctx, adapter } = await setup()
  await ctx.plugin(Runtime)
  const changed = vi.fn(); ctx.on('llm/adapters-updated', changed)
  const disposers = registerTools(ctx, 486)
  expect(changed).toHaveBeenCalled()
  expect((await ctx.llm.listModels('9router')).map(m => m.id)).toEqual(ids.slice(1))
  const key = {}
  await ctx.plugin(Object.assign((inner: Context) => {
    const scope = createScope(inner, key)
    scope.ctx.tools.presentAs('ptc')
    let assembled = false
    scope.ctx.on('system-prompt/assemble', async (_assembly, _context, next) => {
      assembled = true
      return next()
    })
    expect(scope.ctx.tools.wireToolCount(key)).toBe(1)
    expect(assembled).toBe(false)
  }, { inject: ['tools', 'systemPrompt'] }))
  const assembly = await ctx.systemPrompt.assemble({ scope: key })
  expect(assembly.tools.map(tool => tool.name)).toEqual(['run_code'])
  expect((await ctx.llm.listModels('9router', assembly.tools.length)).map(m => m.id)).toEqual(ids)
  await chunks(ctx.llm.stream({ provider: '9router', model: ids[0]!, messages: [], tools: assembly.tools }))
  expect(adapter.requests[0]?.tools).toHaveLength(1)
  expect(ctx.tools.schemas()).toHaveLength(486)
  for (const dispose of disposers.slice(128)) dispose()
  expect((await ctx.llm.listModels('9router')).map(m => m.id)).toEqual(ids)
})
it('checks the actual request after asynchronous preparation and leaves unrelated routes intact', async () => {
  const { ctx, adapter } = await setup()
  const options = { provider: '9router', model: ids[0]!, messages: [], tools: schemas(128) }
  const original = adapter.prepareCall.bind(adapter)
  vi.spyOn(adapter, 'prepareCall').mockImplementation(async (...args) => {
    const prepared = await original(...args); options.tools.push(schemas(1)[0]!)
    return prepared
  })
  expect(JSON.stringify(await chunks(ctx.llm.stream(options)))).toContain('ROUTER_MODEL_TOOL_LIMIT')
  expect(adapter.requests).toHaveLength(0)
  await chunks(ctx.llm.stream({ provider: 'other', model: ids[0]!, messages: [], tools: schemas(486) }))
  await chunks(ctx.llm.stream({ provider: '9router', model: ids[1]!, messages: [], tools: schemas(486) }))
  expect(adapter.requests.map(request => request.tools?.length)).toEqual([486, 486])
})

it('counts historical declarations after projection, including schemas absent from the current tool list', async () => {
  const { ctx, adapter } = await setup()
  vi.spyOn(adapter, 'resolveModel').mockImplementation(async (provider, model) => ({
    provider, id: model, name: model, toolUpdate: 'in-history',
  }))
  const result = await chunks(ctx.llm.stream({
    provider: '9router', model: ids[0]!, messages: [], tools: schemas(1),
    toolHistory: { tools: schemas(129), updates: [] },
  }))
  expect(result[0]).toMatchObject({
    type: 'finish', reason: { kind: 'error', failure: { code: 'ROUTER_MODEL_TOOL_LIMIT' } },
  })
  expect(adapter.requests).toHaveLength(0)
})

it('keeps the step selection snapshot while two later selections query compatibility', async () => {
  const { ctx } = await setup()
  registerTools(ctx, 129)
  const key = {}
  const initial = { provider: '9router', model: ids[1]! }
  const selection: ModelSelectionRef = { current: initial, assembled: undefined }
  await ctx.plugin(Object.assign((inner: Context) => {
    const scope = createScope(inner, key)
    installModelSelection(scope.ctx, selection)
  }, { inject: ['tools', 'systemPrompt'] }))
  await ctx.systemPrompt.assemble({ scope: key })
  expect(selection.assembled).toBe(initial)
  selection.current = { provider: '9router', model: ids[2]! }
  await ctx.llm.listModels('9router', ctx.tools.wireToolCount(key))
  selection.current = { provider: '9router', model: ids[0]! }
  await ctx.llm.listModels('9router', ctx.tools.wireToolCount(key))
  expect(selection.assembled).toBe(initial)
})
