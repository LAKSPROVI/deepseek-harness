/** Browser entry binding the generated automations Remote artifact to its Client UI. */

import automationRemote from '@deepseek-ai/dsh-automation/remote'
import type { Context } from '@deepseek-ai/cordis'
import { mountAutomationUi } from './mount.ts'

export { inject } from './mount.ts'
export type { AutomationActionProps, AutomationInjected, AutomationTaskView } from './types.ts'
export type { AutomationKey } from './locales.ts'

/** Mount the generated automations Remote contribution and its browser UI. */
export async function apply(ctx: Context): Promise<() => Promise<void>> {
  return await mountAutomationUi(ctx, automationRemote)
}
