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

it.each([
  { ok: false, validUntil: new Date(Date.now() + 60000).toISOString(), stale: true, error: true },
  { ok: true, validUntil: new Date(Date.now() - 60000).toISOString(), stale: true, error: false },
  { ok: true, validUntil: new Date(Date.now() + 60000).toISOString(), stale: false, error: false },
  { ok: true, validUntil: undefined, stale: true, error: false },
])('uses the catalog deadline and sanitized current failure instead of a historical log: $ok/$stale', async (fixture) => {
  const { mkdtemp, rm } = await import('node:fs/promises')
  const { onTestFinished } = await import('vitest')
  const dir = await mkdtemp(join(tmpdir(), 'dsh-router-deadline-'))
  onTestFinished(() => rm(dir, { recursive: true, force: true }))
  await mkdir(join(dir, 'logs'))
  await writeFile(join(dir, 'logs/sync-9router-models.log'), 'failed: old secret error\n')
  await writeFile(join(dir, 'sync-9router-models-state.json'), JSON.stringify({ synchronizedAt: new Date().toISOString(), ok: fixture.ok, validUntil: fixture.validUntil, error: 'unsafe wire detail' }))
  const result = await readRouterSyncStatus(dir)
  expect(result.isStale).toBe(fixture.stale)
  expect(result.error).toBe(fixture.error ? 'Router catalog is unconfirmed' : undefined)
})
