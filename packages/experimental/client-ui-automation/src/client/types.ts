/** Client-safe task projection supplied by the generated automations Remote namespace. */
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

/** Browser actions obtained from `ctx.remote.automations`. */
export interface AutomationActionProps {
  readonly list: () => Promise<readonly AutomationTaskView[]>
  readonly trigger: (taskId: string) => Promise<{ readonly runId: string }>
  readonly pause: (taskId: string) => Promise<AutomationTaskView>
  readonly resume: (taskId: string) => Promise<AutomationTaskView>
}
