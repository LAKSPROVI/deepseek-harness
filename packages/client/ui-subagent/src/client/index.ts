/** Web subagent catalog, navigation, and addressed-session composer owner. */
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type {
  ClientContext, SessionId, SubagentAddress,
} from '@deepseek-ai/dsh-client-runtime/client'
import type {
  ComposerAttachment, ComposerChainProps, ConversationController, DraftAttachmentId,
} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import {
  TEAM_TEMPLATE_SETTINGS_NAMESPACE, type SavedTeamTemplate, type TeamTemplateSettings,
} from '../team-settings.ts'
import { AgentTeamView, type AgentTeamViewInjected, type TeamDraftAttachment } from './AgentTeamView.tsx'
import { createTeamTemplateStore } from './team-store.ts'
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

/** Required services for conversation slots, Team mutations, drafts, settings, and navigation. */
export const inject = [
  'connection', 'sessions', 'slots', 'remote', 'remote.agentTeams', 'locale', 'conversation', 'settingsScope',
]

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
  const connection = ctx.get('connection') as ConnectionHandle
  const conversation = ctx.get('conversation') as ConversationController
  const sessions = ctx.sessions
  const t = ctx.locale.bind(NS)

  const templateScope = ctx.settingsScope.bind<TeamTemplateSettings>({
    namespace: TEAM_TEMPLATE_SETTINGS_NAMESPACE,
  })
  const templateHandle = createTeamTemplateStore()
  const templateStore = templateHandle.create()
  const syncTemplates = (): void => { templateStore.actions.sync(templateScope.getSnapshot()) }
  syncTemplates()
  ctx.effect(() => templateScope.subscribe(syncTemplates), 'ui-subagent: teammate template projection')
  const persistTemplates = async (templates: SavedTeamTemplate[]): Promise<void> => {
    templateStore.actions.beginSave()
    try {
      await templateScope.set('templates', templates)
      syncTemplates()
    } catch {
      templateStore.actions.failSave('Não foi possível salvar os modelos de integrante.')
      throw new Error('teammate template write failed')
    }
  }

  const teamActions = (sessionId: SessionId): AgentTeamViewInjected => ({
    hooks: { teamTemplates: templateStore },
    loadModels: async () => {
      const { result } = await connection.api.sessions.models({ sessionId })
      if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`)
      return result.value
    },
    members: async () => await ctx.remote.agentTeams.members(sessionId),
    spawn: async (request, signal) => await ctx.remote.agentTeams.spawn(sessionId, request, signal),
    guide: async (request, signal) => await ctx.remote.agentTeams.guide(sessionId, request, signal),
    interrupt: async targetName => await ctx.remote.agentTeams.interrupt(sessionId, targetName),
    taskCreate: async request => await ctx.remote.agentTeams.taskCreate(sessionId, request),
    debateStart: async request => await ctx.remote.agentTeams.debateStart(sessionId, request),
    debateContribute: async request => await ctx.remote.agentTeams.debateContribute(sessionId, request),
    debateUpdate: async request => await ctx.remote.agentTeams.debateUpdate(sessionId, request),
    createAttachments: (files): readonly TeamDraftAttachment[] => conversation.createDraftAttachments(files).map(
      (attachment: ComposerAttachment): TeamDraftAttachment => ({
        id: attachment.id,
        kind: attachment.kind,
        name: attachment.file.name || 'arquivo sem nome',
        bytes: attachment.file.size,
        ...(attachment.kind === 'image' ? { previewUrl: attachment.previewUrl } : {}),
      }),
    ),
    serializeAttachments: async (ids, signal) => await conversation.serializeDraftAttachments(sessionId, ids, signal),
    releaseAttachments: (ids: readonly DraftAttachmentId[]) => {
      for (const id of ids) conversation.releaseDraftAttachment(id)
    },
    resolveAttachment: async attachment => await conversation.resolveAttachment(sessionId, attachment),
    saveTemplate: async (template) => {
      await persistTemplates([
        ...templateStore.getSnapshot().templates,
        { ...template, id: crypto.randomUUID() },
      ])
    },
    deleteTemplate: async (id) => {
      await persistTemplates(templateStore.getSnapshot().templates.filter(template => template.id !== id))
    },
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
