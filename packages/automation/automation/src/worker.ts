import { IAutomationStore } from './store'
import { NotificationService } from './notifier'
import { ActionHandler, TaskExecutionContext, TaskLogEntry, RunStatus, TaskStatus } from './types'

export interface EnqueuedJobData {
  runId: string
  taskId: string
  userId: string
  title: string
  actionType: string
  actionPayload: Record<string, unknown>
  timeoutSeconds: number
  retryLimit: number
  attemptNumber: number
}

export class TaskWorker {
  private handlers = new Map<string, ActionHandler>()

  constructor(
    private readonly store: IAutomationStore,
    private readonly notifier: NotificationService,
  ) {}

  public registerHandler(actionType: string, handler: ActionHandler): void {
    this.handlers.set(actionType, handler)
  }

  public async executeJob(job: EnqueuedJobData): Promise<void> {
    const startedAt = new Date()
    const logs: TaskLogEntry[] = []

    const logger = (message: string, level: 'info' | 'warn' | 'error' = 'info') => {
      logs.push({
        timestamp: new Date().toISOString(),
        level,
        message,
      })
    }

    logger(`Iniciando execução da atividade: "${job.title}" [Ação: ${job.actionType}]`)

    // 1. Set status to RUNNING
    await this.store.updateRun(job.runId, {
      status: 'RUNNING',
      startedAt,
      logs,
    })

    const handler = this.handlers.get(job.actionType)
    if (!handler) {
      const errMsg = `Nenhum manipulador (handler) registrado para a ação "${job.actionType}"`
      logger(errMsg, 'error')
      await this.finalizeRun(job, startedAt, 'FAILED', logs, undefined, errMsg)
      return
    }

    const context: TaskExecutionContext = {
      runId: job.runId,
      taskId: job.taskId,
      attemptNumber: job.attemptNumber,
      log: logger,
    }

    try {
      // 2. Execute with Timeout Guard
      const output = await this.executeWithTimeout(
        handler(job.actionPayload, context),
        job.timeoutSeconds * 1000,
      )

      logger('Atividade finalizada com êxito.')
      await this.finalizeRun(job, startedAt, 'SUCCESS', logs, output)
    } catch (err: unknown) {
      const isTimeout = err instanceof Error && err.message === 'EXECUTION_TIMEOUT'
      const status: RunStatus = isTimeout ? 'TIMED_OUT' : 'FAILED'
      const errorMessage = isTimeout
        ? `A execução excedeu o tempo limite configurado de ${job.timeoutSeconds}s`
        : (err instanceof Error ? err.message : String(err))
      const errorStack = err instanceof Error ? err.stack : undefined

      logger(`Falha na execução: ${errorMessage}`, 'error')
      await this.finalizeRun(job, startedAt, status, logs, undefined, errorMessage, errorStack)
    }
  }

  private async executeWithTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    let timer: NodeJS.Timeout | undefined
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('EXECUTION_TIMEOUT')), timeoutMs)
    })

    try {
      return await Promise.race([promise, timeoutPromise])
    } finally {
      if (timer) clearTimeout(timer)
    }
  }

  private async finalizeRun(
    job: EnqueuedJobData,
    startedAt: Date,
    status: RunStatus,
    logs: TaskLogEntry[],
    outputData?: Record<string, unknown>,
    errorMessage?: string,
    errorStack?: string,
  ): Promise<void> {
    const finishedAt = new Date()
    const durationMs = finishedAt.getTime() - startedAt.getTime()

    // 1. Update the TaskRun record
    await this.store.updateRun(job.runId, {
      status,
      finishedAt,
      durationMs,
      outputData,
      errorMessage,
      errorStack,
      logs,
    })

    // 2. Update task stats and completion status
    const task = await this.store.getTask(job.taskId)
    if (task) {
      const isSuccess = status === 'SUCCESS'
      const newTotal = isSuccess ? task.totalRunsCompleted + 1 : task.totalRunsCompleted

      const isCompleted =
        task.scheduleType === 'ONCE' ||
        (task.maxRuns !== null && newTotal >= task.maxRuns)

      await this.store.updateTask(job.taskId, {
        totalRunsCompleted: newTotal,
        lastRunAt: finishedAt,
        lastRunStatus: status,
        status: isCompleted ? ('COMPLETED' as TaskStatus) : task.status,
        nextRunAt: isCompleted ? null : task.nextRunAt,
      })
    }

    // 3. Emit persistent notification and trigger real-time dispatch
    const isSuccess = status === 'SUCCESS'
    await this.notifier.notifyTaskFinished({
      taskId: job.taskId,
      runId: job.runId,
      userId: job.userId,
      level: isSuccess ? 'SUCCESS' : 'ERROR',
      title: isSuccess
        ? `Atividade Concluída: ${job.title}`
        : `Falha na Atividade: ${job.title}`,
      message: isSuccess
        ? `A atividade agendada "${job.title}" foi executada com sucesso em ${(durationMs / 1000).toFixed(2)}s.`
        : `A atividade agendada "${job.title}" falhou: ${errorMessage}`,
      summaryData: {
        status,
        durationMs,
        outputSummary: outputData,
      },
    })
  }
}
