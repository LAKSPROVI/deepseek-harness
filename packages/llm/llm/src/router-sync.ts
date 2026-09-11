/**
 * 9Router model catalog synchronization status reader and trigger executor.
 * Interacts with the local sync state file, execution logs, and background sync script.
 */

import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
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

  if (existsSync(statePath)) {
    try {
      const raw = await readFile(statePath, 'utf8')
      const data = JSON.parse(raw) as Record<string, unknown>
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
        }
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
    }
  }

  // Check last log entry if present for error indications
  if (existsSync(logPath)) {
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
