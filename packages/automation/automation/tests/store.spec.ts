import { describe, expect, it } from 'vitest'
import { InMemoryAutomationStore } from '../src/store'
import { calculateNextRun } from '../src/recurrence'

const baseDto = {
  userId: 'user-store',
  title: 'Tarefa',
  scheduleType: 'INTERVAL' as const,
  scheduleExpr: '60',
  actionType: 'NOOP',
}

describe('InMemoryAutomationStore tasks', () => {
  it('carries optional DTO fields only when present and applies the defaults otherwise', async () => {
    const store = new InMemoryAutomationStore()
    const bare = await store.createTask(baseDto)
    expect(bare).not.toHaveProperty('description')
    expect(bare).not.toHaveProperty('model')
    expect(bare).not.toHaveProperty('modelProvider')
    expect(bare).not.toHaveProperty('promptTemplate')
    expect(bare.timezone).toBe('America/Sao_Paulo')
    expect(bare.maxRuns).toBeNull()
    expect(bare.endAt).toBeNull()
    expect(bare.actionPayload).toEqual({})
    expect(bare.timeoutSeconds).toBe(300)
    expect(bare.retryLimit).toBe(3)
    expect(bare.overlapPolicy).toBe('SKIP')

    const full = await store.createTask({
      ...baseDto,
      description: 'descrição',
      timezone: 'UTC',
      maxRuns: 5,
      endAt: new Date('2030-01-01T00:00:00Z'),
      actionPayload: { key: 'value' },
      model: 'deepseek-chat',
      modelProvider: 'deepseek',
      promptTemplate: 'Faça X',
      timeoutSeconds: 10,
      retryLimit: 1,
      overlapPolicy: 'ALLOW',
    })
    expect(full).toMatchObject({
      description: 'descrição',
      timezone: 'UTC',
      maxRuns: 5,
      actionPayload: { key: 'value' },
      model: 'deepseek-chat',
      modelProvider: 'deepseek',
      promptTemplate: 'Faça X',
      timeoutSeconds: 10,
      retryLimit: 1,
      overlapPolicy: 'ALLOW',
    })
  })

  it('returns null for an unknown task and rejects updates to one', async () => {
    const store = new InMemoryAutomationStore()
    expect(await store.getTask('missing')).toBeNull()
    await expect(store.updateTask('missing', { title: 'x' })).rejects.toThrow('Task with ID missing not found')
  })

  it('lists tasks for every user or one user, and deletes', async () => {
    const store = new InMemoryAutomationStore()
    const a = await store.createTask(baseDto)
    await store.createTask({ ...baseDto, userId: 'other' })
    expect(await store.listTasks()).toHaveLength(2)
    expect(await store.listTasks('other')).toHaveLength(1)
    expect(await store.deleteTask(a.id)).toBe(true)
    expect(await store.deleteTask(a.id)).toBe(false)
  })

  it('finds only ACTIVE tasks whose nextRunAt has passed, honouring the limit', async () => {
    const store = new InMemoryAutomationStore()
    const past = new Date('2020-01-01T00:00:00Z')
    const due1 = await store.createTask(baseDto)
    const due2 = await store.createTask(baseDto)
    const paused = await store.createTask(baseDto)
    const future = await store.createTask(baseDto)
    const never = await store.createTask(baseDto)
    await store.updateTask(due1.id, { nextRunAt: past })
    await store.updateTask(due2.id, { nextRunAt: past })
    await store.updateTask(paused.id, { nextRunAt: past, status: 'PAUSED' })
    await store.updateTask(future.id, { nextRunAt: new Date('2999-01-01T00:00:00Z') })
    await store.updateTask(never.id, { nextRunAt: null })

    const now = new Date('2026-01-01T00:00:00Z')
    expect((await store.findDueTasks(now)).map(t => t.id).sort()).toEqual([due1.id, due2.id].sort())
    expect(await store.findDueTasks(now, 1)).toHaveLength(1)
  })
})

describe('InMemoryAutomationStore runs', () => {
  it('rejects runs for unknown tasks and updates for unknown runs', async () => {
    const store = new InMemoryAutomationStore()
    await expect(store.createRun('missing', new Date())).rejects.toThrow('Task missing not found')
    await expect(store.updateRun('missing', { status: 'SUCCESS' })).rejects.toThrow('TaskRun with ID missing not found')
    expect(await store.getRun('missing')).toBeNull()
  })

  it('numbers runs per task, lists them newest first and reports active runs', async () => {
    const store = new InMemoryAutomationStore()
    const task = await store.createTask(baseDto)
    const first = await store.createRun(task.id, new Date())
    const second = await store.createRun(task.id, new Date())
    expect(first.runNumber).toBe(1)
    expect(second.runNumber).toBe(2)
    expect((await store.listRunsByTask(task.id)).map(r => r.runNumber)).toEqual([2, 1])
    expect(await store.getRun(first.id)).toMatchObject({ id: first.id, status: 'QUEUED' })

    expect(await store.hasActiveRun(task.id)).toBe(false)
    await store.updateRun(first.id, { status: 'RUNNING' })
    expect(await store.hasActiveRun(task.id)).toBe(true)
  })

  it('merges only the carried run fields and keeps prior logs when none are given', async () => {
    const store = new InMemoryAutomationStore()
    const task = await store.createTask(baseDto)
    const run = await store.createRun(task.id, new Date())
    const logs = [{ timestamp: 't', level: 'info' as const, message: 'm' }]
    const withLogs = await store.updateRun(run.id, {
      status: 'RUNNING',
      startedAt: new Date(1),
      logs,
    })
    expect(withLogs.executionLogs).toEqual(logs)
    expect(withLogs).not.toHaveProperty('finishedAt')

    const finished = await store.updateRun(run.id, {
      finishedAt: new Date(2),
      durationMs: 1,
      outputData: { ok: true },
      errorMessage: 'e',
      errorStack: 's',
    })
    expect(finished.status).toBe('RUNNING')
    expect(finished.executionLogs).toEqual(logs)
    expect(finished).toMatchObject({ durationMs: 1, outputData: { ok: true }, errorMessage: 'e', errorStack: 's' })
  })
})

describe('InMemoryAutomationStore notifications', () => {
  it('filters unread notifications, lists by task and marks read once', async () => {
    const store = new InMemoryAutomationStore()
    const task = await store.createTask(baseDto)
    const run = await store.createRun(task.id, new Date())
    const base = { taskId: task.id, runId: run.id, userId: 'user-store', level: 'INFO' as const, title: 't', message: 'm' }
    const older = await store.createNotification(base)
    const newer = await store.createNotification({ ...base, title: 'newer' })
    await store.createNotification({ ...base, userId: 'someone-else', taskId: 'other-task' })

    expect(await store.markNotificationRead(older.id)).toBe(true)
    expect(await store.markNotificationRead('missing')).toBe(false)

    expect((await store.listNotifications('user-store')).map(n => n.id)).toHaveLength(2)
    expect((await store.listNotifications('user-store', true)).map(n => n.id)).toEqual([newer.id])
    expect((await store.listNotificationsByTask(task.id)).map(n => n.id).sort()).toEqual([older.id, newer.id].sort())
    expect(await store.listNotificationsByTask('other-task')).toHaveLength(1)
    expect(await store.listNotificationsByTask('missing')).toEqual([])
  })
})

describe('calculateNextRun validation', () => {
  const base = { timezone: 'UTC', maxRuns: null, totalRunsCompleted: 0, endAt: null, createdAt: new Date() }

  it('rejects an unparsable ONCE date and a non-positive INTERVAL', () => {
    expect(() => calculateNextRun({ ...base, scheduleType: 'ONCE', scheduleExpr: 'not-a-date' }))
      .toThrow(/Invalid single schedule date expression/)
    expect(() => calculateNextRun({ ...base, scheduleType: 'INTERVAL', scheduleExpr: '0' }))
      .toThrow(/Invalid interval seconds/)
    expect(() => calculateNextRun({ ...base, scheduleType: 'INTERVAL', scheduleExpr: 'x' }))
      .toThrow(/Invalid interval seconds/)
  })

  it('rejects an unknown schedule type', () => {
    expect(() => calculateNextRun({ ...base, scheduleType: 'WEIRD' as never, scheduleExpr: '' }))
      .toThrow('Unsupported scheduleType: WEIRD')
  })

  it('keeps a target that lands before the end date', () => {
    const reference = new Date('2026-01-01T00:00:00Z')
    const next = calculateNextRun(
      { ...base, scheduleType: 'INTERVAL', scheduleExpr: '60', endAt: new Date('2026-01-02T00:00:00Z') },
      reference,
    )
    expect(next?.toISOString()).toBe('2026-01-01T00:01:00.000Z')
  })
})
