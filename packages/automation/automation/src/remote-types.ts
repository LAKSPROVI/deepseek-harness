/** Browser-safe projection of one persisted automation task. */
export interface AutomationTaskView {
  readonly id: string
  readonly title: string
  readonly description?: string
  readonly scheduleType: 'ONCE' | 'INTERVAL' | 'CRON' | 'RRULE'
  readonly status: 'ACTIVE' | 'PAUSED' | 'COMPLETED' | 'ERROR' | 'ARCHIVED'
  readonly nextRunAt: string | null
  readonly lastRunAt: string | null
  readonly totalRunsCompleted: number
  readonly maxRuns: number | null
  readonly createdAt: string
  readonly updatedAt: string
}

/** Accepted receipt after a manual run is queued. */
export interface AutomationTriggerReceipt { readonly runId: string }
