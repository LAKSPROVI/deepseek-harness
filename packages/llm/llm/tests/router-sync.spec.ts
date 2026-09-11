/**
 * 9Router model synchronization status reader, trigger executor, and Remote methods tests.
 */

import { describe, expect, it } from 'vitest'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { readRouterSyncStatus } from '../src/router-sync.ts'

describe('readRouterSyncStatus', () => {
  it('returns default empty status when state file is missing', async () => {
    const tempDir = join(tmpdir(), `dsh-test-sync-${randomUUID()}`)
    await mkdir(tempDir, { recursive: true })
    const status = await readRouterSyncStatus(tempDir)
    expect(status.totalRoutes).toBe(0)
    expect(status.availableRoutes).toBe(0)
    expect(status.publishedChatModels).toBe(0)
    expect(status.isStale).toBe(true)
  })

  it('parses valid sync state file and detects freshness', async () => {
    const tempDir = join(tmpdir(), `dsh-test-sync-${randomUUID()}`)
    await mkdir(tempDir, { recursive: true })
    const now = new Date().toISOString()
    await writeFile(
      join(tempDir, 'sync-9router-models-state.json'),
      JSON.stringify({
        schemaVersion: 1,
        monitorUpdatedAt: '2026-09-03T21:48:22.045676Z',
        synchronizedAt: now,
        totalRoutes: 1223,
        availableRoutes: 129,
        publishedChatModels: 125,
        visionModels: 36,
        reasoningModels: 36,
        averageLatencySeconds: 2.886,
      }),
      'utf8',
    )
    const status = await readRouterSyncStatus(tempDir)
    expect(status.synchronizedAt).toBe(now)
    expect(status.monitorUpdatedAt).toBe('2026-09-03T21:48:22.045676Z')
    expect(status.totalRoutes).toBe(1223)
    expect(status.availableRoutes).toBe(129)
    expect(status.publishedChatModels).toBe(125)
    expect(status.visionModels).toBe(36)
    expect(status.reasoningModels).toBe(36)
    expect(status.averageLatencySeconds).toBe(2.886)
    expect(status.isStale).toBe(false)
  })

  it('flags stale state when timestamp is older than 24 hours', async () => {
    const tempDir = join(tmpdir(), `dsh-test-sync-${randomUUID()}`)
    await mkdir(tempDir, { recursive: true })
    const twoDaysAgo = new Date(Date.now() - 48 * 3600 * 1000).toISOString()
    await writeFile(
      join(tempDir, 'sync-9router-models-state.json'),
      JSON.stringify({
        synchronizedAt: twoDaysAgo,
        totalRoutes: 500,
        availableRoutes: 20,
        publishedChatModels: 18,
      }),
      'utf8',
    )
    const status = await readRouterSyncStatus(tempDir)
    expect(status.isStale).toBe(true)
  })

  it('captures last failure from log file when present', async () => {
    const tempDir = join(tmpdir(), `dsh-test-sync-${randomUUID()}`)
    const logsDir = join(tempDir, 'logs')
    await mkdir(logsDir, { recursive: true })
    await writeFile(
      join(logsDir, 'sync-9router-models.log'),
      '[2026-09-04T00:00:00.000Z] sync start\n[2026-09-04T00:00:01.000Z] failed: Network timeout\n',
      'utf8',
    )
    const status = await readRouterSyncStatus(tempDir)
    expect(status.error).toBe('Network timeout')
  })
})
