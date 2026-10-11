import assert from 'node:assert/strict'
import { test } from 'node:test'
import * as sync from '../sync-router-live-models.mjs'
const initial = Date.parse('2026-10-11T12:00:00Z')
const iso = n => new Date(n).toISOString()
const row = (id, expiry = initial + 500000) => ({ id, x_9r: { available: true, kind: 'chat', checked_at: iso(initial), expires_at: iso(expiry), generation: 'fixture-generation', protocols: { openai: 'proved' }, capabilities: { text: 'proved', tools: 'proved', openaiTools: 'proved', openaiStream: 'proved' } } })
const catalog = data => ({ data, x_9r_catalog: { availability_mode: 'strict', generation: 'fixture' } })
const route = { api: 'openai-completions', baseURL: 'https://fixture.invalid/v1', apiKeyEnv: 'FIXTURE_KEY', models: [{ id: 'A', maxTokens: 1000 }] }
function options(fetchCatalog, extra = {}) { return { now: () => initial, catalogUrl: route.baseURL, fetchCatalog, describeSettings: async () => ({ writable: true, namespaces: [{ ns: 'fixture', value: { providers: { '9router': route } } }] }), rpc: async () => assert.fail('runtime discovery must never mutate Settings'), backup: async () => assert.fail('runtime discovery must never back up a changed profile'), ...extra } }
const timeout = async () => { throw Object.assign(Error('private message'), { name: 'TimeoutError' }) }
test('runtime discovery adds new models without changing Settings and preserves options', async () => {
 const result = await sync.syncRuntimeSnapshot(options(async () => catalog([row('A'), row('B')])) )
 assert.equal(result.schema, 2); assert.deepEqual(result.catalogModelIds, ['A', 'B']); assert.equal(result.models[0].model.maxTokens, 1000)
})
test('transport outage preserves original model evidence and only expires its own route', async () => {
 const previousState = await sync.syncRuntimeSnapshot(options(async () => catalog([row('A'), row('B', initial + 1000)])))
 const result = await sync.syncRuntimeSnapshot(options(timeout, { previousState, now: () => initial + 2000 }))
 assert.deepEqual(result.catalogModelIds, ['A']); assert.equal(result.models[0].evidence.expires_at, iso(initial + 500000)); assert.equal(result.transport, 'degraded')
 assert.equal(JSON.stringify(result).includes('private message'), false)
 const expired = await sync.syncRuntimeSnapshot(options(timeout, { previousState: result, now: () => initial + 500001 }))
 assert.deepEqual(expired.catalogModelIds, [])
})
test('authoritative removal and authentication failure revoke the previous evidence', async () => {
 const previousState = await sync.syncRuntimeSnapshot(options(async () => catalog([row('A')])))
 assert.deepEqual((await sync.syncRuntimeSnapshot(options(async () => catalog([]), { previousState }))).catalogModelIds, [])
 const denied = async () => { throw Object.assign(Error('private'), { code: 'http_failed', httpStatus: 401 }) }
 assert.deepEqual((await sync.syncRuntimeSnapshot(options(denied, { previousState }))).catalogModelIds, [])
})
test('changed credential reference cannot inherit the previous evidence', async () => {
 const previousState = await sync.syncRuntimeSnapshot(options(async () => catalog([row('A')])))
 const describeSettings = async () => ({ writable: true, namespaces: [{ ns: 'fixture', value: { providers: { '9router': { ...route, apiKeyEnv: 'CHANGED' } } } }] })
 assert.deepEqual((await sync.syncRuntimeSnapshot(options(timeout, { previousState, describeSettings }))).catalogModelIds, [])
})

test('malformed response does not reuse prior evidence and a restart cannot extend expiry', async () => {
 const previousState = await sync.syncRuntimeSnapshot(options(async () => catalog([row('A')])))
 const invalid = await sync.syncRuntimeSnapshot(options(async () => ({ data: [] }), { previousState }))
 assert.deepEqual(invalid.catalogModelIds, [])
 const restarted = await sync.syncRuntimeSnapshot(options(timeout, { previousState: JSON.parse(JSON.stringify(previousState)), now: () => initial + 499999 }))
 assert.equal(restarted.models[0].evidence.expires_at, iso(initial + 500000))
 assert.deepEqual((await sync.syncRuntimeSnapshot(options(timeout, { previousState: restarted, now: () => initial + 500000 }))).catalogModelIds, [])
})
test('local RPC timeout does not destroy valid server evidence', async () => {
 const previousState = await sync.syncRuntimeSnapshot(options(async () => catalog([row('A')])))
 const result = await sync.syncRuntimeSnapshot(options(timeout, { previousState, describeSettings: timeout }))
 assert.deepEqual(result.catalogModelIds, ['A'])
})
test('degraded snapshots retain learned context capacity and max output for newly discovered models', async () => {
 const candidate = row('B'); candidate.capabilities = { contextWindow: 65536, maxOutput: 8192 }
 const previousState = await sync.syncRuntimeSnapshot(options(async () => catalog([candidate])))
 const result = await sync.syncRuntimeSnapshot(options(timeout, { previousState }))
 assert.equal(result.models[0].model.contextWindow, 65536)
 assert.equal(result.models[0].model.maxTokens, 8192)
})

test('a response with older evidence cannot replace the last confirmed snapshot', async () => {
 const previousState = await sync.syncRuntimeSnapshot(options(async () => catalog([row('A')])))
 const older = row('A'); older.x_9r.checked_at = iso(initial - 1)
 const result = await sync.syncRuntimeSnapshot(options(async () => catalog([older]), { previousState }))
 assert.deepEqual(result.catalogModelIds, [])
})

test('configured capacities never widen during transport degradation', async () => {
 const candidate = row('A'); candidate.capabilities = { contextWindow: 65536, maxOutput: 8192 }
 const describeSettings = async () => ({ writable: true, namespaces: [{ value: { providers: { '9router': { ...route, models: [{ id: 'A', contextWindow: 100000, maxTokens: 20000 }] } } } }] })
 const previousState = await sync.syncRuntimeSnapshot(options(async () => catalog([candidate]), { describeSettings }))
 const result = await sync.syncRuntimeSnapshot(options(timeout, { previousState, describeSettings }))
 assert.equal(result.models[0].model.contextWindow, 65536); assert.equal(result.models[0].model.maxTokens, 8192)
})
test('successful transport with a different credential reference cannot label old-key evidence as new-key evidence', async () => {
 await assert.rejects(sync.syncRuntimeSnapshot(options(async () => catalog([row('A')]), { credentialRef: 'DIFFERENT_KEY' })), { code: 'provider_mismatch' })
})

test('revoked models require new proof before reappearing, including after an empty listing', async () => {
 const first = await sync.syncRuntimeSnapshot(options(async () => catalog([row('A')])))
 const removed = await sync.syncRuntimeSnapshot(options(async () => catalog([]), { previousState: first, now: () => initial + 1000 }))
 const replay = await sync.syncRuntimeSnapshot(options(async () => catalog([row('A')]), { previousState: removed, now: () => initial + 2000 }))
 assert.deepEqual(replay.catalogModelIds, [])
 const fresh = row('A'); fresh.x_9r.checked_at = iso(initial + 2001)
 const restored = await sync.syncRuntimeSnapshot(options(async () => catalog([fresh]), { previousState: replay, now: () => initial + 2001 }))
 assert.deepEqual(restored.catalogModelIds, ['A'])
})

test('explicit negative evidence and repeated old responses cannot resurrect a model', async () => {
 const first = await sync.syncRuntimeSnapshot(options(async () => catalog([row('A')])))
 const negative = row('A'); negative.x_9r.available = false
 const withdrawn = await sync.syncRuntimeSnapshot(options(async () => catalog([negative]), { previousState: first, now: () => initial + 1000 }))
 assert.deepEqual((await sync.syncRuntimeSnapshot(options(async () => catalog([row('A')]), { previousState: withdrawn, now: () => initial + 2000 }))).catalogModelIds, [])
 const older = row('A'); older.x_9r.checked_at = iso(initial - 1)
 const rejected = await sync.syncRuntimeSnapshot(options(async () => catalog([older]), { previousState: first }))
 assert.deepEqual((await sync.syncRuntimeSnapshot(options(async () => catalog([older]), { previousState: rejected }))).catalogModelIds, [])
})

test('operational publication failure keeps temporal markers but withdraws every model', async () => {
 const first = await sync.syncMeasured(options(async () => catalog([row('A')]), { runtimeSnapshot: true }))
 const failed = await sync.syncMeasured(options(async () => catalog([row('A')]), { runtimeSnapshot: true, previousState: first, savePreferences: async () => { throw Object.assign(Error('fixture'), { code: 'ENOSPC' }) } }))
 assert.equal(failed.ok, false)
 const older = row('A'); older.x_9r.checked_at = iso(initial - 1)
 const replay = await sync.syncMeasured(options(async () => catalog([older]), { runtimeSnapshot: true, previousState: failed }))
 assert.deepEqual(replay.catalogModelIds, [])
})
