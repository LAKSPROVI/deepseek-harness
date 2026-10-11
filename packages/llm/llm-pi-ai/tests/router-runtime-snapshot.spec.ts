import { createHash } from 'node:crypto'
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { expect, it, vi, onTestFinished } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import * as PiAi from '@deepseek-ai/dsh-llm-pi-ai'
import { readRouterCatalogLease } from '../../llm/src/router-sync.ts'

it('discovers new runtime models without Settings and expires each proof independently', async () => {
  const home = await mkdtemp(join(tmpdir(), 'router-snapshot-'))
  const ctx = new Context()
  onTestFinished(async () => {
    await ctx.fiber.dispose(); vi.unstubAllEnvs(); vi.restoreAllMocks()
    await rm(home, { recursive: true, force: true })
  })
  const time = Date.now(); const iso = (value: number) => new Date(value).toISOString()
  vi.stubEnv('DSH_HOME', home)
  await writeFile(join(home, 'router-live-catalog.enabled'), '1')
  const route = { api: 'openai-completions', baseURL: 'https://fixture.invalid/v1', apiKeyEnv: 'FIXTURE_KEY', models: [{ id: 'old' }] }
  const model = (id: string, expires: number) => ({ model: { id, name: id, input: ['text'], contextWindow: 65536, maxTokens: 1000 }, evidence: { available: true, kind: 'chat', checked_at: iso(time), expires_at: iso(expires), protocols: { openai: 'proved' }, capabilities: { text: 'proved', tools: 'proved', openaiTools: 'proved', openaiStream: 'proved' } } })
  const state = { schema: 2, ok: true, transport: 'degraded', scope: { url: route.baseURL, api: route.api, credentialRef: route.apiKeyEnv }, synchronizedAt: iso(time), models: [model('new', time + 500000), model('expires', time + 1000)] }
  await writeFile(join(home, 'sync-9router-models-state.json'), JSON.stringify(state))
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(PiAi, { providers: { '9router': route } })
  expect((await ctx.llm.listModels('9router')).map(model => model.id).sort()).toEqual(['expires', 'new'])
  expect((await ctx.llm.resolveModelInfo('9router', 'new')).context?.contextWindow).toBe(65536)
  vi.spyOn(Date, 'now').mockReturnValue(time + 2000)
  expect([...(await readRouterCatalogLease(home)).ids!]).toEqual(['new'])
  expect((await ctx.llm.listModels('9router')).map(model => model.id)).toEqual(['new'])
  expect(route.models).toEqual([{ id: 'old' }])
  state.scope.credentialRef = 'different'
  await writeFile(join(home, 'sync-9router-models-state.json'), JSON.stringify(state))
  expect(await ctx.llm.listModels('9router')).toEqual([])
})

it('completes the HTTP tool roundtrip with 452 schemas during degraded catalog transport', async () => {
  const { mockServer, closeMockServers, textEvents } = await import('./mock-server.ts')
  const { assemble } = await import('./assemble.ts')
  const { createUserMessage, createToolResultMessage } = await import('@deepseek-ai/dsh-llm')
  const home = await mkdtemp(join(tmpdir(), 'router-roundtrip-')); const ctx = new Context()
  onTestFinished(async () => {
    await ctx.fiber.dispose(); await closeMockServers(); vi.unstubAllEnvs()
    await rm(home, { recursive: true, force: true })
  })
  const toolEvents = [
    JSON.stringify({ choices: [{ index: 0, delta: { role: 'assistant', tool_calls: [{ index: 0, id: 'call_fixture', type: 'function', function: { name: 'read', arguments: '{"path":"fixture.txt"}' } }] }, finish_reason: null }] }),
    JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] }), '[DONE]',
  ]
  const server = await mockServer([{ events: toolEvents }, { events: textEvents.map(event => event.replace('hello', '428619')) }])
  vi.stubEnv('DSH_HOME', home); vi.stubEnv('FIXTURE_KEY', 'fixture-key')
  await writeFile(join(home, 'router-live-catalog.enabled'), '1')
  const now = Date.now(); const iso = (n: number) => new Date(n).toISOString()
  const state = { schema: 2, ok: true, transport: 'confirmed', scope: { url: server.url, api: 'openai-completions', credentialRef: 'FIXTURE_KEY', credentialDigest: createHash('sha256').update('fixture-key').digest('hex') }, synchronizedAt: iso(now), models: [{ model: { id: 'ghc/fixture', name: 'Fixture', input: ['text'], contextWindow: 65536, maxTokens: 1000 }, evidence: { available: true, kind: 'chat', checked_at: iso(now), expires_at: iso(now + 500000), protocols: { openai: 'proved' }, capabilities: { text: 'proved', tools: 'proved', openaiTools: 'proved', openaiStream: 'proved' } } }] }
  const file = join(home, 'sync-9router-models-state.json'); await writeFile(file, JSON.stringify(state))
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(PiAi, { providers: { '9router': { api: 'openai-completions', baseURL: server.url, apiKeyEnv: 'FIXTURE_KEY', models: [] } } })
  const tools = Array.from({ length: 452 }, (_, i) => ({ name: i === 0 ? 'read' : `fixture_${i}`, description: 'Synthetic test', parameters: { type: 'object' as const, properties: { path: { type: 'string' } } } }))
  const user = createUserMessage({ content: [{ type: 'text', text: 'Read fixture.txt and return its value.' }], source: { kind: 'model', provider: 'fixture', model: 'fixture' } })
  const first = await assemble(ctx, { provider: '9router', model: 'ghc/fixture', messages: [user], tools })
  const calls = first.message.content.filter(block => block.type === 'tool-call')
  expect(calls).toHaveLength(1)
  state.transport = 'degraded'; await writeFile(file, JSON.stringify(state))
  const result = createToolResultMessage({ callId: calls[0]!.id, content: [{ type: 'text', text: '428619' }], isError: false })
  const second = await assemble(ctx, { provider: '9router', model: 'ghc/fixture', messages: [user, first.message, result], tools })
  expect(second.message.content).toEqual([{ type: 'text', text: '428619' }])
  expect(server.requests).toHaveLength(2)
  const request = server.requests[1] as { tools: unknown[]; messages: { role: string; content: unknown }[] }
  expect(request.tools).toHaveLength(452)
  expect(request.messages.filter(message => message.role === 'tool')).toHaveLength(1)
  vi.stubEnv('FIXTURE_KEY', 'rotated-fixture-key')
  const rejected = await assemble(ctx, { provider: '9router', model: 'ghc/fixture', messages: [user], tools })
  expect(JSON.stringify(rejected)).toContain('ROUTER_MODEL_UNAVAILABLE')
  expect(server.requests).toHaveLength(2)
  vi.stubEnv('FIXTURE_KEY', 'fixture-key')
  const prepared = await ctx.llm.prepareCall({ provider: '9router', model: 'ghc/fixture' })
  state.scope.credentialRef = 'OTHER_KEY'; await writeFile(file, JSON.stringify(state))
  const chunks = []
  for await (const chunk of prepared.stream({ ...prepared.config, messages: [user], tools })) chunks.push(chunk)
  expect(JSON.stringify(chunks)).toContain('ROUTER_MODEL_UNAVAILABLE')
  expect(server.requests).toHaveLength(2)

})

for (const recovery of ['renew', 'resume'] as const) {
  it(`preserves a completed tool in the agent session through catalog ${recovery}`, async () => {
    const { mockServer, closeMockServers, textEvents } = await import('./mock-server.ts')
    const { default: SessionStore, SessionId } = await import('@deepseek-ai/dsh-session')
    const { default: Projection } = await import('@deepseek-ai/dsh-session-projection')
    const { default: SystemPrompt } = await import('@deepseek-ai/dsh-system-prompt')
    const { default: ToolRuntime, defineContentToolFixture } = await import('@deepseek-ai/dsh-tools')
    const { default: Agents } = await import('@deepseek-ai/dsh-agent')
    const { default: AgentLoop } = await import('@deepseek-ai/dsh-agent-loop')
    const { createUserMessage } = await import('@deepseek-ai/dsh-llm')
    const home = await mkdtemp(join(tmpdir(), 'router-session-')); const ctx = new Context()
    onTestFinished(async () => {
      await ctx.fiber.dispose(); await closeMockServers(); vi.unstubAllEnvs()
      await rm(home, { recursive: true, force: true })
    })
    const server = await mockServer([{ events: [
      JSON.stringify({ choices: [{ index: 0, delta: { role: 'assistant', tool_calls: [{ index: 0, id: 'call_once', type: 'function', function: { name: 'read', arguments: '{}' } }] }, finish_reason: null }] }),
      JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] }), '[DONE]',
    ] }, { events: textEvents.map(event => event.replace('hello', '428619')) }])
    vi.stubEnv('DSH_HOME', home); vi.stubEnv('FIXTURE_KEY', 'fixture-key')
    await writeFile(join(home, 'router-live-catalog.enabled'), '1')
    const iso = (n: number) => new Date(n).toISOString()
    const state = { schema: 2, ok: true, transport: 'confirmed', completedRequest: '',
      scope: { url: server.url, api: 'openai-completions', credentialRef: 'FIXTURE_KEY', credentialDigest: createHash('sha256').update('fixture-key').digest('hex') },
      models: [{ model: { id: 'ghc/fixture', name: 'Fixture', contextWindow: 65536, maxTokens: 1000 },
        evidence: { available: true, kind: 'chat', checked_at: iso(Date.now() - 1000), expires_at: iso(Date.now() + 500000),
          protocols: { openai: 'proved' }, capabilities: { text: 'proved', tools: 'proved', openaiTools: 'proved', openaiStream: 'proved' } } }],
    }
    const file = join(home, 'sync-9router-models-state.json')
    const publish = () => writeFile(file, JSON.stringify(state))
    await publish()
    await ctx.plugin(LlmRuntime); await ctx.plugin(SessionStore); await ctx.plugin(Projection)
    await ctx.plugin(SystemPrompt); await ctx.plugin(ToolRuntime); await ctx.plugin(Agents)
    await ctx.plugin(AgentLoop, { agents: [] })
    await ctx.plugin(PiAi, { providers: { '9router': { api: 'openai-completions', baseURL: server.url, apiKeyEnv: 'FIXTURE_KEY', models: [] } } })
    let executions = 0
    let renewal: Promise<void> | undefined
    ctx.tools.register(defineContentToolFixture({ name: 'read', description: 'Fictional read', parameters: {}, async execute() {
      executions++
      state.models[0]!.evidence.expires_at = iso(Date.now() - 1)
      await publish()
      renewal = (async () => {
        let request: { requestId: string } | undefined
        for (let i = 0; i < 100 && !request; i++) {
          try { request = JSON.parse(await readFile(join(home, 'sync-9router-models-request.json'), 'utf8')) } catch {}
          if (!request) await new Promise(resolve => setTimeout(resolve, 20))
        }
        expect(request).toBeDefined()
        state.completedRequest = request!.requestId
        if (recovery === 'renew') state.models[0]!.evidence.expires_at = iso(Date.now() + 500000)
        await publish()
      })()
      return [{ type: 'text', text: '428619' }]
    } }))
    const agent = await ctx.agentLoop.create(SessionId(`router-${recovery}`), { provider: '9router', model: 'ghc/fixture' })
    const idle = () => new Promise<void>((resolve) => {
      const dispose = ctx.on('agent/status', (event) => { if (event.agent === agent && event.status === 'idle') { dispose(); resolve() } })
    })
    const firstIdle = idle()
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'Read the fixture once.' }], source: { kind: 'user' } }))
    await firstIdle; await renewal
    if (recovery === 'resume') {
      expect(server.requests).toHaveLength(1)
      expect(agent.session.snapshotEvents().filter(event => event.type === 'tool/result')).toHaveLength(1)
      state.models[0]!.evidence.checked_at = iso(Date.now()); state.models[0]!.evidence.expires_at = iso(Date.now() + 500000)
      await publish()
      const resumedIdle = idle()
      agent.followup(createUserMessage({ content: [{ type: 'text', text: 'Continue using the completed result.' }], source: { kind: 'user' } }))
      await resumedIdle
    }
    expect(executions).toBe(1)
    expect(server.requests).toHaveLength(2)
    expect(agent.session.snapshotEvents().filter(event => event.type === 'tool/result')).toHaveLength(1)
    expect(JSON.stringify(agent.session.deriveMessages().at(-1))).toContain('428619')
    const request = server.requests[1] as { messages: { role: string }[] }
    expect(request.messages.filter(message => message.role === 'tool')).toHaveLength(1)
  })
}
