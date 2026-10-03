/** Browser entry contributing the automations header panel to the conversation. */

// Type-only: pulls the generated Remote API and ctx.remote merge through the Client assembly boundary.
import type {} from '@deepseek-ai/dsh-automation/remote'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { Context } from '@deepseek-ai/cordis'
import { mountAutomationUi } from './mount.ts'

export { inject } from './mount.ts'
export type { AutomationActionProps, AutomationInjected, AutomationTaskView } from './types.ts'
export type { AutomationKey } from './locales.ts'

/**
 * Mount the automations header panel. The generated Remote artifact exists only
 * in lib; the api-remotes assembly mounts the namespace in production, so this
 * entry consumes it asynchronously and the source tier stays build-free.
 * @param ctx - client root context.
 * @returns the disposer that withdraws the panel.
 */
export function apply(ctx: Context): () => Promise<void> {
  return mountAutomationUi(ctx)
}
