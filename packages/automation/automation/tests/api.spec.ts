import { EventEmitter } from 'events'
import type { IncomingMessage, ServerResponse } from 'http'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AutomationApiRouter } from '../src/api'
import { NotificationService } from '../src/notifier'
import { AutomationScheduler } from '../src/scheduler'
import { IAutomationStore, InMemoryAutomationStore } from '../src/store'
import { TaskWorker } from '../src/worker'

interface Reply {
  status: number
  headers: Record<string, string> | undefined
  body: Record<string, unknown> | undefined
}

interface RequestShape {
  method?: string
  url?: string
  host?: string
  /** Raw request body; a string is written as-is so malformed JSON can be sent. */
  body?: unknown
}

function makeRouter(store: IAutomationStore = new InMemoryAutomationStore(), worker?: TaskWorker) {
  const notifier = new NotificationService(store)
  const realWorker = worker ?? new TaskWorker(store, notifier)
  const scheduler = new AutomationScheduler(store, realWorker, 100)
  return { store, worker: realWorker, router: new AutomationApiRouter(store, scheduler, realWorker) }
}

async function send(router: AutomationApiRouter, shape: RequestShape): Promise<Reply> {
  const req = Object.assign(new EventEmitter(), {
    ...shape.method !== undefined ? { method: shape.method } : {},
    ...shape.url !== undefined ? { url: shape.url } : {},
    headers: shape.host !== undefined ? { host: shape.host } : {},
  }) as unknown as IncomingMessage

  let status = 0
  let headers: Record<string, string> | undefined
  let raw = ''
  const res = {
    writeHead: (code: number, h?: Record<string, string>) => {
      status = code
      headers = h
    },
    end: (data?: string) => {
      if (data) raw = data
    },
  } as unknown as ServerResponse

  const done = router.handleRequest(req, res)
  if (shape.body !== undefined) {
    req.emit('data', typeof shape.body === 'string' ? shape.body : Buffer.from(JSON.stringify(shape.body)))
  }
  req.emit('end')
  await done
  return { status, headers, body: raw ? (JSON.parse(raw) as Record<string, unknown>) : undefined }
}

const dto = {
  userId: 'user-api',
  title: 'Tarefa REST',
  scheduleType: 'INTERVAL' as const,
  scheduleExpr: '60',
  actionType: 'API_ACTION',
}

describe('AutomationApiRouter request parsing', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('answers CORS preflight with 204 and no body', async () => {
    const { router } = makeRouter()
    const reply = await send(router, { method: 'OPTIONS', url: '/api/tasks' })
    expect(reply.status).toBe(204)
    expect(reply.headers?.['Access-Control-Allow-Origin']).toBe('*')
    expect(reply.body).toBeUndefined()
  })

  it('defaults a missing url, host and method to GET /', async () => {
    const { router } = makeRouter()
    const reply = await send(router, {})
    expect(reply.status).toBe(404)
    expect(reply.body?.error).toBe('Rota não encontrada: GET /')
  })

  it('treats an unparsable JSON body as no body', async () => {
    const { router } = makeRouter()
    const reply = await send(router, { method: 'POST', url: '/api/tasks', host: 'localhost', body: '{not json' })
    expect(reply.status).toBe(400)
    expect(reply.body?.error).toMatch(/Campos obrigatórios ausentes/)
  })

  it('reports store failures as 500 with the Error message or a generic one', async () => {
    const failing = {
      listTasks: () => Promise.reject(new Error('disco cheio')),
    } as unknown as IAutomationStore
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { router } = makeRouter(failing)
    const withError = await send(router, { method: 'GET', url: '/api/tasks', host: 'localhost' })
    expect(withError.status).toBe(500)
    expect(withError.body?.error).toBe('disco cheio')

    const throwingString = {
      // oxlint-disable-next-line typescript/prefer-promise-reject-errors -- the generic-message branch needs a non-Error reason.
      listTasks: () => Promise.reject('texto'),
    } as unknown as IAutomationStore
    const other = makeRouter(throwingString)
    const withString = await send(other.router, { method: 'GET', url: '/api/tasks', host: 'localhost' })
    expect(withString.status).toBe(500)
    expect(withString.body?.error).toBe('Erro interno no servidor')
    expect(errorSpy).toHaveBeenCalledTimes(2)
  })
})

describe('AutomationApiRouter task routes', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('lists every task when no userId filter is given', async () => {
    const { router, store } = makeRouter()
    await store.createTask(dto)
    await store.createTask({ ...dto, userId: 'someone-else' })
    const reply = await send(router, { method: 'GET', url: '/api/tasks', host: 'localhost' })
    expect(reply.status).toBe(200)
    expect(reply.body?.data as unknown[]).toHaveLength(2)
  })

  it('rejects task creation without the required fields', async () => {
    const { router } = makeRouter()
    const reply = await send(router, { method: 'POST', url: '/api/tasks', host: 'localhost', body: { title: 'só título' } })
    expect(reply.status).toBe(400)
    expect(reply.body?.success).toBe(false)
  })

  it('reads one task by id and 404s for unknown ids', async () => {
    const { router, store } = makeRouter()
    const task = await store.createTask(dto)
    const found = await send(router, { method: 'GET', url: `/api/tasks/${task.id}`, host: 'localhost' })
    expect(found.status).toBe(200)
    expect((found.body?.data as { id: string }).id).toBe(task.id)

    const missing = await send(router, { method: 'GET', url: '/api/tasks/nope', host: 'localhost' })
    expect(missing.status).toBe(404)
    expect(missing.body?.error).toBe('Tarefa não encontrada')

    // A detail path with a non-GET method falls through to the route 404.
    const wrongMethod = await send(router, { method: 'DELETE', url: `/api/tasks/${task.id}`, host: 'localhost' })
    expect(wrongMethod.status).toBe(404)
    expect(wrongMethod.body?.error).toMatch(/^Rota não encontrada: DELETE/)
  })

  it('pauses and resumes a task, recomputing the next run on resume', async () => {
    const { router, store } = makeRouter()
    const task = await store.createTask(dto)

    const paused = await send(router, { method: 'POST', url: `/api/tasks/${task.id}/pause`, host: 'localhost' })
    expect(paused.status).toBe(200)
    expect((paused.body?.data as { status: string }).status).toBe('PAUSED')
    // Pause/resume paths only answer POST; GET falls through to the route 404.
    expect((await send(router, { method: 'GET', url: `/api/tasks/${task.id}/pause`, host: 'localhost' })).status).toBe(404)
    expect((await send(router, { method: 'GET', url: `/api/tasks/${task.id}/resume`, host: 'localhost' })).status).toBe(404)

    const resumed = await send(router, { method: 'POST', url: `/api/tasks/${task.id}/resume`, host: 'localhost' })
    expect(resumed.status).toBe(200)
    const data = resumed.body?.data as { status: string; nextRunAt: string }
    expect(data.status).toBe('ACTIVE')
    expect(new Date(data.nextRunAt).getTime()).toBeGreaterThan(Date.now())

    const missing = await send(router, { method: 'POST', url: '/api/tasks/nope/resume', host: 'localhost' })
    expect(missing.status).toBe(404)
  })

  it('404s a manual trigger for an unknown task and logs a worker failure without failing the request', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    let rejected: () => void = () => {}
    const settled = new Promise<void>((resolve) => {
      rejected = resolve
    })
    const worker = {
      executeJob: () => {
        const failure = Promise.reject(new Error('worker quebrou'))
        void failure.catch(() => { queueMicrotask(rejected) })
        return failure
      },
    } as unknown as TaskWorker
    const { router, store } = makeRouter(new InMemoryAutomationStore(), worker)

    const missing = await send(router, { method: 'POST', url: '/api/tasks/nope/trigger', host: 'localhost' })
    expect(missing.status).toBe(404)

    const task = await store.createTask(dto)
    const accepted = await send(router, { method: 'POST', url: `/api/tasks/${task.id}/trigger`, host: 'localhost' })
    expect(accepted.status).toBe(202)
    await settled
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(errorSpy).toHaveBeenCalledWith('[API Trigger Error]', expect.any(Error))
    // Run history only answers GET.
    expect((await send(router, { method: 'POST', url: `/api/tasks/${task.id}/runs`, host: 'localhost' })).status).toBe(404)
  })
})

describe('AutomationApiRouter notification routes', () => {
  it('lists notifications for the default or given user, optionally unread only', async () => {
    const { router, store } = makeRouter()
    const task = await store.createTask(dto)
    const run = await store.createRun(task.id, new Date())
    const base = { taskId: task.id, runId: run.id, level: 'INFO' as const, title: 't', message: 'm' }
    await store.createNotification({ ...base, userId: 'default' })
    const read = await store.createNotification({ ...base, userId: 'user-api' })
    await store.createNotification({ ...base, userId: 'user-api' })
    await store.markNotificationRead(read.id)

    const defaults = await send(router, { method: 'GET', url: '/api/notifications', host: 'localhost' })
    expect(defaults.status).toBe(200)
    expect(defaults.body?.data as unknown[]).toHaveLength(1)

    const all = await send(router, { method: 'GET', url: '/api/notifications?userId=user-api', host: 'localhost' })
    expect(all.body?.data as unknown[]).toHaveLength(2)

    const unread = await send(router, { method: 'GET', url: '/api/notifications?userId=user-api&unread=true', host: 'localhost' })
    expect(unread.body?.data as unknown[]).toHaveLength(1)

    // Notification paths only answer GET / POST respectively.
    expect((await send(router, { method: 'POST', url: '/api/notifications', host: 'localhost' })).status).toBe(404)
    expect((await send(router, { method: 'GET', url: `/api/notifications/${read.id}/read`, host: 'localhost' })).status).toBe(404)
  })

  it('marks a notification read and reports whether it existed', async () => {
    const { router, store } = makeRouter()
    const task = await store.createTask(dto)
    const run = await store.createRun(task.id, new Date())
    const notif = await store.createNotification({
      taskId: task.id,
      runId: run.id,
      userId: 'user-api',
      level: 'INFO',
      title: 't',
      message: 'm',
    })
    const ok = await send(router, { method: 'POST', url: `/api/notifications/${notif.id}/read`, host: 'localhost' })
    expect(ok.status).toBe(200)
    expect(ok.body?.success).toBe(true)
    const missing = await send(router, { method: 'POST', url: '/api/notifications/nope/read', host: 'localhost' })
    expect(missing.body?.success).toBe(false)
  })
})
