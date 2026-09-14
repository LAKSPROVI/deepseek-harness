import { EventEmitter } from 'events'
import type { IncomingMessage, ServerResponse } from 'http'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AutomationController } from '../src/controller'
import { NotificationService } from '../src/notifier'
import { StaleTaskReaper } from '../src/reaper'
import { AutomationScheduler } from '../src/scheduler'
import { AutomationSseStreamer } from '../src/sse'
import { IAutomationStore, InMemoryAutomationStore } from '../src/store'
import type { AutomationTask } from '../src/types'
import { TaskWorker } from '../src/worker'

const dto = {
  userId: 'user-daemon',
  title: 'Tarefa',
  scheduleType: 'INTERVAL' as const,
  scheduleExpr: '60',
  actionType: 'NOOP',
}

const flush = () => new Promise(resolve => setTimeout(resolve, 0))

function silenceConsoleError() {
  return vi.spyOn(console, 'error').mockImplementation(() => {})
}

describe('AutomationScheduler polling', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('ticks on start and on every interval, logs tick failures, and stops idempotently', async () => {
    vi.useFakeTimers()
    const errorSpy = silenceConsoleError()
    const store = new InMemoryAutomationStore()
    const findDueTasks = vi.spyOn(store, 'findDueTasks')
      .mockRejectedValueOnce(new Error('primeiro tick'))
      .mockRejectedValueOnce(new Error('tick periódico'))
      .mockResolvedValue([])
    const worker = new TaskWorker(store, new NotificationService(store))
    const scheduler = new AutomationScheduler(store, worker, 1_000)

    scheduler.stop() // never started: nothing to clear
    scheduler.start()
    scheduler.start() // idempotent
    await vi.advanceTimersByTimeAsync(0)
    expect(errorSpy).toHaveBeenCalledWith('[Scheduler] Error on first tick:', expect.any(Error))

    await vi.advanceTimersByTimeAsync(1_000)
    expect(errorSpy).toHaveBeenCalledWith('[Scheduler] Error on tick:', expect.any(Error))
    await vi.advanceTimersByTimeAsync(1_000)
    expect(findDueTasks).toHaveBeenCalledTimes(3)

    scheduler.stop()
    await vi.advanceTimersByTimeAsync(5_000)
    expect(findDueTasks).toHaveBeenCalledTimes(3)
  })

  it('dispatches ALLOW tasks without the overlap check and marks finished schedules COMPLETED', async () => {
    const store = new InMemoryAutomationStore()
    const worker = new TaskWorker(store, new NotificationService(store))
    worker.registerHandler('NOOP', () => Promise.resolve({}))
    const hasActiveRun = vi.spyOn(store, 'hasActiveRun')
    const scheduler = new AutomationScheduler(store, worker, 1_000)
    const now = new Date()

    // INTERVAL with the run budget about to be spent: the next run is null and
    // maxRuns is set, so the task completes.
    const lastRun = await store.createTask({ ...dto, overlapPolicy: 'ALLOW', maxRuns: 1 })
    await store.updateTask(lastRun.id, { nextRunAt: now, totalRunsCompleted: 1 })
    // CRON that never matches again with no run budget: the next run is null
    // but nothing says the task is finished, so it stays ACTIVE.
    const openEnded = await store.createTask({
      ...dto,
      overlapPolicy: 'ALLOW',
      scheduleType: 'CRON',
      scheduleExpr: '0 0 30 2 *',
    })
    await store.updateTask(openEnded.id, { nextRunAt: now })

    expect(await scheduler.tick(now)).toBe(2)
    expect(hasActiveRun).not.toHaveBeenCalled()
    expect((await store.getTask(lastRun.id))?.status).toBe('COMPLETED')
    expect((await store.getTask(openEnded.id))?.status).toBe('ACTIVE')
    await flush()
  })

  it('schedules a due task lacking nextRunAt for the tick instant and logs a worker failure', async () => {
    const errorSpy = silenceConsoleError()
    const store = new InMemoryAutomationStore()
    const task = await store.createTask({ ...dto, overlapPolicy: 'ALLOW' })
    const withoutNext = { ...task, nextRunAt: null }
    vi.spyOn(store, 'findDueTasks').mockResolvedValue([withoutNext])
    const createRun = vi.spyOn(store, 'createRun')
    const worker = {
      executeJob: () => Promise.reject(new Error('worker quebrou')),
    } as unknown as TaskWorker
    const scheduler = new AutomationScheduler(store, worker, 1_000)

    const now = new Date('2026-01-01T00:00:00Z')
    expect(await scheduler.tick(now)).toBe(1)
    expect(createRun).toHaveBeenCalledWith(task.id, now)
    await flush()
    expect(errorSpy).toHaveBeenCalledWith(
      `[Scheduler] Unhandled error running job for task ${task.id}:`,
      expect.any(Error),
    )
  })
})

describe('StaleTaskReaper', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('reaps on start and on every interval, logs sweep failures, and stops idempotently', async () => {
    vi.useFakeTimers()
    const errorSpy = silenceConsoleError()
    const store = new InMemoryAutomationStore()
    const listTasks = vi.spyOn(store, 'listTasks')
      .mockRejectedValueOnce(new Error('varredura inicial'))
      .mockRejectedValueOnce(new Error('varredura periódica'))
      .mockResolvedValue([])
    const reaper = new StaleTaskReaper(store, new NotificationService(store), 1_000, 100)

    reaper.stop()
    reaper.start()
    reaper.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(errorSpy).toHaveBeenCalledWith('[StaleTaskReaper] Error on startup reap:', expect.any(Error))
    await vi.advanceTimersByTimeAsync(1_000)
    expect(errorSpy).toHaveBeenCalledWith('[StaleTaskReaper] Error on periodic reap:', expect.any(Error))
    await vi.advanceTimersByTimeAsync(1_000)
    expect(listTasks).toHaveBeenCalledTimes(3)

    reaper.stop()
    await vi.advanceTimersByTimeAsync(5_000)
    expect(listTasks).toHaveBeenCalledTimes(3)
  })

  it('reaps only RUNNING runs older than the cutoff, falling back to createdAt and the default timeout', async () => {
    const store = new InMemoryAutomationStore()
    const notifier = new NotificationService(store)
    const reaper = new StaleTaskReaper(store, notifier, 60_000, 100)
    // timeoutSeconds 0 falls back to the 300s default timeout, so the cutoff is 300s.
    const task = await store.createTask({ ...dto, timeoutSeconds: 0 })
    const longAgo = new Date(Date.now() - 400_000)

    const finished = await store.createRun(task.id, longAgo)
    await store.updateRun(finished.id, { status: 'SUCCESS' })
    const freshRunning = await store.createRun(task.id, new Date())
    await store.updateRun(freshRunning.id, { status: 'RUNNING', startedAt: new Date() })
    const staleByStart = await store.createRun(task.id, longAgo)
    await store.updateRun(staleByStart.id, { status: 'RUNNING', startedAt: longAgo })
    // No startedAt: createdAt decides staleness.
    const staleByCreation = await store.createRun(task.id, longAgo)
    await store.updateRun(staleByCreation.id, { status: 'RUNNING' })
    const listRuns = store.listRunsByTask.bind(store)
    vi.spyOn(store, 'listRunsByTask').mockImplementation(async taskId =>
      (await listRuns(taskId)).map(run => run.id === staleByCreation.id ? { ...run, createdAt: longAgo } : run))

    expect(await reaper.reap()).toBe(2)
    expect((await store.getRun(staleByStart.id))?.status).toBe('TIMED_OUT')
    expect((await store.getRun(staleByCreation.id))?.status).toBe('TIMED_OUT')
    expect((await store.getRun(freshRunning.id))?.status).toBe('RUNNING')
    expect((await store.getRun(finished.id))?.status).toBe('SUCCESS')
    expect(await store.listNotificationsByTask(task.id)).toHaveLength(2)

    // A custom threshold above every age reaps nothing.
    expect(await reaper.reap(10_000_000)).toBe(0)
  })
})

describe('NotificationService listeners', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('drops unsubscribed listeners and survives a throwing listener', async () => {
    const errorSpy = silenceConsoleError()
    const store = new InMemoryAutomationStore()
    const notifier = new NotificationService(store)
    const removed = vi.fn()
    const throwing = vi.fn(() => {
      throw new Error('listener quebrou')
    })
    const after = vi.fn()
    const unsubscribe = notifier.subscribe(removed)
    notifier.subscribe(throwing)
    notifier.subscribe(after)
    unsubscribe()

    await notifier.notifyTaskFinished({
      taskId: 't',
      runId: 'r',
      userId: 'u',
      level: 'INFO',
      title: 'título',
      message: 'mensagem',
    })
    expect(removed).not.toHaveBeenCalled()
    expect(throwing).toHaveBeenCalledOnce()
    expect(after).toHaveBeenCalledOnce()
    expect(errorSpy).toHaveBeenCalledWith('[NotificationService] Error in listener:', expect.any(Error))
  })
})

describe('AutomationSseStreamer', () => {
  function connect(streamer: AutomationSseStreamer, req: Record<string, unknown>, write: (chunk: string) => void) {
    const emitter = Object.assign(new EventEmitter(), req) as unknown as IncomingMessage
    const res = { writeHead: () => {}, write } as unknown as ServerResponse
    streamer.handleSseConnection(emitter, res)
    return emitter
  }

  it('defaults the url, host and user, fans out to `all` subscribers, and drops clients whose write fails', () => {
    const store = new InMemoryAutomationStore()
    const streamer = new AutomationSseStreamer(new NotificationService(store))
    const defaultChunks: string[] = []
    const allChunks: string[] = []
    const otherChunks: string[] = []
    connect(streamer, { headers: {} }, chunk => defaultChunks.push(chunk))
    connect(streamer, { url: '/api/sse?userId=all', headers: { host: 'localhost' } }, chunk => allChunks.push(chunk))
    connect(streamer, { url: '/api/sse?userId=other', headers: { host: 'localhost' } }, chunk => otherChunks.push(chunk))
    connect(streamer, { url: '/api/sse?userId=default', headers: { host: 'localhost' } }, (chunk) => {
      // The handshake succeeds; the socket is gone by the time the broadcast arrives.
      if (!chunk.startsWith('event: connected')) throw new Error('socket fechado')
    })
    expect(defaultChunks[0]).toContain('"userId":"default"')
    expect(streamer.getConnectedClientsCount()).toBe(4)

    streamer.broadcastToUser('default', 'ping', { n: 1 })
    expect(defaultChunks).toHaveLength(2)
    expect(allChunks).toHaveLength(2)
    expect(otherChunks).toHaveLength(1)
    expect(streamer.getConnectedClientsCount()).toBe(3)
  })
})

describe('AutomationController projections', () => {
  it('carries the description and a null next run into the view', async () => {
    const store = new InMemoryAutomationStore()
    const task = await store.createTask({ ...dto, description: 'com descrição' })
    await store.updateTask(task.id, { nextRunAt: null })
    const controller = new AutomationController(store, { userId: dto.userId })
    const projected = await controller.view(task.id)
    expect(projected.description).toBe('com descrição')
    expect(projected.nextRunAt).toBeNull()
  })

  it('hides tasks of other owners', async () => {
    const store: IAutomationStore = new InMemoryAutomationStore()
    const foreign = await store.createTask({ ...dto, userId: 'someone-else' })
    const controller = new AutomationController(store, { userId: dto.userId })
    await expect(controller.task(foreign.id)).rejects.toThrow(`automation task "${foreign.id}" not found`)
    expect(await controller.list()).toEqual([])
    const stored: AutomationTask | null = await store.getTask(foreign.id)
    expect(stored?.userId).toBe('someone-else')
  })
})
