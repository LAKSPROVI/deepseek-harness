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
 * High-performance, concurrent in-memory store with atomic lock simulation.
 */
export class InMemoryAutomationStore implements IAutomationStore {
  private tasks = new Map<string, AutomationTask>()
  private runs = new Map<string, TaskRun>()
  private notifications = new Map<string, TaskNotification>()
  private lockedTaskIds = new Set<string>()

  private generateId(prefix: string): string {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
  }

  public async createTask(dto: CreateTaskDTO): Promise<AutomationTask> {
    const id = this.generateId('task')
    const now = new Date()
    const taskBase = {
      id,
      userId: dto.userId,
      title: dto.title,
      description: dto.description,
      scheduleType: dto.scheduleType,
      scheduleExpr: dto.scheduleExpr,
      timezone: dto.timezone || 'America/Sao_Paulo',
      maxRuns: dto.maxRuns ?? null,
      totalRunsCompleted: 0,
      endAt: dto.endAt ?? null,
      actionType: dto.actionType,
      actionPayload: dto.actionPayload ?? {},
      model: dto.model,
      modelProvider: dto.modelProvider,
      promptTemplate: dto.promptTemplate,
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
    return { ...task }
  }

  public async getTask(id: string): Promise<AutomationTask | null> {
    const task = this.tasks.get(id)
    return task ? { ...task } : null
  }

  public async listTasks(userId?: string): Promise<AutomationTask[]> {
    const list = Array.from(this.tasks.values())
    if (userId) {
      return list.filter(t => t.userId === userId).map(t => ({ ...t }))
    }
    return list.map(t => ({ ...t }))
  }

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

  public async deleteTask(id: string): Promise<boolean> {
    return this.tasks.delete(id)
  }

  public async findDueTasks(now: Date, limit: number = 50): Promise<AutomationTask[]> {
    const due: AutomationTask[] = []
    for (const task of this.tasks.values()) {
      if (
        task.status === 'ACTIVE' &&
        task.nextRunAt !== null &&
        task.nextRunAt.getTime() <= now.getTime() &&
        !this.lockedTaskIds.has(task.id)
      ) {
        due.push({ ...task })
        if (due.length >= limit) break
      }
    }
    return due
  }

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

  public async getRun(id: string): Promise<TaskRun | null> {
    const run = this.runs.get(id)
    return run ? { ...run } : null
  }

  public async listRunsByTask(taskId: string): Promise<TaskRun[]> {
    return Array.from(this.runs.values())
      .filter(r => r.taskId === taskId)
      .sort((a, b) => b.runNumber - a.runNumber)
      .map(r => ({ ...r }))
  }

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

    const updated: TaskRun = {
      ...current,
      status: updates.status ?? current.status,
      startedAt: updates.startedAt ?? current.startedAt,
      finishedAt: updates.finishedAt ?? current.finishedAt,
      durationMs: updates.durationMs ?? current.durationMs,
      outputData: updates.outputData ?? current.outputData,
      errorMessage: updates.errorMessage ?? current.errorMessage,
      errorStack: updates.errorStack ?? current.errorStack,
      executionLogs: updates.logs ? [...updates.logs] : current.executionLogs,
    }

    this.runs.set(id, updated)
    return { ...updated }
  }

  public async hasActiveRun(taskId: string): Promise<boolean> {
    for (const run of this.runs.values()) {
      if (run.taskId === taskId && run.status === 'RUNNING') {
        return true
      }
    }
    return false
  }

  public async createNotification(
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
    return { ...created }
  }

  public async listNotifications(userId: string, unreadOnly?: boolean): Promise<TaskNotification[]> {
    return Array.from(this.notifications.values())
      .filter(n => n.userId === userId && (!unreadOnly || !n.isRead))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .map(n => ({ ...n }))
  }

  public async listNotificationsByTask(taskId: string): Promise<TaskNotification[]> {
    return Array.from(this.notifications.values())
      .filter(n => n.taskId === taskId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .map(n => ({ ...n }))
  }

  public async markNotificationRead(id: string): Promise<boolean> {
    const n = this.notifications.get(id)
    if (!n) return false
    this.notifications.set(id, { ...n, isRead: true, readAt: new Date() })
    return true
  }
}
