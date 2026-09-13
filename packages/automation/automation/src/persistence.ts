import { promises as fs } from 'fs'
import * as path from 'path'
import {
  AutomationTask,
  CreateTaskDTO,
  TaskRun,
  TaskNotification,
  RunStatus,
  TaskLogEntry,
} from './types'
import { InMemoryAutomationStore } from './store'

interface PersistentData {
  tasks: AutomationTask[]
  runs: TaskRun[]
  notifications: TaskNotification[]
}

/**
 * JSON file-backed store with atomic write-and-rename across restarts.
 *
 * Every store rule lives in {@link InMemoryAutomationStore}; this class only
 * loads the file into the inherited maps before the first read and persists
 * them after each write, so the two implementations cannot drift.
 */
export class FileAutomationStore extends InMemoryAutomationStore {
  private filePath: string
  private isLoaded = false
  private writeLock: Promise<void> = Promise.resolve()

  constructor(filePath: string) {
    super()
    this.filePath = path.resolve(filePath)
  }

  private async ensureLoaded(): Promise<void> {
    if (this.isLoaded) return

    try {
      const dir = path.dirname(this.filePath)
      await fs.mkdir(dir, { recursive: true })

      const content = await fs.readFile(this.filePath, 'utf-8')
      const data = JSON.parse(content) as PersistentData

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
      if ((err as { code?: string }).code !== 'ENOENT') {
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

  /** Load once, run one store operation, and persist when it wrote. */
  private async through<T>(operation: () => Promise<T>, persist: boolean | ((result: T) => boolean) = false): Promise<T> {
    await this.ensureLoaded()
    const result = await operation()
    if (typeof persist === 'function' ? persist(result) : persist) await this.persist()
    return result
  }

  public override createTask(dto: CreateTaskDTO): Promise<AutomationTask> {
    return this.through(() => super.createTask(dto), true)
  }

  public override getTask(id: string): Promise<AutomationTask | null> {
    return this.through(() => super.getTask(id))
  }

  public override listTasks(userId?: string): Promise<AutomationTask[]> {
    return this.through(() => super.listTasks(userId))
  }

  public override updateTask(id: string, updates: Partial<AutomationTask>): Promise<AutomationTask> {
    return this.through(() => super.updateTask(id, updates), true)
  }

  public override deleteTask(id: string): Promise<boolean> {
    return this.through(() => super.deleteTask(id), deleted => deleted)
  }

  public override findDueTasks(now: Date, limit?: number): Promise<AutomationTask[]> {
    return this.through(() => super.findDueTasks(now, limit))
  }

  public override createRun(taskId: string, scheduledFor: Date): Promise<TaskRun> {
    return this.through(() => super.createRun(taskId, scheduledFor), true)
  }

  public override getRun(id: string): Promise<TaskRun | null> {
    return this.through(() => super.getRun(id))
  }

  public override listRunsByTask(taskId: string): Promise<TaskRun[]> {
    return this.through(() => super.listRunsByTask(taskId))
  }

  public override updateRun(
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
    return this.through(() => super.updateRun(id, updates), true)
  }

  public override hasActiveRun(taskId: string): Promise<boolean> {
    return this.through(() => super.hasActiveRun(taskId))
  }

  public override createNotification(
    notif: Omit<TaskNotification, 'id' | 'createdAt' | 'isRead'>,
  ): Promise<TaskNotification> {
    return this.through(() => super.createNotification(notif), true)
  }

  public override listNotifications(userId: string, unreadOnly?: boolean): Promise<TaskNotification[]> {
    return this.through(() => super.listNotifications(userId, unreadOnly))
  }

  public override listNotificationsByTask(taskId: string): Promise<TaskNotification[]> {
    return this.through(() => super.listNotificationsByTask(taskId))
  }

  public override markNotificationRead(id: string): Promise<boolean> {
    return this.through(() => super.markNotificationRead(id), marked => marked)
  }
}
