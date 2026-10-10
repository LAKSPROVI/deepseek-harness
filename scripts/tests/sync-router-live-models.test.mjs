import assert from 'node:assert/strict'
import { test } from 'node:test'
import { selectModels, syncOnce, main, createSettingsReader } from '../sync-router-live-models.mjs'

const now = Date.parse('2026-10-07T20:00:00Z')
const model = (id, changes = {}) => ({ id, name: id, x_9r: { available: true, kind: 'chat', checked_at: new Date(now - 1000).toISOString(), expires_at: new Date(now + 60000).toISOString(), capabilities: { text: 'proved', tools: 'proved', anthropicTools: 'proved', anthropicStream: 'proved' }, protocols: { anthropic: 'proved' }, ...changes } })
const catalog = data => ({ data, x_9r_catalog: { availability_mode: 'strict', generation: 'fixture' } })
function host() {
  const view = { ns: 'llm-pi-ai', revision: 3, value: { providers: { '9router': { api: 'anthropic-messages', baseURL: 'https://router.example/v1', apiKeyEnv: 'ROUTER_API_KEY', models: [{ id: 'old', input: ['text', 'image'] }], compat: { thinkingFormat: 'anthropic' } }, other: { models: [{ id: 'preserve' }] } } } }
  const mutations = []; let conflict = false; let backupCount = 0
  return { view, mutations, setConflict() { conflict = true }, get backupCount() { return backupCount },
    backup: async () => { backupCount++ },
    rpc: async (method, args) => {
      if (method === 'settings/describe') return { writable: true, namespaces: [structuredClone(view)] }
      assert.equal(method, 'settings/mutate'); assert.equal(args.ns, view.ns)
      if (conflict) { conflict = false; view.revision++; view.value.providers['9router'].displayName = 'Concurrent edit'; const error = new Error('fixture'); error.code = 'settings/conflict'; throw error }
      assert.equal(args.expectedRevision, view.revision)
      assert.deepEqual(args.ops.map(x => x.path), [['providers', '9router', 'models']])
      assert.equal(args.ops[0].op, 'set'); assert.ok(backupCount > 0)
      view.value.providers['9router'].models = args.ops[0].value; view.revision++; mutations.push(args); return structuredClone(view)
    } }
}
const options = fixture => ({ rpc: fixture.rpc, backup: fixture.backup, provider: '9router', catalogUrl: 'https://router.example/v1', now: () => now })

test('requires fresh semantic proof for Anthropic tools and stream, not OpenAI or aliases', () => {
  const rows = [model('valid'), model('9r/auto'), model('expired', { expires_at: new Date(now).toISOString() }), model('no-zone', { expires_at: '2026-10-07T20:01:00' }), model('future', { checked_at: new Date(now + 9000).toISOString() }), model('openai', { protocols: { openai: 'proved' } }), model('without-tool', { capabilities: { text: 'proved', tools: 'proved', anthropicStream: 'proved' } })]
  assert.deepEqual(selectModels(catalog(rows), [], now).map(x => x.id), ['valid'])
  assert.throws(() => selectModels({ data: rows }, [], now), /catalog_not_strict/)
})
test('preserves exact-model options but removes unproved image input and uses declared capacities', () => {
  const row = model('valid'); row.capabilities = { contextWindow: 131072, maxOutput: 8192 }
  const result = selectModels(catalog([row]), [{ id: 'valid', input: ['text', 'image'], reasoningEfforts: { high: 'high' }, maxTokens: 1000 }], now)
  assert.deepEqual(result[0].input, ['text']); assert.deepEqual(result[0].reasoningEfforts, { high: 'high' }); assert.equal(result[0].contextWindow, 131072); assert.equal(result[0].maxTokens, 1000)
})
test('updates only models through revision-aware RPC, clears empty lists and restores recovered models', async () => {
  const fixture = host(); const before = structuredClone(fixture.view.value)
  let rows = [model('A')]; const args = { ...options(fixture), fetchCatalog: async () => catalog(rows) }
  assert.equal((await syncOnce(args)).publishedChatModels, 1)
  rows = []; assert.equal((await syncOnce(args)).publishedChatModels, 0)
  rows = [model('B')]; assert.equal((await syncOnce(args)).publishedChatModels, 1)
  assert.deepEqual(fixture.view.value.providers.other, before.providers.other)
  const { models: ignored, ...remaining } = fixture.view.value.providers['9router']; const { models: prior, ...expected } = before.providers['9router']; assert.deepEqual(remaining, expected)
  assert.equal(fixture.mutations.length, 3)
})
test('first network failure clears the last successful list and returns a sanitized failure', async () => {
  const fixture = host(); const args = { ...options(fixture), fetchCatalog: async () => { throw new Error('SECRET fixture must never be logged') } }
  const result = await syncOnce(args); assert.equal(result.ok, false); assert.equal(result.error, 'catalog_unconfirmed'); assert.deepEqual(fixture.view.value.providers['9router'].models, [])
  assert.equal(JSON.stringify(result).includes('SECRET'), false)
})
test('re-reads on revision conflict and preserves a concurrent provider edit', async () => {
  const fixture = host(); fixture.setConflict()
  assert.equal((await syncOnce({ ...options(fixture), fetchCatalog: async () => catalog([model('A')]) })).ok, true)
  assert.equal(fixture.view.value.providers['9router'].displayName, 'Concurrent edit')
})
test('does not duplicate writes when the proven projection is unchanged', async () => {
  const fixture = host(); const args = { ...options(fixture), fetchCatalog: async () => catalog([model('A')]) }
  await syncOnce(args); assert.equal((await syncOnce(args)).changed, false); assert.equal(fixture.mutations.length, 1)
})
test('refuses a different protocol or catalog endpoint before changing the provider', async () => {
  for (const change of [{ api: 'openai-responses' }, { baseURL: 'https://unrelated.example/v1' }]) {
    const fixture = host(); Object.assign(fixture.view.value.providers['9router'], change)
    await assert.rejects(syncOnce({ ...options(fixture), fetchCatalog: async () => catalog([]) }), /provider_mismatch/); assert.equal(fixture.mutations.length, 0)
  }
})
test('validates the complete listing and rejects duplicate IDs without keeping stale choices', async () => {
  const fixture = host(); const result = await syncOnce({ ...options(fixture), fetchCatalog: async () => catalog([model('A'), model('A')]) })
  assert.equal(result.ok, false); assert.deepEqual(fixture.view.value.providers['9router'].models, [])
})

test('bounds positive evidence even when a listing claims an excessive TTL', () => {
  assert.deepEqual(selectModels(catalog([model('long', { expires_at: new Date(now + 900000).toISOString() })]), [], now), [])
})
test('rechecks expiration after a settings revision conflict', async () => {
  const fixture = host(); fixture.setConflict(); let tick = now
  const originalRpc = fixture.rpc
  const rpc = async (...args) => { try { return await originalRpc(...args) } catch (error) { tick += 60000; throw error } }
  await syncOnce({ ...options(fixture), rpc, now: () => tick, fetchCatalog: async () => catalog([model('A')]) })
  assert.deepEqual(fixture.view.value.providers['9router'].models, [])
})
test('never mutates when the verified backup fails', async () => {
  const fixture = host()
  await assert.rejects(syncOnce({ ...options(fixture), backup: async () => { throw new Error('backup_failed') }, fetchCatalog: async () => catalog([model('A')]) }), /backup_failed/)
  assert.equal(fixture.mutations.length, 0)
})

test('CLI watch authenticates, handles manual refresh, removes and restores choices, and writes verified backups', async t => {
  const { createServer } = await import('node:http')
  const { once } = await import('node:events')
  const { mkdtemp, mkdir, readFile, writeFile, readdir, rm } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const { spawn } = await import('node:child_process')
  const { main } = await import('../sync-router-live-models.mjs')
  const root = await mkdtemp(join(tmpdir(), 'dsh-router-transport-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await mkdir(join(root, 'profiles/web'), { recursive: true })
  const profile = join(root, 'profiles/web/cordis.patch.yml'); await writeFile(profile, 'fixture profile\n')
  let rows = ['A']; const transitions = []; let apiUrl; const fixture = host(); let requests = 0
  fixture.view.value.providers['9router'].models = []
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url, apiUrl)
      if (url.pathname === '/' && url.searchParams.get('token') === 'fixture') { response.writeHead(303, { 'set-cookie': 'dsh-auth-fixture=fixture; HttpOnly; SameSite=Strict', location: './' }); response.end(); return }
      if (url.pathname === '/v1/models') {
        assert.equal(request.headers.authorization, 'Bearer fixture-key')
        assert.equal(url.searchParams.get('protocol'), 'anthropic')
        assert.equal(url.searchParams.get('capability'), 'text,tools,anthropicTools,anthropicStream')
        requests++; const tick = Date.now(); response.setHeader('content-type', 'application/json')
        response.end(JSON.stringify(catalog(rows.map(id => model(id, { checked_at: new Date(tick - 1000).toISOString(), expires_at: new Date(tick + 60000).toISOString() }))))); return
      }
      assert.equal(request.headers.cookie, 'dsh-auth-fixture=fixture'); assert.equal(request.headers.origin, new URL(apiUrl).origin)
      const chunks = []; for await (const chunk of request) chunks.push(chunk)
      const message = JSON.parse(Buffer.concat(chunks).toString())
      assert.equal(message.type, 'client-request'); assert.equal(url.pathname, `/api/${message.method}`)
      let value
      if (message.method === 'settings/describe') value = { writable: true, namespaces: [structuredClone(fixture.view)] }
      else {
        assert.equal(message.method, 'settings/mutate'); assert.equal(message.payload.args.expectedRevision, fixture.view.revision)
        assert.deepEqual(message.payload.args.ops.map(op => op.path), [['providers', '9router', 'models']])
        fixture.view.value.providers['9router'].models = message.payload.args.ops[0].value; transitions.push(fixture.view.value.providers['9router'].models.map(model => model.id)); fixture.view.revision++; value = structuredClone(fixture.view)
        await writeFile(profile, `fixture revision ${fixture.view.revision}\n`)
      }
      response.setHeader('content-type', 'application/json'); response.end(JSON.stringify({ type: 'server-response', rpcId: message.rpcId, result: { ok: true, value } }))
    } catch { response.writeHead(500); response.end('{}') }
  })
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve) }))
  apiUrl = `http://127.0.0.1:${server.address().port}/`; fixture.view.value.providers['9router'].baseURL = apiUrl + 'v1'
  const log = join(root, 'launch.log'); await writeFile(log, `dsh web: ${apiUrl}?token=fixture\n`)
  const defaults = { home: root, 'app-url': apiUrl, 'catalog-url': apiUrl + 'v1', 'launch-log': log, 'interval-ms': '10000' }
  await writeFile(join(root, 'sync-9router-models.lock'), JSON.stringify({ pid: 2147483647 }))
  const child = spawn(process.execPath, [new URL('../sync-router-live-models.mjs', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/u, '$1'), ...Object.entries(defaults).flatMap(([key, value]) => [`--${key}`, value]), '--watch'], { env: { ...process.env, ROUTER_API_KEY: 'fixture-key' }, stdio: 'ignore' })
  const competitor = spawn(process.execPath, [new URL('../sync-router-live-models.mjs', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/u, '$1'), ...Object.entries(defaults).flatMap(([key, value]) => [`--${key}`, value]), '--watch'], { env: { ...process.env, ROUTER_API_KEY: 'fixture-key' }, stdio: 'ignore' })
  t.after(async () => { for (const process of [child, competitor]) if (process.exitCode === null) { const ended = once(process, 'exit'); process.kill(); await ended } })
  async function waitFor(predicate) { const end = Date.now() + 15000; while (!predicate()) { if (Date.now() > end) throw new Error('fixture deadline'); await new Promise(resolve => setTimeout(resolve, 25)) } }
  await waitFor(() => fixture.view.value.providers['9router'].models.length === 1)
  await waitFor(() => [child, competitor].filter(process => process.exitCode === null).length === 1)
  rows = []; const empty = await main(defaults, []); assert.equal(empty.publishedChatModels, 0)
  rows = ['B']; const recovered = await main(defaults, []); assert.equal(recovered.publishedChatModels, 1)
  assert.deepEqual(fixture.view.value.providers['9router'].models.map(row => row.id), ['B'])
  assert.deepEqual(transitions, JSON.parse(await readFile(new URL('./expected/router-live-catalog.json', import.meta.url), 'utf8')))
  assert.ok(requests >= 3); assert.ok((await readdir(join(root, 'backups/router-live-catalog'))).length >= 3)
  assert.equal(JSON.stringify(JSON.parse(await readFile(join(root, 'sync-9router-models-state.json'), 'utf8'))).includes('fixture-key'), false)
})
test('retains exact-model preferences after withdrawal and reappearance', async () => {
  const fixture = host(); fixture.view.value.providers['9router'].models = [{ id: 'A', reasoningEfforts: { high: 'high' }, input: ['text', 'image'] }]
  let preferences = []; const savePreferences = async models => { preferences = models }
  await syncOnce({ ...options(fixture), fetchCatalog: async () => catalog([]), savePreferences })
  await syncOnce({ ...options(fixture), fetchCatalog: async () => catalog([model('A')]), modelPreferences: preferences, savePreferences })
  assert.deepEqual(fixture.view.value.providers['9router'].models[0].reasoningEfforts, { high: 'high' })
  assert.deepEqual(fixture.view.value.providers['9router'].models[0].input, ['text'])
})

test('caps a single captured local confirmation at sixty seconds even for a long polling interval', async () => {
  const fixture = host(); let clock = now
  const state = await syncOnce({ ...options(fixture), now: () => clock++, intervalMs: 600000, fetchCatalog: async () => catalog([model('A', { expires_at: new Date(now + 120000).toISOString() })]) })
  assert.equal(Date.parse(state.validUntil) - Date.parse(state.synchronizedAt), 60000)
  await assert.rejects(() => main({}, ['--provider', 'other']), { code: 'provider_mismatch' })
})

test('keeps the external catalog deadline separate from the local app deadline', async t => {
  const { createTransport } = await import('../sync-router-live-models.mjs')
  const { mkdtemp, writeFile, rm } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const root = await mkdtemp(join(tmpdir(), 'router-deadlines-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const log = join(root, 'launch.log'); await writeFile(log, 'http://127.0.0.1:3080/?token=fixture\n')
  const deadlines = []
  t.mock.method(AbortSignal, 'timeout', ms => { deadlines.push(ms); return new AbortController().signal })
  t.mock.method(globalThis, 'fetch', async url => {
    if (new URL(url).searchParams.has('token')) return new Response(null, { status: 303, headers: { 'set-cookie': 'fixture=value' } })
    if (new URL(url).pathname.endsWith('/models')) return new Response(JSON.stringify(catalog([])))
    return new Response(JSON.stringify({ type: 'server-response', result: { ok: true, value: { namespaces: [] } } }))
  })
  const transport = createTransport({ appUrl: 'http://127.0.0.1:3080/', catalogUrl: 'https://router.example/v1', launchLog: log, apiKey: 'fixture', timeoutMs: 20, appTimeoutMs: 150 })
  await transport.rpc('settings/describe', {}); await transport.fetchCatalog()
  assert.deepEqual(deadlines, [150, 150, 20])
})

test('rejects local app deadlines beyond the bounded confirmation budget', async () => {
  const defaults = { home: 'unused', 'app-url': 'http://127.0.0.1:3080/', 'catalog-url': 'https://router.example/v1', 'launch-log': 'unused' }
  for (const value of ['0', '-1', '30001', 'NaN']) await assert.rejects(() => main(defaults, [`--app-timeout-ms=${value}`]), { code: 'app_timeout_invalid' })
})

test('reads fresh scoped revisions and rediscovers a moved provider namespace', async () => {
  const fixture = host(); const requests = []
  const rpc = async (method, args) => {
    requests.push(args)
    if (args.ns && args.ns !== fixture.view.ns) return { writable: true, namespaces: [] }
    return fixture.rpc(method, args)
  }
  const describeSettings = createSettingsReader(rpc)
  assert.equal((await describeSettings()).namespaces[0].revision, 3)
  fixture.view.revision = 8
  assert.equal((await describeSettings()).namespaces[0].revision, 8)
  fixture.view.ns = 'moved-llm'
  assert.equal((await describeSettings()).namespaces[0].ns, 'moved-llm')
  assert.deepEqual(requests, [{}, { ns: 'llm-pi-ai' }, { ns: 'llm-pi-ai' }, {}])
})

test('falls back once for older runtimes but does not hide timeouts or cache evidence', async () => {
  const fixture = host(); const requests = []; let timeout = false
  const reader = createSettingsReader(async (method, args) => {
    requests.push(args)
    if (timeout) throw Object.assign(new Error('timeout'), { code: 'timeout' })
    if (args.ns) throw Object.assign(new Error('old runtime'), { code: 'settings_filter_unsupported' })
    return fixture.rpc(method, args)
  })
  await reader(); await reader(); await reader()
  assert.deepEqual(requests, [{}, { ns: 'llm-pi-ai' }, {}, {}])
  timeout = true
  await assert.rejects(reader(), { code: 'timeout' })
  const describeSettings = createSettingsReader(fixture.rpc)
  let rows = [model('fresh')]
  const opts = { ...options(fixture), describeSettings, fetchCatalog: async () => catalog(rows) }
  assert.equal((await syncOnce(opts)).publishedChatModels, 1)
  rows = [model('fresh', { expires_at: new Date(now).toISOString() })]
  assert.equal((await syncOnce(opts)).publishedChatModels, 0)
})

test('recognizes a legacy HTTP refusal of the optional namespace filter and retries a full live read', async t => {
  const { createTransport } = await import('../sync-router-live-models.mjs')
  const { mkdtemp, writeFile, rm } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const root = await mkdtemp(join(tmpdir(), 'router-scoped-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const log = join(root, 'launch.log'); await writeFile(log, 'http://127.0.0.1:3080/?token=fixture\n')
  const fixture = host(); const reads = []
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    if (new URL(url).searchParams.has('token')) return new Response(null, { status: 303, headers: { 'set-cookie': 'fixture=value' } })
    const args = JSON.parse(options.body).payload.args; reads.push(args)
    if (args.ns) return new Response('{}', { status: 400 })
    return new Response(JSON.stringify({ type: 'server-response', result: { ok: true, value: { writable: true, namespaces: [fixture.view] } } }))
  })
  const { rpc } = createTransport({ appUrl: 'http://127.0.0.1:3080/', catalogUrl: 'https://router.example/v1', launchLog: log })
  const reader = createSettingsReader(rpc)
  await reader(); await reader(); await reader()
  assert.deepEqual(reads, [{}, { ns: 'llm-pi-ai' }, {}, {}])
})

test('recognizes a legacy generated descriptor refusal of ns without retaining stale models', async t => {
  const { createTransport } = await import('../sync-router-live-models.mjs')
  const { mkdtemp, writeFile, rm } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const root = await mkdtemp(join(tmpdir(), 'router-scoped-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const log = join(root, 'launch.log'); await writeFile(log, 'http://127.0.0.1:3080/?token=fixture\n')
  const fixture = host(); const reads = []
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    if (new URL(url).searchParams.has('token')) return new Response(null, { status: 303, headers: { 'set-cookie': 'fixture=value' } })
    const args = JSON.parse(options.body).payload.args; reads.push(args)
    if (args.ns) return new Response(JSON.stringify({ type: 'server-response', result: { ok: false, error: { code: 'gateway/arguments-invalid', message: 'args fields do not match the descriptor: unexpected ns' } } }))
    return new Response(JSON.stringify({ type: 'server-response', result: { ok: true, value: { writable: true, namespaces: [fixture.view] } } }))
  })
  const { rpc } = createTransport({ appUrl: 'http://127.0.0.1:3080/', catalogUrl: 'https://router.example/v1', launchLog: log })
  const reader = createSettingsReader(rpc)
  await reader(); await reader(); await reader()
  assert.deepEqual(reads, [{}, { ns: 'llm-pi-ai' }, {}, {}])
})


const openaiModel = id => model(id, {
  protocols: { openai: 'proved' },
  capabilities: { text: 'proved', tools: 'proved', openaiTools: 'proved', openaiStream: 'proved' },
})

test('uses fresh OpenAI tools/stream proof for an OpenAI route and refuses unsupported protocols', () => {
  const rows = [openaiModel('openai'), model('anthropic'), openaiModel('expired')]
  rows[2].x_9r.expires_at = new Date(now).toISOString()
  assert.deepEqual(selectModels(catalog(rows), [], now, 'openai-completions').map(row => row.id), ['openai'])
  assert.throws(() => selectModels(catalog(rows), [], now, 'openai-responses'), /provider_mismatch/)
})

test('synchronizes a configured OpenAI route without changing its options', async () => {
  const fixture = host(); fixture.view.value.providers['9router'].api = 'openai-completions'
  const before = structuredClone(fixture.view.value.providers['9router']); const calls = []
  const result = await syncOnce({ ...options(fixture), fetchCatalog: async api => { calls.push(api); return catalog([openaiModel('opus'), model('wrong-protocol')]) } })
  assert.equal(result.ok, true); assert.deepEqual(result.catalogModelIds, ['opus'])
  assert.deepEqual(calls, ['openai-completions'])
  const { models: ignored, ...remaining } = fixture.view.value.providers['9router']
  const { models: prior, ...expected } = before; assert.deepEqual(remaining, expected)
})

test('refetches protocol-specific evidence when a concurrent edit changes the route API', async () => {
  const fixture = host(); const original = fixture.rpc; const calls = []; let conflict = true
  const rpc = async (method, args) => {
    if (method === 'settings/mutate' && conflict) {
      conflict = false; fixture.view.value.providers['9router'].api = 'openai-completions'; fixture.view.revision++
      throw Object.assign(new Error('fixture'), { code: 'settings/conflict' })
    }
    return original(method, args)
  }
  const result = await syncOnce({ ...options(fixture), rpc, fetchCatalog: async api => { calls.push(api); return catalog([api === 'openai-completions' ? openaiModel('new') : model('old-protocol')]) } })
  assert.deepEqual(result.catalogModelIds, ['new']); assert.deepEqual(calls, ['anthropic-messages', 'openai-completions'])
  assert.deepEqual(fixture.view.value.providers['9router'].models.map(row => row.id), ['new'])
})

test('queries OpenAI proof fields over the authenticated catalog transport', async t => {
  const { createTransport } = await import('../sync-router-live-models.mjs'); const calls = []
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push(new URL(url)); assert.equal(options.headers.authorization, 'Bearer fixture')
    return new Response(JSON.stringify(catalog([openaiModel('opus')])))
  })
  const transport = createTransport({ appUrl: 'http://127.0.0.1:3080/', catalogUrl: 'https://router.example/v1', launchLog: 'unused', apiKey: 'fixture' })
  await transport.fetchCatalog('openai-completions')
  assert.equal(calls[0].searchParams.get('protocol'), 'openai')
  assert.equal(calls[0].searchParams.get('capability'), 'text,tools,openaiTools,openaiStream')
})

test('withdraws OpenAI choices on network failure without changing protocol or widening lease', async () => {
  const fixture = host(); fixture.view.value.providers['9router'].api = 'openai-completions'
  const result = await syncOnce({ ...options(fixture), fetchCatalog: async () => { throw new Error('private fixture') } })
  assert.equal(result.ok, false); assert.deepEqual(fixture.view.value.providers['9router'].models, [])
  assert.equal(fixture.view.value.providers['9router'].api, 'openai-completions')
  assert.ok(Date.parse(result.validUntil) - Date.parse(result.synchronizedAt) <= 60000)
})


test('retries one transient catalog timeout using new proof without extending lease', async () => {
  const fixture = host(); let calls = 0
  const result = await syncOnce({ ...options(fixture), fetchCatalog: async () => {
    if (++calls === 1) throw Object.assign(new Error('private fixture'), { name: 'TimeoutError' })
    return catalog([model('fresh')])
  } })
  assert.equal(calls, 2); assert.equal(result.ok, true); assert.equal(result.catalogAttempts, 2)
  assert.deepEqual(result.catalogModelIds, ['fresh'])
  assert.ok(Date.parse(result.validUntil) - Date.parse(result.synchronizedAt) <= 60000)
})

test('withdraws choices after two transient failures and sanitizes diagnostics', async () => {
  const fixture = host(); let calls = 0
  const result = await syncOnce({ ...options(fixture), fetchCatalog: async () => {
    calls++; throw Object.assign(new Error('SECRET private fixture'), { name: 'TimeoutError' })
  } })
  assert.equal(calls, 2); assert.equal(result.ok, false); assert.equal(result.catalogAttempts, 2)
  assert.equal(result.catalogFailureReason, 'catalog_timeout'); assert.deepEqual(result.catalogModelIds, [])
  assert.equal(JSON.stringify(result).includes('SECRET'), false)
})

test('does not retry authentication, invalid proof, or generic application errors', async () => {
  for (const failure of [Object.assign(new Error('SECRET'), { code: 'http_failed', httpStatus: 401 }), new Error('SECRET'), null]) {
    const fixture = host(); let calls = 0
    const result = await syncOnce({ ...options(fixture), fetchCatalog: async () => {
      calls++; if (failure) throw failure; return { data: [model('unsafe')] }
    } })
    assert.equal(calls, 1); assert.equal(result.ok, false); assert.deepEqual(result.catalogModelIds, [])
    assert.equal(JSON.stringify(result).includes('SECRET'), false)
  }
})

test('retries catalog HTTP 503 but excludes a proof that expired during the retry', async () => {
  const fixture = host(); let calls = 0; let tick = now
  const row = model('expired')
  const result = await syncOnce({ ...options(fixture), now: () => tick, fetchCatalog: async () => {
    if (++calls === 1) throw Object.assign(new Error('fixture'), { code: 'http_failed', httpStatus: 503 })
    tick += 60000; return catalog([row])
  } })
  assert.equal(calls, 2); assert.equal(result.ok, true); assert.deepEqual(result.catalogModelIds, [])
})

test('catalog HTTP failure exposes status without response body or credentials', async t => {
  const { createTransport } = await import('../sync-router-live-models.mjs')
  t.mock.method(globalThis, 'fetch', async () => new Response('SECRET upstream body', { status: 503 }))
  const transport = createTransport({ appUrl: 'http://127.0.0.1:3080/', catalogUrl: 'https://router.example/v1', launchLog: 'unused', apiKey: 'fixture' })
  await assert.rejects(transport.fetchCatalog(), error => {
    assert.equal(error.code, 'http_failed'); assert.equal(error.httpStatus, 503)
    assert.equal(error.message.includes('SECRET'), false); return true
  })
})
