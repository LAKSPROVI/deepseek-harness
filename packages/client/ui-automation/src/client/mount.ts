/** Generated Remote mount and slot registration for the automation panel. */

import automationRemote from '@deepseek-ai/dsh-automation/remote'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
import { AutomationAction } from './AutomationAction.tsx'
import { NS, en, zh } from './locales.ts'

/** Required browser services for the generated Remote namespace and header slot. */
export const inject = ['remote', 'slots', 'locale']

/** Mount the optional automations namespace and contribute its native header panel. */
export async function apply(ctx: Context): Promise<() => Promise<void>> {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'client-ui-automation: dictionaries')
  const disposeRemote = await ctx.remote.$mount(automationRemote)
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
