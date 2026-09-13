import {
  AutomationTask,
  CreateTaskDTO,
  TaskRun,
  TaskNotification,
  RunStatus,
  TaskStatus,
  TaskLogEntry,
} from './types'
import { RecurrenceEngine } from './recurrence'

/** Persistence contract for tasks, runs, and notifications; the file store is the shipped implementation. */
export interface IAutomationStore {
  createTask(dto: CreateTaskDTO): Promise<AutomationTask>
  getTask(id: string): Promise<AutomationTask | null>
  listTasks(userId?: string): Promise<AutomationTask[]>
  updateTask(id: string, updates: Partial<AutomationTask>): Promise<AutomationTask>
  deleteTask(id: string): Promise<boolean>

  findDueTasks(now: Date, limit?: number): Promise<AutomationTask[]>

  createRun(taskId: string, scheduledFor: Date): Promise<TaskRun>
  getRun(id: string): Promise<TaskRun | null>
  listRunsByTask(taskId: string): Promise<TaskRun[]>
  updateRun(
    id: string,
    updates: {
      status?: RunStatus
      startedAt?: Date
      finishedAt?: Date
      durationMs?: number
      outputData?: Record<string, unknown>
      errorMessage?: string
      errorStack?: string
      logs?: TaskLogEntry[]
    }
  ): Promise<TaskRun>

  hasActiveRun(taskId: string): Promise<boolean>

  createNotification(notif: Omit<TaskNotification, 'id' | 'createdAt' | 'isRead'>): Promise<TaskNotification>
  listNotifications(userId: string, unreadOnly?: boolean): Promise<TaskNotification[]>
  listNotificationsByTask(taskId: string): Promise<TaskNotification[]>
  markNotificationRead(id: string): Promise<boolean>
}

/**
 * In-memory store: the reference implementation of every store rule. The
 * file-backed store extends it and only adds loading and persistence.
 */
export class InMemoryAutomationStore implements IAutomationStore {
  protected readonly tasks = new Map<string, AutomationTask>()
  protected readonly runs = new Map<string, TaskRun>()
  protected readonly notifications = new Map<string, TaskNotification>()

  protected generateId(prefix: string): string {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
  }

  public createTask(dto: CreateTaskDTO): Promise<AutomationTask> {
    const id = this.generateId('task')
    const now = new Date()
    const taskBase = {
      id,
      userId: dto.userId,
      title: dto.title,
      // Optional fields under `exactOptionalPropertyTypes`: an absent field and
      // one explicitly set to `undefined` are different types, so spread them in
      // only when the DTO carried a value.
      ...dto.description !== undefined ? { description: dto.description } : {},
      scheduleType: dto.scheduleType,
      scheduleExpr: dto.scheduleExpr,
      timezone: dto.timezone || 'America/Sao_Paulo',
      maxRuns: dto.maxRuns ?? null,
      totalRunsCompleted: 0,
      endAt: dto.endAt ?? null,
      actionType: dto.actionType,
      actionPayload: dto.actionPayload ?? {},
      ...dto.model !== undefined ? { model: dto.model } : {},
      ...dto.modelProvider !== undefined ? { modelProvider: dto.modelProvider } : {},
      ...dto.promptTemplate !== undefined ? { promptTemplate: dto.promptTemplate } : {},
      timeoutSeconds: dto.timeoutSeconds ?? 300,
      retryLimit: dto.retryLimit ?? 3,
      overlapPolicy: dto.overlapPolicy ?? 'SKIP',
      status: 'ACTIVE' as TaskStatus,
      lastRunAt: null,
      createdAt: now,
      updatedAt: now,
    }

    const nextRunAt = RecurrenceEngine.calculateNextRun(taskBase, now)
    const task: AutomationTask = {
      ...taskBase,
      nextRunAt,
    }

    this.tasks.set(id, task)
    return Promise.resolve({ ...task })
  }

  public getTask(id: string): Promise<AutomationTask | null> {
    const task = this.tasks.get(id)
    return Promise.resolve(task ? { ...task } : null)
  }

  public listTasks(userId?: string): Promise<AutomationTask[]> {
    const list = Array.from(this.tasks.values())
    if (userId) {
      return Promise.resolve(list.filter(t => t.userId === userId).map(t => ({ ...t })))
    }
    return Promise.resolve(list.map(t => ({ ...t })))
  }

  // oxlint-disable-next-line typescript/require-await -- Preserve promise rejection semantics at the async provider contract.
  public async updateTask(id: string, updates: Partial<AutomationTask>): Promise<AutomationTask> {
    const current = this.tasks.get(id)
    if (!current) throw new Error(`Task with ID ${id} not found`)
    const updated: AutomationTask = {
      ...current,
      ...updates,
      updatedAt: new Date(),
    }
    this.tasks.set(id, updated)
    return { ...updated }
  }

  public deleteTask(id: string): Promise<boolean> {
    return Promise.resolve(this.tasks.delete(id))
  }

  public findDueTasks(now: Date, limit: number = 50): Promise<AutomationTask[]> {
    const due: AutomationTask[] = []
    for (const task of this.tasks.values()) {
      if (
        task.status === 'ACTIVE' &&
        task.nextRunAt !== null &&
        task.nextRunAt.getTime() <= now.getTime()
      ) {
        due.push({ ...task })
        if (due.length >= limit) break
      }
    }
    return Promise.resolve(due)
  }

  // oxlint-disable-next-line typescript/require-await -- Preserve promise rejection semantics at the async provider contract.
  public async createRun(taskId: string, scheduledFor: Date): Promise<TaskRun> {
    const task = this.tasks.get(taskId)
    if (!task) throw new Error(`Task ${taskId} not found`)

    const existingRuns = Array.from(this.runs.values()).filter(r => r.taskId === taskId)
    const runNumber = existingRuns.length + 1
    const runId = this.generateId('run')

    const run: TaskRun = {
      id: runId,
      taskId,
      runNumber,
      status: 'QUEUED',
      attemptNumber: 1,
      scheduledFor,
      executionLogs: [],
      createdAt: new Date(),
    }

    this.runs.set(runId, run)
    return { ...run }
  }

  public getRun(id: string): Promise<TaskRun | null> {
    const run = this.runs.get(id)
    return Promise.resolve(run ? { ...run } : null)
  }

  public listRunsByTask(taskId: string): Promise<TaskRun[]> {
    return Promise.resolve(Array.from(this.runs.values())
      .filter(r => r.taskId === taskId)
      .sort((a, b) => b.runNumber - a.runNumber)
      .map(r => ({ ...r })))
  }

  // oxlint-disable-next-line typescript/require-await -- Preserve promise rejection semantics at the async provider contract.
  public async updateRun(
    id: string,
    updates: {
      status?: RunStatus
      startedAt?: Date
      finishedAt?: Date
      durationMs?: number
      outputData?: Record<string, unknown>
      errorMessage?: string
      errorStack?: string
      logs?: TaskLogEntry[]
    },
  ): Promise<TaskRun> {
    const current = this.runs.get(id)
    if (!current) throw new Error(`TaskRun with ID ${id} not found`)

    // `...current` already supplies every prior value, so each update only needs
    // to override the fields it actually carries — spreading rather than
    // assigning keeps an absent optional absent under
    // `exactOptionalPropertyTypes`, where `undefined` is not the same as unset.
    const updated: TaskRun = {
      ...current,
      ...updates.status !== undefined ? { status: updates.status } : {},
      ...updates.startedAt !== undefined ? { startedAt: updates.startedAt } : {},
      ...updates.finishedAt !== undefined ? { finishedAt: updates.finishedAt } : {},
      ...updates.durationMs !== undefined ? { durationMs: updates.durationMs } : {},
      ...updates.outputData !== undefined ? { outputData: updates.outputData } : {},
      ...updates.errorMessage !== undefined ? { errorMessage: updates.errorMessage } : {},
      ...updates.errorStack !== undefined ? { errorStack: updates.errorStack } : {},
      executionLogs: updates.logs ? [...updates.logs] : current.executionLogs,
    }

    this.runs.set(id, updated)
    return { ...updated }
  }

  public hasActiveRun(taskId: string): Promise<boolean> {
    for (const run of this.runs.values()) {
      if (run.taskId === taskId && run.status === 'RUNNING') {
        return Promise.resolve(true)
      }
    }
    return Promise.resolve(false)
  }

  public createNotification(
    notif: Omit<TaskNotification, 'id' | 'createdAt' | 'isRead'>,
  ): Promise<TaskNotification> {
    const id = this.generateId('notif')
    const created: TaskNotification = {
      ...notif,
      id,
      isRead: false,
      createdAt: new Date(),
    }
    this.notifications.set(id, created)
    return Promise.resolve({ ...created })
  }

  public listNotifications(userId: string, unreadOnly?: boolean): Promise<TaskNotification[]> {
    return Promise.resolve(Array.from(this.notifications.values())
      .filter(n => n.userId === userId && (!unreadOnly || !n.isRead))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .map(n => ({ ...n })))
  }

  public listNotificationsByTask(taskId: string): Promise<TaskNotification[]> {
    return Promise.resolve(Array.from(this.notifications.values())
      .filter(n => n.taskId === taskId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .map(n => ({ ...n })))
  }

  public markNotificationRead(id: string): Promise<boolean> {
    const n = this.notifications.get(id)
    if (!n) return Promise.resolve(false)
    this.notifications.set(id, { ...n, isRead: true, readAt: new Date() })
    return Promise.resolve(true)
  }
}
