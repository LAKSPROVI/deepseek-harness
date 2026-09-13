/** Source-safe automation panel registration and Remote mount lifecycle. */

import type {} from '@deepseek-ai/dsh-automation/remote'
import type { Context } from '@deepseek-ai/cordis'
import type { TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
import { AutomationAction } from './AutomationAction.tsx'
import { NS, en, zh } from './locales.ts'

/** Required browser services for the generated Remote namespace and header slot. */
export const inject = ['remote', 'slots', 'locale']

/**
 * Mount the automations namespace contribution and contribute its native header
 * panel. The generated Remote artifact exists only in lib, so the browser entry
 * (`index.ts`) binds it here and this file stays importable from source tests.
 * @param ctx - client root context.
 * @param contribution - the generated `automations` Remote contribution.
 * @returns the disposer that withdraws the panel and the namespace.
 */
export async function mountAutomationUi(ctx: Context, contribution: TypertRemoteContribution): Promise<() => Promise<void>> {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'client-ui-automation: dictionaries')
  const disposeRemote = await ctx.remote.$mount(contribution)
  // The injected scope is the only Context that carries `remote.automations`;
  // reading it from the outer `ctx` fails at first use with "without inject".
  const ui = ctx.inject(['remote.automations', 'slots'], (scope: Context) => {
    scope.slots.inject('conversation.session.header.actions', () => scope.slots.register({
      name: 'conversation.session.header.actions',
      id: 'automation',
      order: 30,
      locale: NS,
      inject: () => ({
        async list() {
          const result = await scope.remote.automations.list()
          if (!result.ok) throw result.error
          return result.value
        },
        async trigger(taskId: string) {
          const result = await scope.remote.automations.trigger(taskId)
          if (!result.ok) throw result.error
          return result.value
        },
        async pause(taskId: string) {
          const result = await scope.remote.automations.pause(taskId)
          if (!result.ok) throw result.error
          return result.value
        },
        async resume(taskId: string) {
          const result = await scope.remote.automations.resume(taskId)
          if (!result.ok) throw result.error
          return result.value
        },
      }),
    }, AutomationAction))
  })
  try {
    await ui
  } catch (error: unknown) {
    await ui.dispose()
    await disposeRemote()
    throw error
  }
  return async () => {
    await ui.dispose()
    await disposeRemote()
  }
}
