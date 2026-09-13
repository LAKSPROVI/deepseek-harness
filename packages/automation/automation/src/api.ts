import { IncomingMessage, ServerResponse } from 'http'
import { IAutomationStore } from './store'
import { AutomationScheduler } from './scheduler'
import { TaskWorker, jobForRun } from './worker'
import { CreateTaskDTO } from './types'
import { RecurrenceEngine } from './recurrence'

/** Framework-neutral view of one HTTP request after URL and body parsing. */
export interface RequestContext {
  method: string
  url: string
  body?: unknown
  params: Record<string, string>
  query: URLSearchParams
}

/**
 * Group 1 of a matched route pattern. Every pattern below captures exactly one
 * required segment, so a match always carries it; the fallback exists only
 * because an indexed read into `RegExpMatchArray` is optional to the compiler.
 */
function routeParam(match: RegExpMatchArray): string {
  return match[1] ?? ''
}

/**
 * Universal, dependency-free REST API Handler for the Automation System.
 * Usable with native Node http, Express, Fastify, Koa, or Hono.
 */
export class AutomationApiRouter {
  constructor(
    private readonly store: IAutomationStore,
    // Kept for constructor arity and for routes that will schedule directly;
    // no handler reads it today.
    _scheduler: AutomationScheduler,
    private readonly worker: TaskWorker,
  ) {}

  /**
   * Route one HTTP request to the matching task, run, notification, or SSE handler and write the response.
   * @param req - incoming Node request; the JSON body is read here.
   * @param res - response the matched handler writes to.
   */
  public async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const parsedUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`)
    const pathname = parsedUrl.pathname
    const method = (req.method || 'GET').toUpperCase()

    const body = await this.readJsonBody(req)
    const context: RequestContext = {
      method,
      url: pathname,
      body,
      params: {},
      query: parsedUrl.searchParams,
    }

    // Helper to send JSON
    const sendJson = (statusCode: number, data: unknown) => {
      res.writeHead(statusCode, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      })
      res.end(JSON.stringify(data))
    }

    if (method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      })
      res.end()
      return
    }

    try {
      // 1. GET /api/tasks
      if (pathname === '/api/tasks' && method === 'GET') {
        const userId = context.query.get('userId') || undefined
        const tasks = await this.store.listTasks(userId)
        sendJson(200, { success: true, data: tasks })
        return
      }

      // 2. POST /api/tasks
      if (pathname === '/api/tasks' && method === 'POST') {
        // The parsed body is untrusted `unknown`; the required-field check
        // immediately below is what makes this shape claim safe to act on.
        const dto = context.body as Partial<CreateTaskDTO>
        if (!dto.title || !dto.scheduleType || !dto.scheduleExpr || !dto.actionType) {
          sendJson(400, {
            success: false,
            error: 'Campos obrigatórios ausentes: title, scheduleType, scheduleExpr, actionType',
          })
          return
        }
        const task = await this.store.createTask(dto as CreateTaskDTO)
        sendJson(201, { success: true, data: task })
        return
      }

      // 3. GET /api/tasks/:id
      const taskDetailMatch = pathname.match(/^\/api\/tasks\/([^/]+)$/)
      if (taskDetailMatch && method === 'GET') {
        const taskId = routeParam(taskDetailMatch)
        const task = await this.store.getTask(taskId)
        if (!task) {
          sendJson(404, { success: false, error: 'Tarefa não encontrada' })
          return
        }
        sendJson(200, { success: true, data: task })
        return
      }

      // 4. PATCH /api/tasks/:id/pause ou /resume
      const pauseMatch = pathname.match(/^\/api\/tasks\/([^/]+)\/pause$/)
      if (pauseMatch && method === 'POST') {
        const taskId = routeParam(pauseMatch)
        const updated = await this.store.updateTask(taskId, { status: 'PAUSED' })
        sendJson(200, { success: true, data: updated })
        return
      }

      const resumeMatch = pathname.match(/^\/api\/tasks\/([^/]+)\/resume$/)
      if (resumeMatch && method === 'POST') {
        const taskId = routeParam(resumeMatch)
        const current = await this.store.getTask(taskId)
        if (!current) {
          sendJson(404, { success: false, error: 'Tarefa não encontrada' })
          return
        }

        const nextRun = RecurrenceEngine.calculateNextRun(current, new Date())
        const updated = await this.store.updateTask(taskId, {
          status: 'ACTIVE',
          nextRunAt: nextRun,
        })
        sendJson(200, { success: true, data: updated })
        return
      }

      // 5. POST /api/tasks/:id/trigger (Executar Agora)
      const triggerMatch = pathname.match(/^\/api\/tasks\/([^/]+)\/trigger$/)
      if (triggerMatch && method === 'POST') {
        const taskId = routeParam(triggerMatch)
        const task = await this.store.getTask(taskId)
        if (!task) {
          sendJson(404, { success: false, error: 'Tarefa não encontrada' })
          return
        }

        const run = await this.store.createRun(task.id, new Date())
        // Worker async execution
        this.worker
          .executeJob(jobForRun(task, run.id))
          .catch((err: unknown) => {
            console.error('[API Trigger Error]', err)
          })

        sendJson(202, {
          success: true,
          message: 'Disparo manual iniciado com sucesso',
          data: { runId: run.id },
        })
        return
      }

      // 6. GET /api/tasks/:id/runs (Histórico de execuções da tarefa)
      const runsMatch = pathname.match(/^\/api\/tasks\/([^/]+)\/runs$/)
      if (runsMatch && method === 'GET') {
        const taskId = routeParam(runsMatch)
        const runs = await this.store.listRunsByTask(taskId)
        sendJson(200, { success: true, data: runs })
        return
      }

      // 7. GET /api/notifications
      if (pathname === '/api/notifications' && method === 'GET') {
        const userId = context.query.get('userId') || 'default'
        const unreadOnly = context.query.get('unread') === 'true'
        const notifications = await this.store.listNotifications(userId, unreadOnly)
        sendJson(200, { success: true, data: notifications })
        return
      }

      // 8. POST /api/notifications/:id/read
      const readNotifMatch = pathname.match(/^\/api\/notifications\/([^/]+)\/read$/)
      if (readNotifMatch && method === 'POST') {
        const notifId = routeParam(readNotifMatch)
        const ok = await this.store.markNotificationRead(notifId)
        sendJson(200, { success: ok })
        return
      }

      // 404 Route Not Found
      sendJson(404, { success: false, error: `Rota não encontrada: ${method} ${pathname}` })
      return
    } catch (err: unknown) {
      console.error('[AutomationApiRouter Error]', err)
      const message = err instanceof Error ? err.message : 'Erro interno no servidor'
      sendJson(500, { success: false, error: message })
      return
    }
  }

  private async readJsonBody(req: IncomingMessage): Promise<unknown> {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method || '')) return undefined
    return new Promise((resolve) => {
      let data = ''
      req.on('data', (chunk: Buffer | string) => {
        data += chunk.toString()
      })
      req.on('end', () => {
        try {
          resolve(data ? JSON.parse(data) : undefined)
        } catch {
          resolve(undefined)
        }
      })
    })
  }
}
