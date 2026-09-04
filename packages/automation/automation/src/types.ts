/**
 * Core domain types for the Automation and Task Lifecycle Engine.
 */

export type TaskScheduleType = 'ONCE' | 'INTERVAL' | 'CRON' | 'RRULE'
export type TaskStatus = 'ACTIVE' | 'PAUSED' | 'COMPLETED' | 'ERROR' | 'ARCHIVED'
export type TaskOverlapPolicy = 'ALLOW' | 'SKIP' | 'QUEUE'
export type RunStatus = 'QUEUED' | 'RUNNING' | 'SUCCESS' | 'FAILED' | 'TIMED_OUT' | 'CANCELLED'
export type NotificationLevel = 'INFO' | 'SUCCESS' | 'WARNING' | 'ERROR'

export interface TaskLogEntry {
  readonly timestamp: string
  readonly level: 'info' | 'warn' | 'error'
  readonly message: string
}

export interface AutomationTask {
  readonly id: string
  readonly userId: string
  readonly title: string
  readonly description?: string

  readonly scheduleType: TaskScheduleType
  readonly scheduleExpr: string       // E.g.: ISO string (ONCE), seconds (INTERVAL), "0 9 * * 1" (CRON), or RRULE string
  readonly timezone: string           // E.g.: "America/Sao_Paulo", "UTC"

  readonly maxRuns: number | null     // null = indefinite / continuous
  readonly totalRunsCompleted: number
  readonly endAt: Date | null

  readonly actionType: string         // Unique handler action key
  readonly actionPayload: Record<string, unknown>
  readonly model?: string             // Target LLM Model (e.g. "ag/gemini-3.7-flash-high", "deepseek-chat", "cc/claude-3-7-sonnet")
  readonly modelProvider?: string     // Target LLM Provider route (optional)
  readonly promptTemplate?: string    // Custom prompt / instruction for the LLM execution
  readonly timeoutSeconds: number
  readonly retryLimit: number
  readonly overlapPolicy: TaskOverlapPolicy

  readonly status: TaskStatus
  readonly nextRunAt: Date | null
  readonly lastRunAt: Date | null
  readonly lastRunStatus?: RunStatus

  readonly createdAt: Date
  readonly updatedAt: Date
}

export interface CreateTaskDTO {
  readonly userId: string
  readonly title: string
  readonly description?: string
  readonly scheduleType: TaskScheduleType
  readonly scheduleExpr: string
  readonly timezone?: string
  readonly maxRuns?: number | null
  readonly endAt?: Date | null
  readonly actionType: string
  readonly actionPayload?: Record<string, unknown>
  readonly model?: string
  readonly modelProvider?: string
  readonly promptTemplate?: string
  readonly timeoutSeconds?: number
  readonly retryLimit?: number
  readonly overlapPolicy?: TaskOverlapPolicy
}

export interface TaskRun {
  readonly id: string
  readonly taskId: string
  readonly runNumber: number
  readonly status: RunStatus
  readonly attemptNumber: number

  readonly scheduledFor: Date
  readonly startedAt?: Date
  readonly finishedAt?: Date
  readonly durationMs?: number

  readonly outputData?: Record<string, unknown>
  readonly errorMessage?: string
  readonly errorStack?: string
  readonly executionLogs: readonly TaskLogEntry[]

  readonly createdAt: Date
}

export interface TaskNotification {
  readonly id: string
  readonly taskId: string
  readonly runId: string
  readonly userId: string
  readonly level: NotificationLevel
  readonly title: string
  readonly message: string
  readonly summaryData?: Record<string, unknown>
  readonly isRead: boolean
  readonly readAt?: Date
  readonly createdAt: Date
}

export interface TaskExecutionContext {
  readonly runId: string
  readonly taskId: string
  readonly attemptNumber: number
  readonly model?: string
  readonly modelProvider?: string
  readonly promptTemplate?: string
  log(message: string, level?: 'info' | 'warn' | 'error'): void
}

export type ActionHandler = (
  payload: Record<string, unknown>,
  context: TaskExecutionContext,
) => Promise<Record<string, unknown>>
