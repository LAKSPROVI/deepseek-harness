/** Client-safe automation projections and owner-checked controls. */

import type { IAutomationStore } from './store.ts'
import { RecurrenceEngine } from './recurrence.ts'
import type { AutomationTask } from './types.ts'
import type { AutomationTaskView } from './remote-types.ts'
export type { AutomationTaskView } from './remote-types.ts'

/** Stable policy supplied by the one Host owner of the persistent store. */
export interface AutomationControllerConfig {
  readonly userId: string
}

/** Raised before a caller can observe or mutate a task owned by another user. */
export class AutomationTaskNotFoundError extends Error {
  constructor(taskId: string) {
    super(`automation task "${taskId}" not found`)
    this.name = 'AutomationTaskNotFoundError'
  }
}

/** Convert one stored task into a detached lossless JSON response. */
function view(task: AutomationTask): AutomationTaskView {
  return {
    id: task.id,
    title: task.title,
    ...task.description === undefined ? {} : { description: task.description },
    scheduleType: task.scheduleType,
    status: task.status,
    nextRunAt: task.nextRunAt?.toISOString() ?? null,
    lastRunAt: task.lastRunAt?.toISOString() ?? null,
    totalRunsCompleted: task.totalRunsCompleted,
    maxRuns: task.maxRuns,
    createdAt: task.createdAt.toISOString(),
    updatedAt: task.updatedAt.toISOString(),
  }
}

/** Owner-scoped read and state controls shared by Remote and chat entrypoints. */
export class AutomationController {
  constructor(
    private readonly store: IAutomationStore,
    private readonly config: AutomationControllerConfig,
  ) {}

  /**
   * List only the configured owner's detached JSON-safe task views.
   * @returns every task of the configured owner, projected for the Client.
   */
  async list(): Promise<AutomationTaskView[]> {
    return (await this.store.listTasks(this.config.userId)).map(view)
  }

  /**
   * Pause an owned task without accepting a user identity from the caller.
   * @param taskId - task to pause; must belong to the configured owner.
   * @returns the updated task view.
   */
  async pause(taskId: string): Promise<AutomationTaskView> {
    await this.owned(taskId)
    return view(await this.store.updateTask(taskId, { status: 'PAUSED' }))
  }

  /**
   * Resume an owned task and calculate its next run from the current clock.
   * @param taskId - task to resume; must belong to the configured owner.
   * @returns the updated task view with its recalculated next run.
   */
  async resume(taskId: string): Promise<AutomationTaskView> {
    const task = await this.owned(taskId)
    return view(await this.store.updateTask(taskId, {
      status: 'ACTIVE',
      nextRunAt: RecurrenceEngine.calculateNextRun(task, new Date()),
    }))
  }

  /**
   * Project one owned task for the Client.
   * @param taskId - task to read; must belong to the configured owner.
   * @returns the task view.
   */
  async view(taskId: string): Promise<AutomationTaskView> {
    return view(await this.owned(taskId))
  }

  /**
   * Return an owned task to a Host-only executor without exposing it to the Client.
   * @param taskId - task to read; must belong to the configured owner.
   * @returns the full durable task record.
   */
  async task(taskId: string): Promise<AutomationTask> {
    return await this.owned(taskId)
  }

  /** Resolve one task only when it belongs to the Host-configured owner. */
  private async owned(taskId: string): Promise<AutomationTask> {
    const task = await this.store.getTask(taskId)
    if (task === null || task.userId !== this.config.userId) throw new AutomationTaskNotFoundError(taskId)
    return task
  }
}
