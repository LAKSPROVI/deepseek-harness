/** Persistent Host automation service and generated Remote controls. */

import { isAbsolute, join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { expandHomePath, resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { AutomationController, AutomationTaskNotFoundError } from './controller.ts'
import type { AutomationTaskView, AutomationTriggerReceipt } from './remote-types.ts'
import { NotificationService } from './notifier.ts'
import { FileAutomationStore } from './persistence.ts'
import { StaleTaskReaper } from './reaper.ts'
import { AutomationScheduler } from './scheduler.ts'
import { TaskWorker } from './worker.ts'

/** Host composition values for the one persistent automation engine. */
export interface AutomationServiceConfig {
  /**
   * JSON store path. A relative path or `~` resolves under the Harness home
   * (`DSH_HOME`, default `~/.dsh`), never under the process cwd, so the desktop
   * launcher and a source checkout share one store. The service never
   * migrates, replaces, or rewrites it while listing.
   */
  readonly storePath: string
  /** Store owner selected by deployment policy, never supplied by the browser. */
  readonly userId?: string
  /** Scheduler polling interval supplied by deployment policy. */
  readonly pollIntervalMs?: number
  /** Whether this Host instance owns background scheduling and stale-run recovery. */
  readonly enabled?: boolean
}

/**
 * Anchor a configured store path to the Harness home. `path.resolve` alone would
 * anchor to the process cwd, which for the desktop launcher is the source
 * checkout — a store that silently moves with the working directory.
 * @param configured - absolute path, `~`-prefixed path, or path relative to the Harness home.
 * @returns the absolute store path.
 */
export function resolveStorePath(configured: string): string {
  const expanded = expandHomePath(configured)
  return isAbsolute(expanded) ? expanded : join(resolveDshHome(), expanded)
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    automation: AutomationService
  }
}

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    /** A task is absent or belongs to another configured owner. */
    'automation/not-found': { readonly taskId: string }
  }
}

/** One Host-owned engine that keeps its store, scheduler, and controls together. */
export class AutomationService extends TypertRemoteService {
  /** Existing store identity shared by Chat tools and Remote methods. */
  readonly store: FileAutomationStore
  /** Existing notification service shared by the scheduler and worker. */
  readonly notifier: NotificationService
  /** Existing worker with deployment-registered action handlers. */
  readonly worker: TaskWorker
  /** Existing periodic scheduler. */
  readonly scheduler: AutomationScheduler
  /** Existing stale-run reaper. */
  readonly reaper: StaleTaskReaper

  /** Store owner every Host-side caller (Chat tools, embedders) writes tasks for. */
  readonly owner: string

  private readonly controller: AutomationController

  constructor(ctx: Context, config: AutomationServiceConfig) {
    super(ctx, 'automation', { namespace: 'automations' })
    this.owner = config.userId ?? 'host'
    this.store = new FileAutomationStore(resolveStorePath(config.storePath))
    this.notifier = new NotificationService(this.store)
    this.worker = new TaskWorker(this.store, this.notifier)
    this.scheduler = new AutomationScheduler(this.store, this.worker, config.pollIntervalMs ?? 1_000)
    this.reaper = new StaleTaskReaper(this.store, this.notifier)
    this.controller = new AutomationController(this.store, { userId: this.owner })
    if (config.enabled ?? true) {
      ctx.effect(() => {
        this.scheduler.start()
        this.reaper.start()
        return () => {
          this.scheduler.stop()
          this.reaper.stop()
        }
      }, 'automation: persistent engine lifecycle')
    }
  }

  /**
   * List the deployment owner's persisted tasks without modifying the store.
   *
   * @returns Persisted automation tasks projected for the browser client.
   */
  @Remote('list')
  async list(): Promise<readonly AutomationTaskView[]> {
    return await this.controller.list()
  }

  /**
   * Queue one owned task immediately while leaving its recurrence unchanged.
   *
   * @param taskId Persisted automation task identifier.
   * @returns Identifier of the queued automation run.
   */
  @Remote('trigger')
  async trigger(taskId: string): Promise<AutomationTriggerReceipt> {
    return await this.withTaskError(taskId, () => this.triggerNow(taskId))
  }

  /**
   * Pause one owned task.
   *
   * @param taskId Persisted automation task identifier.
   * @returns Updated task projected for the browser client.
   */
  @Remote('pause')
  async pause(taskId: string): Promise<AutomationTaskView> {
    return await this.withTaskError(taskId, () => this.controller.pause(taskId))
  }

  /**
   * Resume one owned task and calculate its next run.
   *
   * @param taskId Persisted automation task identifier.
   * @returns Updated task projected for the browser client.
   */
  @Remote('resume')
  async resume(taskId: string): Promise<AutomationTaskView> {
    return await this.withTaskError(taskId, () => this.resumeTask(taskId))
  }

  /**
   * Existing Chat-tool entrypoint for a manual run.
   *
   * @param taskId Persisted automation task identifier.
   * @returns Receipt identifying the queued automation run.
   */
  async triggerNow(taskId: string): Promise<AutomationTriggerReceipt> {
    const task = await this.controller.task(taskId)
    const run = await this.store.createRun(task.id, new Date())
    void this.worker.executeJob({
      runId: run.id,
      taskId: task.id,
      userId: task.userId,
      title: task.title,
      actionType: task.actionType,
      actionPayload: task.actionPayload,
      ...task.model === undefined ? {} : { model: task.model },
      ...task.modelProvider === undefined ? {} : { modelProvider: task.modelProvider },
      ...task.promptTemplate === undefined ? {} : { promptTemplate: task.promptTemplate },
      timeoutSeconds: task.timeoutSeconds,
      retryLimit: task.retryLimit,
      attemptNumber: 1,
    }).catch((error: unknown) => { this.ctx.logger.error('automation manual run failed', error) })
    return { runId: run.id }
  }

  /**
   * Existing Chat-tool entrypoint for a resumed schedule.
   *
   * @param taskId Persisted automation task identifier.
   * @returns Updated automation task view.
   */
  async resumeTask(taskId: string): Promise<AutomationTaskView> {
    return await this.controller.resume(taskId)
  }

  /**
   * Existing Chat-tool entrypoint for a paused schedule.
   *
   * @param taskId Persisted automation task identifier.
   * @returns Updated automation task view.
   */
  async pauseTask(taskId: string): Promise<AutomationTaskView> {
    return await this.controller.pause(taskId)
  }

  /**
   * Read one owned task as its Client projection.
   *
   * @param taskId Persisted automation task identifier.
   * @returns Automation task view.
   * @throws AutomationTaskNotFoundError when the task is absent or owned by someone else.
   */
  async taskView(taskId: string): Promise<AutomationTaskView> {
    return await this.controller.view(taskId)
  }

  /**
   * Delete one owned task and its runs; the ownership check runs before any write.
   *
   * @param taskId Persisted automation task identifier.
   * @returns Whether the store held the task.
   * @throws AutomationTaskNotFoundError when the task is absent or owned by someone else.
   */
  async deleteTask(taskId: string): Promise<boolean> {
    await this.controller.task(taskId)
    return await this.store.deleteTask(taskId)
  }

  /** Convert only expected owner checks into a stable Client-visible Remote failure. */
  private async withTaskError<T>(taskId: string, operation: () => Promise<T>): Promise<T> {
    try {
      return await operation()
    } catch (error: unknown) {
      if (!(error instanceof AutomationTaskNotFoundError)) throw error
      throw new RemoteError('automation/not-found', error.message, { taskId }, { cause: error })
    }
  }
}

export default AutomationService
