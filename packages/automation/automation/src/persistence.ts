import { promises as fs } from 'fs'
import * as path from 'path'
import {
  AutomationTask,
  CreateTaskDTO,
  TaskRun,
  TaskNotification,
  RunStatus,
  TaskStatus,
  TaskLogEntry,
} from './types'
import { IAutomationStore } from './store'
import { RecurrenceEngine } from './recurrence'

interface PersistentData {
  tasks: AutomationTask[]
  runs: TaskRun[]
  notifications: TaskNotification[]
}

/**
 * Robust, production-grade JSON file-based persistence store.
 * Supports atomic write-and-rename guarantees across restarts.
 */
export class FileAutomationStore implements IAutomationStore {
  private filePath: string
  private isLoaded = false
  private tasks = new Map<string, AutomationTask>()
  private runs = new Map<string, TaskRun>()
  private notifications = new Map<string, TaskNotification>()
  private writeLock: Promise<void> = Promise.resolve()

  constructor(filePath: string) {
    this.filePath = path.resolve(filePath)
  }

  private generateId(prefix: string): string {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
  }

  private async ensureLoaded(): Promise<void> {
    if (this.isLoaded) return

    try {
      const dir = path.dirname(this.filePath)
      await fs.mkdir(dir, { recursive: true })

      const content = await fs.readFile(this.filePath, 'utf-8')
      const data: PersistentData = JSON.parse(content)

      if (Array.isArray(data.tasks)) {
        for (const t of data.tasks) {
          this.tasks.set(t.id, {
            ...t,
            createdAt: new Date(t.createdAt),
            updatedAt: new Date(t.updatedAt),
            endAt: t.endAt ? new Date(t.endAt) : null,
            nextRunAt: t.nextRunAt ? new Date(t.nextRunAt) : null,
            lastRunAt: t.lastRunAt ? new Date(t.lastRunAt) : null,
          })
        }
      }

      if (Array.isArray(data.runs)) {
        for (const r of data.runs) {
          this.runs.set(r.id, {
            ...r,
            scheduledFor: new Date(r.scheduledFor),
            // A run never started or never finished leaves the field UNSET —
            // under `exactOptionalPropertyTypes` that is not the same as
            // setting it to `undefined`.
            ...r.startedAt ? { startedAt: new Date(r.startedAt) } : {},
            ...r.finishedAt ? { finishedAt: new Date(r.finishedAt) } : {},
            createdAt: new Date(r.createdAt),
          })
        }
      }

      if (Array.isArray(data.notifications)) {
        for (const n of data.notifications) {
          this.notifications.set(n.id, {
            ...n,
            // Unread notifications leave `readAt` unset, not `undefined`.
            ...n.readAt ? { readAt: new Date(n.readAt) } : {},
            createdAt: new Date(n.createdAt),
          })
        }
      }
    } catch (err: unknown) {
      if ((err as { code?: string })?.code !== 'ENOENT') {
        throw err
      }
      // If file does not exist, start with empty data
    }

    this.isLoaded = true
  }

  private async persist(): Promise<void> {
    // Chain writes sequentially to prevent race conditions
    this.writeLock = this.writeLock.then(async () => {
      const data: PersistentData = {
        tasks: Array.from(this.tasks.values()),
        runs: Array.from(this.runs.values()),
        notifications: Array.from(this.notifications.values()),
      }

      const tempPath = `${this.filePath}.tmp.${Date.now()}`
      await fs.writeFile(tempPath, JSON.stringify(data, null, 2), 'utf-8')
      await fs.rename(tempPath, this.filePath)
    })

    await this.writeLock
  }

  public async createTask(dto: CreateTaskDTO): Promise<AutomationTask> {
    await this.ensureLoaded()
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
    await this.persist()
    return { ...task }
  }

  public async getTask(id: string): Promise<AutomationTask | null> {
    await this.ensureLoaded()
    const task = this.tasks.get(id)
    return task ? { ...task } : null
  }

  public async listTasks(userId?: string): Promise<AutomationTask[]> {
    await this.ensureLoaded()
    const list = Array.from(this.tasks.values())
    if (userId) {
      return list.filter(t => t.userId === userId).map(t => ({ ...t }))
    }
    return list.map(t => ({ ...t }))
  }

  public async updateTask(id: string, updates: Partial<AutomationTask>): Promise<AutomationTask> {
    await this.ensureLoaded()
    const current = this.tasks.get(id)
    if (!current) throw new Error(`Task with ID ${id} not found`)

    const updated: AutomationTask = {
      ...current,
      ...updates,
      updatedAt: new Date(),
    }

    this.tasks.set(id, updated)
    await this.persist()
    return { ...updated }
  }

  public async deleteTask(id: string): Promise<boolean> {
    await this.ensureLoaded()
    const res = this.tasks.delete(id)
    if (res) await this.persist()
    return res
  }

  public async findDueTasks(now: Date, limit: number = 50): Promise<AutomationTask[]> {
    await this.ensureLoaded()
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
    return due
  }

  public async createRun(taskId: string, scheduledFor: Date): Promise<TaskRun> {
    await this.ensureLoaded()
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
    await this.persist()
    return { ...run }
  }

  public async getRun(id: string): Promise<TaskRun | null> {
    await this.ensureLoaded()
    const run = this.runs.get(id)
    return run ? { ...run } : null
  }

  public async listRunsByTask(taskId: string): Promise<TaskRun[]> {
    await this.ensureLoaded()
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
    await this.ensureLoaded()
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
    await this.persist()
    return { ...updated }
  }

  public async hasActiveRun(taskId: string): Promise<boolean> {
    await this.ensureLoaded()
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
    await this.ensureLoaded()
    const id = this.generateId('notif')
    const created: TaskNotification = {
      ...notif,
      id,
      isRead: false,
      createdAt: new Date(),
    }
    this.notifications.set(id, created)
    await this.persist()
    return { ...created }
  }

  public async listNotifications(userId: string, unreadOnly?: boolean): Promise<TaskNotification[]> {
    await this.ensureLoaded()
    return Array.from(this.notifications.values())
      .filter(n => n.userId === userId && (!unreadOnly || !n.isRead))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .map(n => ({ ...n }))
  }

  public async listNotificationsByTask(taskId: string): Promise<TaskNotification[]> {
    await this.ensureLoaded()
    return Array.from(this.notifications.values())
      .filter(n => n.taskId === taskId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .map(n => ({ ...n }))
  }

  public async markNotificationRead(id: string): Promise<boolean> {
    await this.ensureLoaded()
    const n = this.notifications.get(id)
    if (!n) return false
    this.notifications.set(id, { ...n, isRead: true, readAt: new Date() })
    await this.persist()
    return true
  }
}
