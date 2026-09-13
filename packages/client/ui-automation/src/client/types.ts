import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { AutomationTaskView, AutomationTriggerReceipt } from '@deepseek-ai/dsh-automation/remote-types'
// Type-only: pulls this package's LocaleNamespaceMap merge (the 'automation' seat).
import type { NS } from './locales.ts'

export type { AutomationTaskView } from '@deepseek-ai/dsh-automation/remote-types'

/** Browser actions obtained from `ctx.remote.automations`. */
export interface AutomationInjected {
  readonly list: () => Promise<readonly AutomationTaskView[]>
  readonly trigger: (taskId: string) => Promise<AutomationTriggerReceipt>
  readonly pause: (taskId: string) => Promise<AutomationTaskView>
  readonly resume: (taskId: string) => Promise<AutomationTaskView>
}

/** Full props of the automations header action: runtime share, injected face, and the locale seat. */
export type AutomationActionProps =
  PropsRuntime<'conversation.session.header.actions'> & InjectFace<AutomationInjected> & PropsLocale<typeof NS>
