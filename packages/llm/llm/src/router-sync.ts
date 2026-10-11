/**
 * 9Router model catalog synchronization status reader and trigger executor.
 * Interacts with the local sync state file, execution logs, and background sync script.
 */

import { execFile } from 'node:child_process'
import { readFile, writeFile, rename, unlink } from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { existsSync, readFileSync, watch } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { RouterSyncStatus } from './types.ts'

const execFileAsync = promisify(execFile)

/** Maximum age in milliseconds before synchronization state is marked stale (24 hours). */
const STALE_THRESHOLD_MS = 24 * 60 * 60 * 1000

/**
 * Resolve DSH_HOME directory path with standard fallback cascade.
 * @param override - optional explicit path for testing.
 * @returns absolute path to DSH home directory.
 */
export function resolveDshHome(override?: string): string {
  if (override !== undefined && override.length > 0) return override
  if (process.env.DSH_HOME !== undefined && process.env.DSH_HOME.length > 0) return process.env.DSH_HOME
  const winDefault = 'D:\\APLICATIVOS\\DeepSeek Harness\\home'
  if (process.platform === 'win32' && existsSync(winDefault)) return winDefault
  return join(homedir(), '.dsh')
}

/**
 * Read current 9Router synchronization status from the state file and logs.
 * @param dshHomeOverride - optional DSH home path override.
 * @returns structured router sync status.
 */
export async function readRouterSyncStatus(dshHomeOverride?: string): Promise<RouterSyncStatus> {
  const dshHome = resolveDshHome(dshHomeOverride)
  const statePath = join(dshHome, 'sync-9router-models-state.json')
  const logPath = join(dshHome, 'logs', 'sync-9router-models.log')

  let synchronizedAt: string | undefined
  let monitorUpdatedAt: string | undefined
  let totalRoutes = 0
  let availableRoutes = 0
  let publishedChatModels = 0
  let visionModels: number | undefined
  let reasoningModels: number | undefined
  let averageLatencySeconds: number | undefined
  let isStale = true
  let lastError: string | undefined
  let currentState = false

  if (existsSync(statePath)) {
    try {
      const raw = await readFile(statePath, 'utf8')
      const data = JSON.parse(raw) as Record<string, unknown>
      currentState = typeof data.ok === 'boolean'
      if (data.ok === false) lastError = 'Router catalog is unconfirmed'
      if (typeof data.synchronizedAt === 'string') synchronizedAt = data.synchronizedAt
      if (typeof data.monitorUpdatedAt === 'string') monitorUpdatedAt = data.monitorUpdatedAt
      if (typeof data.totalRoutes === 'number') totalRoutes = data.totalRoutes
      if (typeof data.availableRoutes === 'number') availableRoutes = data.availableRoutes
      if (typeof data.publishedChatModels === 'number') publishedChatModels = data.publishedChatModels
      if (typeof data.visionModels === 'number') visionModels = data.visionModels
      if (typeof data.reasoningModels === 'number') reasoningModels = data.reasoningModels
      if (typeof data.averageLatencySeconds === 'number') averageLatencySeconds = data.averageLatencySeconds

      if (synchronizedAt !== undefined) {
        const syncTime = Date.parse(synchronizedAt)
        if (Number.isFinite(syncTime)) {
          isStale = Date.now() - syncTime > STALE_THRESHOLD_MS
          if (currentState) {
            const deadline = typeof data.validUntil === 'string' ? Date.parse(data.validUntil) : NaN
            isStale = data.ok !== true || !Number.isFinite(deadline) || Date.now() >= deadline || syncTime > Date.now() + 5000
          }
        }
      }
      if (data.schema === 2) {
        const rows = runtimeModels(data)
        availableRoutes = rows.length; publishedChatModels = rows.length
        isStale = data.ok !== true || ((data.transport === 'degraded' || Array.isArray(data.models) && data.models.length > 0) && rows.length === 0)
        if (data.transport === 'degraded') lastError = 'Catalog update unavailable; unexpired model evidence retained'
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
    }
  }

  // Check last log entry if present for error indications
  if (!currentState && existsSync(logPath)) {
    try {
      const logContent = await readFile(logPath, 'utf8')
      const lines = logContent.trim().split('\n').filter(Boolean)
      const lastLine = lines[lines.length - 1]
      if (lastLine !== undefined && lastLine.includes('failed:')) {
        lastError = lastLine.slice(lastLine.indexOf('failed:') + 7).trim()
      }
    } catch {
      // Ignore unreadable log
    }
  }

  return {
    ...synchronizedAt !== undefined ? { synchronizedAt } : {},
    ...monitorUpdatedAt !== undefined ? { monitorUpdatedAt } : {},
    totalRoutes,
    availableRoutes,
    publishedChatModels,
    ...visionModels !== undefined ? { visionModels } : {},
    ...reasoningModels !== undefined ? { reasoningModels } : {},
    ...averageLatencySeconds !== undefined ? { averageLatencySeconds } : {},
    isStale,
    ...lastError !== undefined ? { error: lastError } : {},
  }
}

/**
 * Trigger immediate execution of the 9Router models synchronization script.
 * @param dshHomeOverride - optional DSH home path override.
 * @returns updated synchronization status after execution.
 */
export async function executeRouterSync(dshHomeOverride?: string): Promise<RouterSyncStatus> {
  const dshHome = resolveDshHome(dshHomeOverride)
  const scriptMjs = join(dshHome, 'scripts', 'sync-9router-models.mjs')
  const scriptPs1 = join(dshHome, 'scripts', 'sync-9router-models.ps1')

  let execError: string | undefined

  if (existsSync(scriptMjs)) {
    try {
      await execFileAsync(process.execPath, [scriptMjs], {
        timeout: 25_000,
        env: { ...process.env, DSH_HOME: dshHome },
      })
    } catch (error) {
      execError = error instanceof Error ? error.message : String(error)
    }
  } else if (existsSync(scriptPs1) && process.platform === 'win32') {
    try {
      await execFileAsync('powershell.exe', [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        scriptPs1,
      ], {
        timeout: 25_000,
        env: { ...process.env, DSH_HOME: dshHome },
      })
    } catch (error) {
      execError = error instanceof Error ? error.message : String(error)
    }
  } else {
    execError = 'Synchronization script not found in DSH_HOME/scripts'
  }

  const updatedStatus = await readRouterSyncStatus(dshHome)
  if (execError !== undefined) {
    return {
      ...updatedStatus,
      error: execError,
    }
  }
  return updatedStatus
}

/** Per-route metadata accepted only while its original server evidence remains current. */
interface RuntimeModel {
  model: Record<string, unknown> & { id: string }
  expiresAt: number
}
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)
const zonedTime = (value: unknown): number => typeof value === 'string' && /(?:Z|[+-]\d{2}:\d{2})$/.test(value) ? Date.parse(value) : NaN

/** Validate a schema-2 snapshot; an invalid envelope or duplicate identity withdraws it entirely. */
function runtimeModels(data: unknown): RuntimeModel[] {
  if (!object(data) || data.schema !== 2 || data.ok !== true || !object(data.scope)
    || !['openai-completions', 'anthropic-messages'].includes(String(data.scope.api))
    || !Array.isArray(data.models) || data.models.length > 20000) return []
  const protocol = data.scope.api === 'openai-completions' ? 'openai' : 'anthropic'
  const prefix = protocol === 'openai' ? 'openai' : 'anthropic'
  const seen = new Set<string>(); const result: RuntimeModel[] = []
  for (const row of data.models) {
    if (!object(row) || !object(row.model) || typeof row.model.id !== 'string' || !row.model.id.trim() || seen.has(row.model.id)) return []
    seen.add(row.model.id)
    const proof = row.evidence
    if (!object(proof) || proof.available !== true || proof.kind !== 'chat' || row.model.id.startsWith('9r/')) continue
    const checked = zonedTime(proof.checked_at); const deadline = zonedTime(proof.expires_at)
    if (!Number.isFinite(checked) || !Number.isFinite(deadline) || checked > Date.now() + 5000
      || deadline <= Date.now() || deadline <= checked || deadline - checked > 600000) continue
    if (!object(proof.protocols) || proof.protocols[protocol] !== 'proved' || !object(proof.capabilities)) continue
    if (!['text', 'tools', `${prefix}Tools`, `${prefix}Stream`].every(key => (proof.capabilities as Record<string, unknown>)[key] === 'proved')) continue
    result.push({ model: { ...row.model, id: row.model.id, input: ['text'] }, expiresAt: deadline })
  }
  return result
}

/**
 * Read dynamic model options for the exact configured route.
 * @param home - Harness home containing the enrollment marker and runtime snapshot.
 * @param route - Configured protocol, base URL, and credential reference to match against the snapshot.
 * @returns current proved model options, an empty list for invalid modern state, or undefined for unmanaged or legacy configuration.
 */
export function readRouterRuntimeModels(
  home: string | undefined, route: { api?: unknown; baseURL?: unknown; apiKeyEnv?: unknown },
): (Record<string, unknown> & { id: string })[] | undefined {
  if (!home || !existsSync(join(home, 'router-live-catalog.enabled'))) return undefined
  let data: unknown
  try { data = JSON.parse(readFileSync(join(home, 'sync-9router-models-state.json'), 'utf8')) }
  catch { return [] }
  if (!object(data)) return []
  if (data.schema === undefined || data.schema === 1) return undefined
  if (data.schema !== 2) return []
  if (!object(data.scope) || typeof route.baseURL !== 'string') return []
  try {
    if (data.scope.url !== new URL(route.baseURL).href.replace(/\/$/, '')
      || data.scope.api !== route.api || data.scope.credentialRef !== (route.apiKeyEnv ?? null)) return []
  } catch { return [] }
  return runtimeModels(data).map(row => row.model)
}

/**
 * Bind actual dispatch credentials to the credential used to fetch this snapshot.
 * @param home - Harness home containing the enrollment marker and runtime snapshot.
 * @param key - Effective dispatch credential; only its digest is compared with the snapshot.
 * @returns true for matching modern credentials or unmanaged/legacy configuration; false for invalid modern state or a mismatch.
 */
export function routerCredentialMatches(home: string | undefined, key: string): boolean {
  if (!home || !existsSync(join(home, 'router-live-catalog.enabled'))) return true
  try {
    const data: unknown = JSON.parse(readFileSync(join(home, 'sync-9router-models-state.json'), 'utf8'))
    if (!object(data)) return false
    if (data.schema === undefined || data.schema === 1) return true
    return data.schema === 2 && object(data.scope)
      && data.scope.credentialDigest === createHash('sha256').update(key).digest('hex')
  } catch { return false }
}

/** Current membership and deadline for a router explicitly enrolled in live-catalog management. */
interface RouterCatalogLease {
  ids?: ReadonlySet<string>
  expiresAt?: number
  scope?: string
}

/**
 * Read the managed router's positive lease. Missing or invalid state withdraws every managed model.
 * @param home - configured Harness home; omission leaves a standalone LLM composition unmanaged.
 * @returns unrestricted membership when not enrolled, otherwise current proved IDs and their deadline.
 */
export async function readRouterCatalogLease(home?: string): Promise<RouterCatalogLease> {
  if (!home || !existsSync(join(home, 'router-live-catalog.enabled'))) return {}
  let data: { schema?: number; ok?: boolean; synchronizedAt?: string; validUntil?: string; catalogModelIds?: string[] } | null
  try { data = JSON.parse(await readFile(join(home, 'sync-9router-models-state.json'), 'utf8')) as typeof data }
  catch { return { ids: new Set() } }
  if (data?.schema === 2) {
    const rows = runtimeModels(data)
    const value = data as unknown as {
      scope?: { url?: string; api?: string; credentialRef?: string | null; credentialDigest?: string | null }
    }
    const scope = JSON.stringify([value.scope?.url, value.scope?.api, value.scope?.credentialRef, value.scope?.credentialDigest])
    return {
      ids: new Set(rows.map(row => row.model.id)), scope,
      ...(rows.length ? { expiresAt: Math.min(...rows.map(row => row.expiresAt)) } : {}),
    }
  }
  const withZone = (value?: string): number => typeof value === 'string' && /(?:Z|[+-]\d{2}:\d{2})$/.test(value) ? Date.parse(value) : NaN
  const checked = withZone(data?.synchronizedAt)
  const deadline = withZone(data?.validUntil)
  const ids = data?.catalogModelIds
  if (data?.ok !== true || !Number.isFinite(checked) || !Number.isFinite(deadline)
    || checked > Date.now() + 5000 || deadline <= Date.now() || deadline <= checked || deadline - checked > 60000
    || !Array.isArray(ids) || ids.length > 20000 || ids.some(id => typeof id !== 'string' || id.length === 0)
    || new Set(ids).size !== ids.length) return { ids: new Set() }
  return { ids: new Set(ids), expiresAt: deadline }
}

/**
 * Request one bounded renewal for an expired schema-2 proof; never replay tools or extend evidence.
 * @param home - Harness home used to read evidence and request its synchronizer's renewal.
 * @param model - Exact model ID whose availability must be confirmed.
 * @param signal - Optional cancellation signal propagated through renewal and polling.
 * @param expectedScope - Optional dispatch binding from the prepared lease; any changed scope refuses the call.
 * @returns true when unmanaged or currently confirmed, otherwise whether matching fresh proof arrives within 20 seconds.
 */
export async function confirmRouterModel(
  home: string | undefined, model: string, signal?: AbortSignal, expectedScope?: string,
): Promise<boolean> {
  signal?.throwIfAborted()
  const current = await readRouterCatalogLease(home)
  if (expectedScope !== undefined && current.scope !== expectedScope) return false
  if (current.ids === undefined || current.ids.has(model)) return true
  if (!home) return false
  let state: unknown
  try { state = JSON.parse(await readFile(join(home, 'sync-9router-models-state.json'), 'utf8')) }
  catch { return false }
  if (!object(state) || state.schema !== 2 || state.ok !== true || !Array.isArray(state.models)) return false
  // An authoritative removal is definitive; only a known proof reaching expiry requests renewal.
  const expired = (state.transport === 'degraded' && Array.isArray(state.expiredModelIds) && state.expiredModelIds.includes(model)) || state.models.some(row => object(row) && object(row.model) && row.model.id === model
    && object(row.evidence) && zonedTime(row.evidence.expires_at) <= Date.now())
  if (!expired) return false
  const requestId = randomUUID()
  const file = join(home, 'sync-9router-models-request.json')
  const temporary = `${file}.${requestId}.tmp`
  try {
    signal?.throwIfAborted()
    await writeFile(temporary, JSON.stringify({ requestId }), { flag: 'wx' })
    await rename(temporary, file)
    const deadline = performance.now() + 20000
    do {
      await delay(100, undefined, { signal })
      const lease = await readRouterCatalogLease(home)
      if (expectedScope !== undefined && lease.scope !== expectedScope) return false
      if (lease.ids?.has(model)) return true
      const latest: unknown = JSON.parse(await readFile(join(home, 'sync-9router-models-state.json'), 'utf8'))
      if (object(latest) && latest.completedRequest === requestId) return false
    } while (performance.now() < deadline)
  } catch {
    signal?.throwIfAborted()
  } finally { await unlink(temporary).catch(() => {}) }
  return false
}

/**
 * Publish native catalog invalidations on state changes and lease expiration; dispose all resources.
 * @param home - explicit Harness home.
 * @param changed - owner notification for the existing model-directory event.
 * @returns a synchronous disposer for the watcher and expiration timer.
 */
export function watchRouterCatalog(home: string | undefined, changed: () => void): () => void {
  if (!home || !existsSync(home)) return () => {}
  let closed = false
  let generation = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  const refresh = async (notify = true): Promise<void> => {
    const current = ++generation
    const lease = await readRouterCatalogLease(home)
    if (closed || current !== generation) return
    clearTimeout(timer)
    if (lease.expiresAt !== undefined) timer = setTimeout(() => { void refresh() }, Math.max(1, lease.expiresAt - Date.now()))
    if (notify && lease.ids !== undefined) changed()
  }
  // Keep a poll fallback: native watch may fail or permanently lose its notifications.
  const poll = setInterval(() => { void refresh() }, 30000)
  poll.unref()
  let watcher: ReturnType<typeof watch> | undefined
  try {
    watcher = watch(home, { persistent: false }, (_event, filename) => {
      if (filename === 'sync-9router-models-state.json' || filename === 'router-live-catalog.enabled') void refresh()
    })
    watcher.on('error', () => { watcher?.close(); void refresh() })
  } catch {
    // Dispatch remains guarded, and the fallback still publishes recovery and withdrawal.
  }
  void refresh(false)
  return () => { closed = true; clearTimeout(timer); clearInterval(poll); watcher?.close() }
}
