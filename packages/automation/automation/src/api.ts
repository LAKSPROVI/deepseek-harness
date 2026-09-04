import { IncomingMessage, ServerResponse } from 'http'
import { IAutomationStore } from './store'
import { AutomationScheduler } from './scheduler'
import { TaskWorker } from './worker'
import { CreateTaskDTO, TaskStatus } from './types'
import { RecurrenceEngine } from './recurrence'

export interface RequestContext {
  method: string
  url: string
  body?: unknown
  params: Record<string, string>
  query: URLSearchParams
}

/**
 * Universal, dependency-free REST API Handler for the Automation System.
 * Usable with native Node http, Express, Fastify, Koa, or Hono.
 */
export class AutomationApiRouter {
  constructor(
    private readonly store: IAutomationStore,
    private readonly scheduler: AutomationScheduler,
    private readonly worker: TaskWorker,
  ) {}

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
        return sendJson(200, { success: true, data: tasks })
      }

      // 2. POST /api/tasks
      if (pathname === '/api/tasks' && method === 'POST') {
        const dto: CreateTaskDTO = context.body
        if (!dto.title || !dto.scheduleType || !dto.scheduleExpr || !dto.actionType) {
          return sendJson(400, {
            success: false,
            error: 'Campos obrigatórios ausentes: title, scheduleType, scheduleExpr, actionType',
          })
        }
        const task = await this.store.createTask(dto)
        return sendJson(201, { success: true, data: task })
      }

      // 3. GET /api/tasks/:id
      const taskDetailMatch = pathname.match(/^\/api\/tasks\/([^/]+)$/)
      if (taskDetailMatch && method === 'GET') {
        const taskId = taskDetailMatch[1]
        const task = await this.store.getTask(taskId)
        if (!task) return sendJson(404, { success: false, error: 'Tarefa não encontrada' })
        return sendJson(200, { success: true, data: task })
      }

      // 4. PATCH /api/tasks/:id/pause ou /resume
      const pauseMatch = pathname.match(/^\/api\/tasks\/([^/]+)\/pause$/)
      if (pauseMatch && method === 'POST') {
        const taskId = pauseMatch[1]
        const updated = await this.store.updateTask(taskId, { status: 'PAUSED' as TaskStatus })
        return sendJson(200, { success: true, data: updated })
      }

      const resumeMatch = pathname.match(/^\/api\/tasks\/([^/]+)\/resume$/)
      if (resumeMatch && method === 'POST') {
        const taskId = resumeMatch[1]
        const current = await this.store.getTask(taskId)
        if (!current) return sendJson(404, { success: false, error: 'Tarefa não encontrada' })

        const nextRun = RecurrenceEngine.calculateNextRun(current, new Date())
        const updated = await this.store.updateTask(taskId, {
          status: 'ACTIVE' as TaskStatus,
          nextRunAt: nextRun,
        })
        return sendJson(200, { success: true, data: updated })
      }

      // 5. POST /api/tasks/:id/trigger (Executar Agora)
      const triggerMatch = pathname.match(/^\/api\/tasks\/([^/]+)\/trigger$/)
      if (triggerMatch && method === 'POST') {
        const taskId = triggerMatch[1]
        const task = await this.store.getTask(taskId)
        if (!task) return sendJson(404, { success: false, error: 'Tarefa não encontrada' })

        const run = await this.store.createRun(task.id, new Date())
        // Worker async execution
        this.worker
          .executeJob({
            runId: run.id,
            taskId: task.id,
            userId: task.userId,
            title: task.title,
            actionType: task.actionType,
            actionPayload: task.actionPayload,
            timeoutSeconds: task.timeoutSeconds,
            retryLimit: task.retryLimit,
            attemptNumber: 1,
          })
          .catch(err => console.error('[API Trigger Error]', err))

        return sendJson(202, {
          success: true,
          message: 'Disparo manual iniciado com sucesso',
          data: { runId: run.id },
        })
      }

      // 6. GET /api/tasks/:id/runs (Histórico de execuções da tarefa)
      const runsMatch = pathname.match(/^\/api\/tasks\/([^/]+)\/runs$/)
      if (runsMatch && method === 'GET') {
        const taskId = runsMatch[1]
        const runs = await this.store.listRunsByTask(taskId)
        return sendJson(200, { success: true, data: runs })
      }

      // 7. GET /api/notifications
      if (pathname === '/api/notifications' && method === 'GET') {
        const userId = context.query.get('userId') || 'default'
        const unreadOnly = context.query.get('unread') === 'true'
        const notifications = await this.store.listNotifications(userId, unreadOnly)
        return sendJson(200, { success: true, data: notifications })
      }

      // 8. POST /api/notifications/:id/read
      const readNotifMatch = pathname.match(/^\/api\/notifications\/([^/]+)\/read$/)
      if (readNotifMatch && method === 'POST') {
        const notifId = readNotifMatch[1]
        const ok = await this.store.markNotificationRead(notifId)
        return sendJson(200, { success: ok })
      }

      // 404 Route Not Found
      return sendJson(404, { success: false, error: `Rota não encontrada: ${method} ${pathname}` })
    } catch (err: unknown) {
      console.error('[AutomationApiRouter Error]', err)
      const message = err instanceof Error ? err.message : 'Erro interno no servidor'
      return sendJson(500, { success: false, error: message })
    }
  }

  private async readJsonBody(req: IncomingMessage): Promise<unknown> {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method || '')) return undefined
    return new Promise((resolve) => {
      let data = ''
      req.on('data', (chunk) => {
        data += chunk
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
