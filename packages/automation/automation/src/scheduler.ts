import { IAutomationStore } from './store'
import { TaskWorker } from './worker'
import { RecurrenceEngine } from './recurrence'

/** Polls the store for due tasks and hands each one to the worker, honoring overlap policies. */
export class AutomationScheduler {
  private isRunning: boolean = false
  private intervalTimer: NodeJS.Timeout | null = null

  constructor(
    private readonly store: IAutomationStore,
    private readonly worker: TaskWorker,
    private readonly pollIntervalMs: number = 1000,
  ) {}

  /** Tick once immediately, then on every poll interval; idempotent. */
  public start(): void {
    if (this.isRunning) return
    this.isRunning = true
    this.tick().catch((err: unknown) => {
      console.error('[Scheduler] Error on first tick:', err)
    })
    this.intervalTimer = setInterval(() => {
      this.tick().catch((err: unknown) => {
        console.error('[Scheduler] Error on tick:', err)
      })
    }, this.pollIntervalMs)
  }

  /** Stop polling; a tick already in flight completes. */
  public stop(): void {
    this.isRunning = false
    if (this.intervalTimer) {
      clearInterval(this.intervalTimer)
      this.intervalTimer = null
    }
  }

  /**
   * Performs one cycle of due task discovery, concurrency checking, and dispatching.
   * Can also be called directly for immediate manual trigger or testing.
   * @param currentTime - clock used to find due tasks; defaults to now.
   * @returns number of runs dispatched in this cycle.
   */
  public async tick(currentTime: Date = new Date()): Promise<number> {
    const dueTasks = await this.store.findDueTasks(currentTime)
    let dispatchedCount = 0

    for (const task of dueTasks) {
      // 1. Check overlap policy
      if (task.overlapPolicy === 'SKIP') {
        const hasActive = await this.store.hasActiveRun(task.id)
        if (hasActive) {
          // Advance nextRunAt anyway so it doesn't get stuck
          const nextRun = RecurrenceEngine.calculateNextRun(task, currentTime)
          await this.store.updateTask(task.id, { nextRunAt: nextRun })
          continue
        }
      }

      // 2. Create the execution Run record
      const run = await this.store.createRun(task.id, task.nextRunAt || currentTime)

      // 3. Compute and advance nextRunAt atomically on the task
      const nextRun = RecurrenceEngine.calculateNextRun(task, currentTime)
      const isCompleted =
        nextRun === null && (task.scheduleType === 'ONCE' || task.maxRuns !== null)

      await this.store.updateTask(task.id, {
        nextRunAt: nextRun,
        status: isCompleted ? 'COMPLETED' : 'ACTIVE',
      })

      // 4. Dispatch to worker
      dispatchedCount++
      // Execute asynchronously without blocking the scheduler loop
      this.worker
        .executeJob({
          runId: run.id,
          taskId: task.id,
          userId: task.userId,
          title: task.title,
          actionType: task.actionType,
          actionPayload: task.actionPayload,
          // Optional under `exactOptionalPropertyTypes`: omit rather than pass
          // an explicit `undefined`, which is a different type from absent.
          ...task.model !== undefined ? { model: task.model } : {},
          ...task.modelProvider !== undefined ? { modelProvider: task.modelProvider } : {},
          ...task.promptTemplate !== undefined ? { promptTemplate: task.promptTemplate } : {},
          timeoutSeconds: task.timeoutSeconds,
          retryLimit: task.retryLimit,
          attemptNumber: 1,
        })
        .catch((err: unknown) => {
          console.error(`[Scheduler] Unhandled error running job for task ${task.id}:`, err)
        })
    }

    return dispatchedCount
  }
}
