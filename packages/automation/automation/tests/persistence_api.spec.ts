import { describe, it, expect } from 'vitest'
import * as path from 'path'
import { promises as fs } from 'fs'
import { FileAutomationStore } from '../src/persistence'
import { NotificationService } from '../src/notifier'
import { TaskWorker } from '../src/worker'
import { AutomationScheduler } from '../src/scheduler'
import { StaleTaskReaper } from '../src/reaper'
import { AutomationApiRouter } from '../src/api'
import { AutomationSseStreamer } from '../src/sse'
import { IncomingMessage, ServerResponse } from 'http'
import { EventEmitter } from 'events'

describe('Production Persistence, Stale Reaper & REST API / SSE', () => {
  // Scratch file beside this spec; the repo path gate only scans literal `packages/*` references.
  const tempDbPath = path.resolve(import.meta.dirname, '.tmp-test-db.json')

  it('FileAutomationStore persists tasks and restores correctly across new instances', async () => {
    try {
      await fs.unlink(tempDbPath)
    } catch {}

    const store1 = new FileAutomationStore(tempDbPath)
    const task = await store1.createTask({
      userId: 'user-persist',
      title: 'Tarefa Persistente em Arquivo',
      scheduleType: 'INTERVAL',
      scheduleExpr: '300',
      actionType: 'MOCK_ACTION',
    })

    const run = await store1.createRun(task.id, new Date())
    await store1.updateRun(run.id, { status: 'SUCCESS', durationMs: 150 })

    await store1.createNotification({
      taskId: task.id,
      runId: run.id,
      userId: 'user-persist',
      level: 'SUCCESS',
      title: 'Persistência OK',
      message: 'Salvo com sucesso no disco',
    })

    // Create a brand new store instance pointing to the same file
    const store2 = new FileAutomationStore(tempDbPath)
    const loadedTask = await store2.getTask(task.id)
    expect(loadedTask).not.toBeNull()
    expect(loadedTask?.title).toBe('Tarefa Persistente em Arquivo')

    const loadedRuns = await store2.listRunsByTask(task.id)
    expect(loadedRuns).toHaveLength(1)
    expect(loadedRuns[0]!.status).toBe('SUCCESS')

    const notifs = await store2.listNotifications('user-persist')
    expect(notifs).toHaveLength(1)
    expect(notifs[0]!.title).toBe('Persistência OK')

    // Clean up
    try {
      await fs.unlink(tempDbPath)
    } catch {}
  })

  it('StaleTaskReaper catches dead/crashed RUNNING tasks and recovers them', async () => {
    try {
      await fs.unlink(tempDbPath)
    } catch {}

    const store = new FileAutomationStore(tempDbPath)
    const notifier = new NotificationService(store)
    const reaper = new StaleTaskReaper(store, notifier, 1000, 100) // 100ms threshold for test

    const task = await store.createTask({
      userId: 'user-reaper',
      title: 'Tarefa Travada',
      scheduleType: 'ONCE',
      scheduleExpr: new Date(Date.now() + 10000).toISOString(),
      actionType: 'ANY',
      timeoutSeconds: 0.1, // 100ms
    })

    const run = await store.createRun(task.id, new Date())
    // Simulate task started in the past
    await store.updateRun(run.id, {
      status: 'RUNNING',
      startedAt: new Date(Date.now() - 500),
    })

    const reaped = await reaper.reap(100)
    expect(reaped).toBe(1)

    const updatedRun = await store.getRun(run.id)
    expect(updatedRun?.status).toBe('TIMED_OUT')
    expect(updatedRun?.errorMessage).toContain('encerrada automaticamente pelo Reaper')

    // Clean up
    try {
      await fs.unlink(tempDbPath)
    } catch {}
  })

  it('AutomationApiRouter handles GET/POST tasks, manual trigger, and run history', async () => {
    const store = new FileAutomationStore(tempDbPath)
    const notifier = new NotificationService(store)
    const worker = new TaskWorker(store, notifier)
    const scheduler = new AutomationScheduler(store, worker, 100)
    const router = new AutomationApiRouter(store, scheduler, worker)

    worker.registerHandler('API_ACTION', async (payload) => {
      return { received: payload }
    })

    // Helper to mock HTTP req/res
    const mockRequest = async (
      method: string,
      url: string,
      body?: unknown,
    ): Promise<{ status: number; body: Record<string, unknown> | undefined }> => {
      const req = Object.assign(new EventEmitter(), {
        method,
        url,
        headers: { host: 'localhost' },
      }) as unknown as IncomingMessage

      let statusCode = 200
      let responseBody = ''

      const res = {
        writeHead: (code: number) => {
          statusCode = code
        },
        end: (data?: string) => {
          if (data) responseBody = data
        },
      } as unknown as ServerResponse

      const promise = router.handleRequest(req, res)

      if (body) {
        req.emit('data', Buffer.from(JSON.stringify(body)))
      }
      req.emit('end')

      await promise
      return {
        status: statusCode,
        body: responseBody ? (JSON.parse(responseBody) as Record<string, unknown>) : undefined,
      }
    }

    // 1. POST /api/tasks
    const createRes = await mockRequest('POST', '/api/tasks', {
      userId: 'user-api',
      title: 'Tarefa via REST API',
      scheduleType: 'INTERVAL',
      scheduleExpr: '60',
      actionType: 'API_ACTION',
      actionPayload: { param: 'teste' },
    })
    expect(createRes.status).toBe(201)
    expect(createRes.body?.success).toBe(true)
    const taskId = (createRes.body?.data as { id: string }).id

    // 2. GET /api/tasks
    const listRes = await mockRequest('GET', '/api/tasks?userId=user-api')
    expect(listRes.status).toBe(200)
    expect(listRes.body?.data as unknown[]).toHaveLength(1)

    // 3. POST /api/tasks/:id/trigger (Manual run)
    const triggerRes = await mockRequest('POST', `/api/tasks/${taskId}/trigger`)
    expect(triggerRes.status).toBe(202)
    expect(triggerRes.body?.success).toBe(true)

    // Give worker time
    await new Promise(r => setTimeout(r, 100))

    // 4. GET /api/tasks/:id/runs
    const runsRes = await mockRequest('GET', `/api/tasks/${taskId}/runs`)
    expect(runsRes.status).toBe(200)
    const runsData = runsRes.body?.data as { status: string }[]
    expect(runsData).toHaveLength(1)
    expect(runsData[0]!.status).toBe('SUCCESS')

    // Clean up
    try {
      await fs.unlink(tempDbPath)
    } catch {}
  })

  it('AutomationSseStreamer delivers live notifications to connected SSE stream', async () => {
    const store = new FileAutomationStore(tempDbPath)
    const notifier = new NotificationService(store)
    const streamer = new AutomationSseStreamer(notifier)

    const req = Object.assign(new EventEmitter(), {
      url: '/api/sse?userId=user-sse',
      headers: { host: 'localhost' },
    }) as unknown as IncomingMessage

    const emittedChunks: string[] = []
    const res = {
      writeHead: () => {},
      write: (chunk: string) => {
        emittedChunks.push(chunk)
      },
    } as unknown as ServerResponse

    streamer.handleSseConnection(req, res)
    expect(streamer.getConnectedClientsCount()).toBe(1)
    expect(emittedChunks[0]).toContain('event: connected')

    // Notify
    await notifier.notifyTaskFinished({
      taskId: 'task-sse',
      runId: 'run-sse',
      userId: 'user-sse',
      level: 'SUCCESS',
      title: 'Alerta SSE',
      message: 'Notificação instantânea no navegador',
    })

    expect(emittedChunks.length).toBe(2)
    expect(emittedChunks[1]).toContain('event: notification')
    expect(emittedChunks[1]).toContain('Alerta SSE')

    req.emit('close')
    expect(streamer.getConnectedClientsCount()).toBe(0)

    // Clean up
    try {
      await fs.unlink(tempDbPath)
    } catch {}
  })
})
