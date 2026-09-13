import type { AutomationTaskView, AutomationTriggerReceipt } from '@deepseek-ai/dsh-automation/remote-types'

export type { AutomationTaskView } from '@deepseek-ai/dsh-automation/remote-types'

/** Browser actions obtained from `ctx.remote.automations`. */
export interface AutomationActionProps {
  readonly list: () => Promise<readonly AutomationTaskView[]>
  readonly trigger: (taskId: string) => Promise<AutomationTriggerReceipt>
  readonly pause: (taskId: string) => Promise<AutomationTaskView>
  readonly resume: (taskId: string) => Promise<AutomationTaskView>
}
