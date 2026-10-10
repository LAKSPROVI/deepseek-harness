#!/usr/bin/env node
/** Synchronize a proved router catalog into an existing Harness provider through Settings RPC. */
import { createServer } from 'node:net'
import { randomUUID, createHash } from 'node:crypto'
import { readFile, writeFile, rename, mkdir, link, unlink, copyFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { isDeepStrictEqual, parseArgs } from 'node:util'

function proofForApi(api) {
  if (api === 'anthropic-messages') return { protocol: 'anthropic', fields: ['text', 'tools', 'anthropicTools', 'anthropicStream'] }
  if (api === 'openai-completions') return { protocol: 'openai', fields: ['text', 'tools', 'openaiTools', 'openaiStream'] }
  throw fail('provider_mismatch')
}
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const fail = code => Object.assign(new Error(code), { code })
const positive = value => Number.isSafeInteger(value) && value > 0
function catalogFailure(error) {
  if (error?.name === 'TimeoutError') return { catalogFailureReason: 'catalog_timeout' }
  if (error?.code === 'http_failed' && Number.isInteger(error.httpStatus) && error.httpStatus >= 100 && error.httpStatus <= 599) return { catalogFailureReason: 'catalog_http_failed', catalogHttpStatus: error.httpStatus }
  if (['ECONNRESET', 'ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_SOCKET'].includes(error?.cause?.code ?? error?.code)) return { catalogFailureReason: 'catalog_network_failed' }
  if (['catalog_not_strict', 'catalog_invalid', 'body_missing', 'body_too_large', 'catalog_key_missing'].includes(error?.code)) return { catalogFailureReason: error.code }
  return { catalogFailureReason: 'catalog_failed' }
}
function retryableCatalogFailure(detail) {
  return ['catalog_timeout', 'catalog_network_failed'].includes(detail.catalogFailureReason)
    || detail.catalogFailureReason === 'catalog_http_failed' && detail.catalogHttpStatus >= 500
}

const normalize = value => new URL(value).href.replace(/\/$/u, '')
function timestamp(value) {
  return typeof value === 'string' && /(?:Z|[+-]\d{2}:\d{2})$/u.test(value) ? Date.parse(value) : NaN
}

/** Project fresh concrete agent models for the configured protocol; retain options by exact ID. */
export function selectModels(catalog, previous = [], now = Date.now(), api = 'anthropic-messages') {
  const proof = proofForApi(api)
  if (!record(catalog) || catalog.x_9r_catalog?.availability_mode !== 'strict') throw fail('catalog_not_strict')
  if (!Array.isArray(catalog.data) || catalog.data.length > 20000) throw fail('catalog_invalid')
  const seen = new Set()
  for (const row of catalog.data) {
    if (!record(row) || typeof row.id !== 'string' || !row.id.trim() || seen.has(row.id)) throw fail('catalog_invalid')
    seen.add(row.id)
  }
  const existing = new Map(previous.map(model => [model.id, model]))
  return catalog.data.filter(row => {
    const evidence = row.x_9r
    if (!record(evidence) || evidence.available !== true || evidence.kind !== 'chat' || row.id.startsWith('9r/')) return false
    const checked = timestamp(evidence.checked_at); const expires = timestamp(evidence.expires_at)
    return Number.isFinite(checked) && Number.isFinite(expires) && checked <= now + 5000
      && expires > now && expires > checked && expires - checked <= 600000
      && evidence.protocols?.[proof.protocol] === 'proved'
      && proof.fields.every(field => evidence.capabilities?.[field] === 'proved')
  }).map(row => {
    const prior = existing.get(row.id)
    const result = { ...prior, id: row.id, name: prior?.name ?? (typeof row.name === 'string' ? row.name : row.id), input: ['text'] }
    if (positive(row.capabilities?.contextWindow)) result.contextWindow = Math.min(row.capabilities.contextWindow, positive(prior?.contextWindow) ? prior.contextWindow : 850000, 850000)
    else if (positive(result.contextWindow)) result.contextWindow = Math.min(result.contextWindow, 850000)
    if (positive(row.capabilities?.maxOutput)) result.maxTokens = Math.min(row.capabilities.maxOutput, positive(prior?.maxTokens) ? prior.maxTokens : row.capabilities.maxOutput)
    if (positive(result.contextWindow) && positive(result.maxTokens)) result.maxTokens = Math.min(result.maxTokens, result.contextWindow)
    return result
  }).sort((left, right) => left.id.localeCompare(right.id, 'en'))
}

function providerView(document, provider, catalogUrl) {
  if (document.writable !== true) throw fail('settings_read_only')
  const matches = document.namespaces.filter(view => record(view.value?.providers?.[provider]))
  if (matches.length !== 1) throw fail('provider_missing_or_ambiguous')
  const view = matches[0]; const route = view.value.providers[provider]
  if (!['anthropic-messages', 'openai-completions'].includes(route.api) || typeof route.baseURL !== 'string' || normalize(route.baseURL) !== normalize(catalogUrl)) throw fail('provider_mismatch')
  if (!Array.isArray(route.models)) throw fail('provider_models_invalid')
  return { view, route }
}

/** Discover the provider namespace once, then request only its live redacted form.
 * A removed namespace triggers fresh discovery; revisions and model evidence are never cached.
 */
export function createSettingsReader(rpc, provider = '9router') {
  let ns
  let supportsFilter = true
  return async () => {
    let document
    try { document = await rpc('settings/describe', ns && supportsFilter ? { ns } : {}) }
    catch (error) {
      if (!ns || !supportsFilter || error.code !== 'settings_filter_unsupported') throw error
      supportsFilter = false
      document = await rpc('settings/describe', {})
    }
    if (!record(document) || !Array.isArray(document.namespaces)) throw fail('rpc_invalid')
    let matches = document.namespaces.filter(view => record(view.value?.providers?.[provider]))
    if (ns && matches.length === 0) {
      ns = undefined
      document = await rpc('settings/describe', {})
      if (!record(document) || !Array.isArray(document.namespaces)) throw fail('rpc_invalid')
      matches = document.namespaces.filter(view => record(view.value?.providers?.[provider]))
    }
    ns = matches.length === 1 && typeof matches[0].ns === 'string' ? matches[0].ns : undefined
    return document
  }
}

/** One revision-checked update. Unconfirmed listings remove stale selectable choices. */
export async function syncOnce(options) {
  const { rpc, fetchCatalog, backup, provider = '9router', catalogUrl, now = Date.now } = options
  const describeSettings = options.describeSettings ?? (() => rpc('settings/describe', {}))
  let target = providerView(await describeSettings(), provider, catalogUrl)
  const preferences = new Map((options.modelPreferences ?? []).map(model => [model.id, model]))
  const remember = async () => { for (const model of target.route.models) preferences.set(model.id, model); await options.savePreferences?.([...preferences.values()]) }
  await remember()
  let catalog; let catalogError; let catalogApi; let failureDetail; let catalogAttempts = 0
  const refreshCatalog = async () => {
    catalog = undefined; catalogError = undefined; failureDetail = undefined; catalogApi = target.route.api
    for (let attempt = 0; attempt < 2; attempt++) {
      catalogAttempts++
      try {
        catalog = await fetchCatalog(catalogApi); selectModels(catalog, target.route.models, now(), catalogApi)
        catalogError = undefined; failureDetail = undefined; return
      } catch (error) {
        catalog = undefined; catalogError = 'catalog_unconfirmed'; failureDetail = catalogFailure(error)
        if (attempt === 1 || !retryableCatalogFailure(failureDetail)) return
      }
    }
  }
  await refreshCatalog()
  for (let attempt = 0; attempt < 3; attempt++) {
    if (catalogApi !== target.route.api) await refreshCatalog()
    const models = catalogError ? [] : selectModels(catalog, [...preferences.values()], now(), catalogApi)
    const changed = !isDeepStrictEqual(models, target.route.models)
    if (changed) {
      await backup()
      try {
        await rpc('settings/mutate', { ns: target.view.ns, expectedRevision: target.view.revision, ops: [{ op: 'set', path: ['providers', provider, 'models'], value: models }] })
      } catch (error) {
        if (error.code !== 'settings/conflict' || attempt === 2) throw error
        target = providerView(await describeSettings(), provider, catalogUrl)
        await remember()
        continue
      }
    }
    const synchronizedAtMs = now()
    return { ok: !catalogError, ...(catalogError ? { error: catalogError, ...failureDetail } : {}), catalogAttempts, synchronizedAt: new Date(synchronizedAtMs).toISOString(), catalogModelIds: models.map(model => model.id), validUntil: new Date(Math.min(synchronizedAtMs + 60000, synchronizedAtMs + (options.intervalMs ?? 30000) * 2, ...models.map(model => timestamp(catalog.data.find(row => row.id === model.id).x_9r.expires_at)))).toISOString(), catalogGeneration: typeof catalog?.x_9r_catalog?.generation === 'string' ? catalog.x_9r_catalog.generation : null, catalogProtocol: catalogApi, publishedChatModels: models.length, availableRoutes: models.length, totalRoutes: Array.isArray(catalog?.data) ? catalog.data.length : 0, changed }
  }
  throw fail('settings_conflict')
}


const publicSyncFailures = ['provider_mismatch', 'settings_read_only', 'provider_missing_or_ambiguous', 'settings_conflict', 'backup_failed', 'app_auth_unavailable', 'app_auth_failed']
function operationFailure(error) {
  if (error?.name === 'TimeoutError') return 'timeout'
  if (['ECONNRESET', 'ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_SOCKET'].includes(error?.cause?.code ?? error?.code)) return 'network_failed'
  if ([...publicSyncFailures, 'settings/conflict', 'settings_refused', 'settings_filter_unsupported', 'rpc_invalid', 'http_failed', 'body_missing', 'body_too_large'].includes(error?.code)) return error.code
  return 'operation_failed'
}

/** Run the normal update with bounded stage timings and allowlisted failures.
 * @param options Same live inputs as syncOnce; no arguments, response bodies, paths or secrets enter diagnostics.
 * @returns The normal publication result, or a failed confirmation without selectable choices, with sanitized timings.
 */
export async function syncMeasured(options) {
  const started = Date.now(); const phases = []
  const measure = (phase, fn) => async (...args) => {
    const start = Date.now(); let failure
    try { return await fn(...args) }
    catch (error) { failure = operationFailure(error); throw error }
    finally { if (phases.length < 32) phases.push({ phase, ms: Date.now() - start, ok: failure === undefined, ...(failure === undefined ? {} : { failure }) }) }
  }
  const rpc = (method, args) => measure(method === 'settings/mutate' ? 'settings/mutate' : 'settings/describe', options.rpc)(method, args)
  let result
  try {
    result = await syncOnce({ ...options, rpc,
      describeSettings: measure('settings/describe', options.describeSettings ?? (() => options.rpc('settings/describe', {}))),
      fetchCatalog: measure('fetchCatalog', options.fetchCatalog),
      backup: measure('profileBackup', options.backup),
      ...(options.savePreferences ? { savePreferences: measure('savePreferences', options.savePreferences) } : {}),
    })
  } catch (error) {
    result = { ok: false, error: publicSyncFailures.includes(error?.code) ? error.code : 'app_unavailable', synchronizedAt: new Date((options.now ?? Date.now)()).toISOString() }
  }
  return { ...result, diagnostics: { elapsedMs: Date.now() - started, phases } }
}

async function boundedJson(response) {
  if (!response.ok) { await response.body?.cancel(); throw Object.assign(fail('http_failed'), { httpStatus: response.status }) }
  const reader = response.body?.getReader(); if (!reader) throw fail('body_missing')
  let length = 0; const chunks = []
  try {
    for (;;) {
      const { done, value } = await reader.read(); if (done) break
      length += value.length; if (length > 4 * 1024 * 1024) throw fail('body_too_large')
      chunks.push(value)
    }
  } finally { await reader.cancel().catch(() => {}) }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

/** Authenticated HTTP transport, using the local launch token only for its cookie exchange. */
export function createTransport({ appUrl, catalogUrl, launchLog, apiKey, timeoutMs = 8000, appTimeoutMs = timeoutMs }) {
  const app = new URL(appUrl); const catalog = new URL(catalogUrl)
  if (app.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(app.hostname) || app.username || app.password || app.search || app.hash) throw fail('app_url_invalid')
  if (catalog.protocol !== 'https:' && !(catalog.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(catalog.hostname))) throw fail('catalog_url_invalid')
  if (catalog.username || catalog.password || catalog.search || catalog.hash) throw fail('catalog_url_invalid')
  let cookie
  async function authenticate() {
    const log = await readFile(launchLog, 'utf8')
    const urls = log.match(/https?:\/\/[^\s]+/gu) ?? []
    const launch = urls.map(value => { try { return new URL(value) } catch { return null } }).filter(url => url?.origin === app.origin && url.searchParams.has('token')).at(-1)
    if (!launch) throw fail('app_auth_unavailable')
    const response = await fetch(launch, { redirect: 'manual', signal: AbortSignal.timeout(appTimeoutMs) })
    cookie = response.headers.getSetCookie().map(value => value.split(';')[0]).join('; ')
    await response.body?.cancel()
    if (response.status !== 303 || !cookie) throw fail('app_auth_failed')
  }
  return {
    fetchCatalog: async (api = 'anthropic-messages') => {
      const proof = proofForApi(api)
      if (!apiKey) throw fail('catalog_key_missing')
      const url = new URL(normalize(catalog.href) + '/models')
      url.searchParams.set('kind', 'chat'); url.searchParams.set('protocol', proof.protocol); url.searchParams.set('capability', proof.fields.join(','))
      return boundedJson(await fetch(url, { headers: { authorization: `Bearer ${apiKey}` }, redirect: 'error', signal: AbortSignal.timeout(timeoutMs) }))
    },
    rpc: async (method, args) => {
      if (!cookie) await authenticate()
      const request = () => fetch(new URL(`api/${method}`, app), { method: 'POST', headers: { 'content-type': 'application/json', cookie, origin: app.origin }, body: JSON.stringify({ type: 'client-request', rpcId: randomUUID(), method, payload: { args } }), redirect: 'error', signal: AbortSignal.timeout(appTimeoutMs) })
      let response = await request()
      if (response.status === 401) { await response.body?.cancel(); await authenticate(); response = await request() }
      if (method === 'settings/describe' && args.ns && response.status === 400) { await response.body?.cancel(); throw fail('settings_filter_unsupported') }
      const envelope = await boundedJson(response)
      if (envelope.type !== 'server-response' || !record(envelope.result)) throw fail('rpc_invalid')
      if (envelope.result.ok !== true) {
        if (method === 'settings/describe' && args.ns && ['gateway/bad-request', 'gateway/arguments-invalid'].includes(envelope.result.error?.code)) throw fail('settings_filter_unsupported')
        throw fail(envelope.result.error?.code === 'settings/conflict' ? 'settings/conflict' : 'settings_refused')
      }
      return envelope.result.value
    },
  }
}

async function atomicJson(file, value) {
  await mkdir(path.dirname(file), { recursive: true })
  const temporary = `${file}.${randomUUID()}.tmp`
  try {
    await writeFile(temporary, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' })
    // Windows readers may briefly deny replacement. Retain the previous complete JSON,
    // retry only sharing-related errors, and never extend the original positive lease.
    const retryDeadline = Date.now() + 1000
    for (;;) {
      if (value?.ok === true && typeof value.validUntil === 'string' && Date.now() >= timestamp(value.validUntil)) throw fail('state_expired')
      try { await rename(temporary, file); break }
      catch (error) {
        if (process.platform !== 'win32' || !['EPERM', 'EACCES', 'EBUSY'].includes(error.code) || Date.now() >= retryDeadline) throw error
        await new Promise(resolve => setTimeout(resolve, Math.min(100, retryDeadline - Date.now())))
      }
    }
  } finally { await unlink(temporary).catch(() => {}) }
}

/** Copy and verify the active patch before an API mutation; never expose its content. */
export function profileBackup(profile, directory) {
  return async () => {
    await mkdir(directory, { recursive: true })
    const source = await readFile(profile)
    const digest = createHash('sha256').update(source).digest('hex')
    const destination = path.join(directory, `cordis.patch-${digest}.yml`)
    try { await copyFile(profile, destination, 1) } catch (error) { if (error.code !== 'EEXIST') throw fail('backup_failed') }
    if (createHash('sha256').update(await readFile(destination)).digest('hex') !== digest) throw fail('backup_failed')
  }
}

/** Run once or poll, keeping one exclusive process lock until completion. */
export async function main(defaults = {}, argv = process.argv.slice(2)) {
  const { values } = parseArgs({ args: argv, options: { home: { type: 'string' }, 'app-url': { type: 'string' }, 'catalog-url': { type: 'string' }, 'launch-log': { type: 'string' }, provider: { type: 'string' }, 'api-key-env': { type: 'string' }, 'interval-ms': { type: 'string' }, 'app-timeout-ms': { type: 'string' }, 'backup-dir': { type: 'string' }, watch: { type: 'boolean' } } })
  const settings = { ...defaults, ...values }
  if (settings.provider !== undefined && settings.provider !== '9router') throw fail('provider_mismatch')
  const home = settings.home ?? process.env.DSH_HOME
  if (!home || !settings['app-url'] || !settings['catalog-url'] || !settings['launch-log']) throw fail('configuration_missing')
  const interval = Number(settings['interval-ms'] ?? 30000)
  if (!Number.isSafeInteger(interval) || interval < 1000) throw fail('interval_invalid')
  const appTimeoutMs = Number(settings['app-timeout-ms'] ?? 30000)
  if (!Number.isSafeInteger(appTimeoutMs) || appTimeoutMs <= 0 || appTimeoutMs > 30000) throw fail('app_timeout_invalid')
  const key = process.env[settings['api-key-env'] ?? 'ROUTER_API_KEY']
  const transport = createTransport({ appUrl: settings['app-url'], catalogUrl: settings['catalog-url'], launchLog: settings['launch-log'], apiKey: key, appTimeoutMs })
  const describeSettings = createSettingsReader(transport.rpc, settings.provider ?? '9router')
  const preferencesFile = path.join(home, 'router-live-model-preferences.json')
  let modelPreferences = []
  try { modelPreferences = JSON.parse(await readFile(preferencesFile, 'utf8')); if (!Array.isArray(modelPreferences)) throw fail('preferences_invalid') }
  catch (error) { if (error.code !== 'ENOENT') throw fail('preferences_invalid') }
  const savePreferences = async models => { if (!isDeepStrictEqual(models, modelPreferences)) { await atomicJson(preferencesFile, models); modelPreferences = models } }
  const lockFile = path.join(home, 'sync-9router-models.lock')
  const requestFile = path.join(home, 'sync-9router-models-request.json')
  const stateFile = path.join(home, 'sync-9router-models-state.json')
  const acquire = async () => {
    const temporary = `${lockFile}.${randomUUID()}.tmp`
    try {
      await writeFile(temporary, JSON.stringify({ pid: process.pid }), { flag: 'wx' })
      await link(temporary, lockFile)
    } finally { await unlink(temporary).catch(() => {}) }
  }
  try { await acquire() }
  catch (error) {
    if (error.code !== 'EEXIST') throw fail('lock_failed')
    const ownerText = await readFile(lockFile, 'utf8')
    const owner = JSON.parse(ownerText)
    if (!positive(owner.pid)) throw fail('lock_invalid')
    let alive = false
    try { process.kill(owner.pid, 0); alive = true }
    catch (probe) { if (probe.code !== 'ESRCH') throw fail('lock_owner_unconfirmed') }
    if (alive) {
      if (settings.watch) return { ok: true, alreadyRunning: true }
      const requestId = randomUUID()
      await atomicJson(requestFile, { requestId })
      const deadline = Date.now() + 20000
      do {
        await new Promise(resolve => setTimeout(resolve, 250))
        try { const state = JSON.parse(await readFile(stateFile, 'utf8')); if (state.completedRequest === requestId) { process.stdout.write(JSON.stringify(state) + '\n'); return state } }
        catch (error) { if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw fail('state_unreadable') }
      } while (Date.now() < deadline)
      throw fail('sync_request_timeout')
    }
    // Serialize dead-owner recovery with a crash-released OS lock, then recheck membership.
    // The socket accepts no protocol or data; an unrelated port collision fails closed.
    const mutex = createServer(socket => { socket.destroy() })
    const port = 44000 + createHash('sha256').update(path.resolve(home).toLowerCase()).digest().readUInt32BE(0) % 10000
    try {
      await new Promise((resolve, reject) => {
        mutex.once('error', reject)
        mutex.listen({ host: '127.0.0.1', port, exclusive: true }, resolve)
      })
      if (await readFile(lockFile, 'utf8') !== ownerText) throw fail('lock_owner_changed')
      await unlink(lockFile); await acquire()
    } finally { await new Promise(resolve => { mutex.close(() => { resolve() }) }) }
  }
  let stopped = false
  const stop = () => { stopped = true }
  process.on('SIGINT', stop); process.on('SIGTERM', stop)
  let loopPhase = 'enabled/write'
  const recordLoopFailure = async (error, phase) => {
    const allowed = ['EACCES', 'EPERM', 'EBUSY', 'ENOSPC', 'ENOENT', 'EIO', 'EXDEV', 'EEXIST', 'ENOTEMPTY', 'EISDIR', 'ENOTDIR', 'EMFILE', 'ENFILE', 'request_invalid', 'state_expired']
    const code = allowed.includes(error?.code) ? error.code : 'operation_failed'
    // A failed publication never renews the lease; keep only the latest bounded diagnostic.
    await atomicJson(path.join(home, 'sync-9router-models-failure.json'), { ok: false, phase, reason: code, failedAt: new Date().toISOString() }).catch(() => {})
  }
  try {
    await writeFile(path.join(home, 'router-live-catalog.enabled'), '1\n')
    do {
      loopPhase = 'request/read'
      let requestId
      try { const request = JSON.parse(await readFile(requestFile, 'utf8')); if (typeof request.requestId === 'string') requestId = request.requestId }
      catch (error) { if (error.code !== 'ENOENT') throw fail('request_invalid') }
      loopPhase = 'synchronize'
      const state = await syncMeasured({ ...transport, describeSettings, modelPreferences, savePreferences, catalogUrl: settings['catalog-url'], provider: settings.provider ?? '9router', intervalMs: interval, backup: profileBackup(path.join(home, 'profiles/web/cordis.patch.yml'), settings['backup-dir'] ?? path.join(home, 'backups/router-live-catalog')) })
      if (requestId) state.completedRequest = requestId
      loopPhase = 'state/write'
      await atomicJson(stateFile, state)
      if (!settings.watch) { process.stdout.write(JSON.stringify(state) + '\n'); return state }
      const next = Date.now() + interval
      while (!stopped && Date.now() < next) {
        loopPhase = 'wait/request'
        try { const request = JSON.parse(await readFile(requestFile, 'utf8')); if (request.requestId !== requestId) break }
        catch (error) { if (error.code !== 'ENOENT') throw fail('request_invalid') }
        await new Promise(resolve => { const wake = () => { clearTimeout(timer); process.off('SIGINT', wake); process.off('SIGTERM', wake); resolve() }; const timer = setTimeout(wake, Math.min(500, next - Date.now())); process.once('SIGINT', wake); process.once('SIGTERM', wake) })
      }
    } while (!stopped)
  } catch (error) {
    await recordLoopFailure(error, loopPhase)
    throw error
  } finally {
    process.off('SIGINT', stop); process.off('SIGTERM', stop)
    try { await unlink(lockFile) }
    catch (error) { await recordLoopFailure(error, 'lock/release'); throw error }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().then(result => { if (result?.ok === false) process.exitCode = 1 }).catch(() => { process.stderr.write('router_sync_failed\n'); process.exitCode = 1 })
}
