/** Web subagent catalog, navigation, and addressed-session composer owner. */
import type {
  ClientContext, SessionId, SubagentAddress,
} from '@deepseek-ai/dsh-client-runtime/client'
import type { ComposerChainProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import { AgentTeamView, type AgentTeamViewInjected } from './AgentTeamView.tsx'
import { SubagentHeaderLineage, type SubagentCatalogInjected } from './SubagentHeaderLineage.tsx'
import {
  SubagentReadOnlyComposer, type SubagentReadOnlyMatch,
} from './SubagentReadOnlyComposer.tsx'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import { en, NS, zh, type SubagentKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Subagent catalog and read-only composer copy. */
    'subagent': SubagentKey
  }
}

export { AgentTeamView } from './AgentTeamView.tsx'
export type { AgentTeamActions, AgentTeamViewInjected, AgentTeamViewProps } from './AgentTeamView.tsx'
export type {
  SubagentCatalogInjected, SubagentHeaderLineageProps,
} from './SubagentHeaderLineage.tsx'
export type {
  SubagentReadOnlyComposerProps, SubagentReadOnlyMatch,
} from './SubagentReadOnlyComposer.tsx'

/** Required services for conversation slots, Team mutations, and session navigation. */
export const inject = ['sessions', 'slots', 'remote', 'remote.agentTeams', 'locale']

/** Claim the composer for one-shot history or an unavailable continuation owner. */
function selectReadOnlySubagent(owner: ComposerChainProps): SubagentReadOnlyMatch | null {
  const subagent = owner.session?.subagent
  if (subagent === undefined || subagent === null) return null
  if (subagent.address.mode === 'one-shot') return { reason: 'one-shot' }
  if (subagent.parentAvailable) return null
  // A RUNNING parent-offline continuable child keeps the default composer:
  // its input is disabled there, but the same primary Stop stays available so
  // the child can be interrupted. Once it stops, this takeover returns.
  return owner.session?.running === true ? null : { reason: 'parent-unavailable' }
}

/**
 * Client plugin body: register the subagent catalog and read-only composer seats.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-subagent: dictionaries')
  const sessions = ctx.sessions
  const t = ctx.locale.bind(NS)
  const teamActions = (sessionId: SessionId): AgentTeamViewInjected => ({
    members: async () => await ctx.remote.agentTeams.members(sessionId),
    spawn: async (request, signal) => await ctx.remote.agentTeams.spawn(sessionId, request, signal),
    guide: async (request, signal) => await ctx.remote.agentTeams.guide(sessionId, request, signal),
    interrupt: async targetName => await ctx.remote.agentTeams.interrupt(sessionId, targetName),
    debateStart: async request => await ctx.remote.agentTeams.debateStart(sessionId, request),
    debateUpdate: async request => await ctx.remote.agentTeams.debateUpdate(sessionId, request),
  })
  ctx.slots.inject('conversation.view', () => ctx.slots.register({
    name: 'conversation.view',
    id: 'agent-teams',
    order: 20,
    locale: NS,
    label: () => t('view.agentTeams'),
    inject: teamActions,
  }, AgentTeamView))
  const catalogActions = (_parentSessionId: SessionId): SubagentCatalogInjected => ({
    openChild(address: SubagentAddress) {
      sessions.openSubagent(address)
    },
    refresh(parentSessionId: SessionId) {
      void sessions.refreshSubagents(parentSessionId)
    },
    setCatalogOpen(parentSessionId: SessionId, open: boolean) {
      sessions.setSubagentCatalogOpen(parentSessionId, open)
    },
  })
  ctx.slots.inject(
    'conversation.session.header.lineage',
    () => ctx.slots.register({
      name: 'conversation.session.header.lineage',
      locale: NS,
      inject: catalogActions,
    }, SubagentHeaderLineage),
  )
  ctx.slots.inject(
    'conversation.composer',
    () => ctx.slots.register({
      name: 'conversation.composer',
      priority: -10,
      locale: NS,
      select: selectReadOnlySubagent,
    }, SubagentReadOnlyComposer),
  )
}
