import { IAutomationStore } from './store'
import { NotificationService } from './notifier'

/**
 * Autonomous daemon that identifies and recovers zombie/stale task runs
 * (e.g. processes killed midway or network drops leaving tasks indefinitely in 'RUNNING').
 */
export class StaleTaskReaper {
  private timer: NodeJS.Timeout | null = null
  private isRunning = false

  constructor(
    private readonly store: IAutomationStore,
    private readonly notifier: NotificationService,
    private readonly checkIntervalMs: number = 60000,
    private readonly defaultStaleThresholdMs: number = 15 * 60000, // 15 minutes
  ) {}

  public start(): void {
    if (this.isRunning) return
    this.isRunning = true
    this.reap().catch(err => console.error('[StaleTaskReaper] Error on startup reap:', err))
    this.timer = setInterval(() => {
      this.reap().catch(err => console.error('[StaleTaskReaper] Error on periodic reap:', err))
    }, this.checkIntervalMs)
  }

  public stop(): void {
    this.isRunning = false
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  /**
   * Scans and marks all abandoned RUNNING jobs as TIMED_OUT or FAILED, liberating locks.
   */
  public async reap(customThresholdMs?: number): Promise<number> {
    const threshold = customThresholdMs ?? this.defaultStaleThresholdMs
    const now = Date.now()
    let reapedCount = 0

    const allTasks = await this.store.listTasks()
    for (const task of allTasks) {
      const runs = await this.store.listRunsByTask(task.id)
      for (const run of runs) {
        if (run.status === 'RUNNING') {
          const startedAt = run.startedAt ? new Date(run.startedAt).getTime() : run.createdAt.getTime()
          const taskTimeoutMs = (task.timeoutSeconds || 300) * 1000
          const cutoff = Math.max(taskTimeoutMs, threshold)

          if (now - startedAt > cutoff) {
            // Task is stale / dead
            reapedCount++
            const errorMessage = `A execução foi encerrada automaticamente pelo Reaper devido a inatividade ou reinicialização inesperada do servidor (> ${Math.round(cutoff / 1000)}s).`

            await this.store.updateRun(run.id, {
              status: 'TIMED_OUT',
              finishedAt: new Date(),
              durationMs: now - startedAt,
              errorMessage,
            })

            await this.notifier.notifyTaskFinished({
              taskId: task.id,
              runId: run.id,
              userId: task.userId,
              level: 'ERROR',
              title: `Recuperação de Falha: ${task.title}`,
              message: errorMessage,
            })
          }
        }
      }
    }

    return reapedCount
  }
}
