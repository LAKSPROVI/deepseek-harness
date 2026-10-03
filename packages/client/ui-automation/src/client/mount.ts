/** Source-safe automation panel registration; the Remote namespace arrives asynchronously. */

import type {} from '@deepseek-ai/dsh-automation/remote'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
import { AutomationAction } from './AutomationAction.tsx'
import { NS, en, zh } from './locales.ts'

/** Required browser services; the automations namespace arrives asynchronously. */
export const inject = ['remote', 'slots', 'locale']

/**
 * Register the dictionaries and the native header panel. The `automations`
 * namespace is mounted by the api-remotes assembly in production and by the
 * test harness or the spec in tests; this file only consumes it through the
 * injected scope, so the source tier never imports the generated Remote
 * artifact and roster-booting specs stay build-free.
 * @param ctx - client root context.
 * @returns the disposer that withdraws the panel and the dictionaries.
 */
export function mountAutomationUi(ctx: Context): () => Promise<void> {
  const disposeLocale = ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'client-ui-automation: dictionaries')
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
  return async () => {
    await ui.dispose()
    await disposeLocale()
  }
}
