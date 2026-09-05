import {
  useCallback, useEffect, useMemo, useRef, useState,
  type FormEvent,
} from 'react'
import type {
  ContributeTeamDebateRemoteRequest,
  GuideTeamMemberRemoteRequest,
  SpawnTeamMemberRemoteRequest,
  StartTeamDebateRemoteRequest,
  TeamDebateContentBlock,
  TeamDebatePhase,
  TeamDebateSnapshot,
  TeamMemberView,
  TeamProjection,
  UpdateTeamDebateRequest,
} from '@deepseek-ai/dsh-agent-team/client'
import type { SessionModels } from '@deepseek-ai/dsh-api-remotes/client'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-runtime/client'
import type { ConvViewProps, DraftAttachmentId } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { InjectFace, PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { SavedTeamTemplate } from '../team-settings.ts'
import { formatAttachmentBytes, normalizeTeamMemberName } from './team-helpers.ts'
import type { TeamTemplateState } from './team-store.ts'
import { NS } from './locales.ts'
import css from './AgentTeamView.module.css'

/** Browser-only attachment descriptor safe for component state. */
export interface TeamDraftAttachment {
  id: DraftAttachmentId
  kind: 'image' | 'file'
  name: string
  bytes: number
  previewUrl?: string
}

/** Browser actions supplied by the ui-subagent registration. */
export interface AgentTeamActions {
  hooks: {
    /** Durable reusable teammate templates projected through Settings. */
    teamTemplates: ObservableSnapshot<TeamTemplateState>
  }
  /** Load the Lead Session's provider-grouped model directory. */
  loadModels: () => Promise<SessionModels>
  /** Read the runtime-enriched roster for the current Team. */
  members: () => Promise<RemoteResult<TeamMemberView[]>>
  /** Create one durable teammate. */
  spawn: (
    request: SpawnTeamMemberRemoteRequest,
    signal?: AbortSignal,
  ) => Promise<RemoteResult<unknown>>
  /** Send one durable guidance message. */
  guide: (
    request: GuideTeamMemberRemoteRequest,
    signal?: AbortSignal,
  ) => Promise<RemoteResult<unknown>>
  /** Interrupt one teammate's active turn without clearing its inbox. */
  interrupt: (
    targetName: string,
  ) => Promise<RemoteResult<{ previousStatus: 'running' | 'idle' | 'inactive' }>>
  /** Start one structured Team debate. */
  debateStart: (
    request: StartTeamDebateRemoteRequest,
  ) => Promise<RemoteResult<TeamDebateSnapshot>>
  /** Append the human Lead's contribution to the current phase. */
  debateContribute: (
    request: ContributeTeamDebateRemoteRequest,
  ) => Promise<RemoteResult<TeamDebateSnapshot>>
  /** Apply one compare-and-set debate transition. */
  debateUpdate: (
    request: UpdateTeamDebateRequest,
  ) => Promise<RemoteResult<TeamDebateSnapshot>>
  /** Register browser-selected files and return display-only descriptors. */
  createAttachments: (files: readonly File[]) => readonly TeamDraftAttachment[]
  /** Encode registered drafts for one Team Remote call. */
  serializeAttachments: (
    ids: readonly DraftAttachmentId[],
    signal?: AbortSignal,
  ) => Promise<NonNullable<SpawnTeamMemberRemoteRequest['attachments']>>
  /** Release registered drafts after success or explicit removal. */
  releaseAttachments: (ids: readonly DraftAttachmentId[]) => void
  /** Resolve one durable debate attachment to a session-authorized URL. */
  resolveAttachment: (
    attachment: Extract<TeamDebateContentBlock, { type: 'image' | 'file' }>['attachment'],
  ) => Promise<string>
  /** Persist the current reusable teammate configuration. */
  saveTemplate: (template: Omit<SavedTeamTemplate, 'id'>) => Promise<void>
  /** Remove one reusable teammate configuration. */
  deleteTemplate: (id: string) => Promise<void>
}

/** Alias used by the slot registration's inject factory. */
export type AgentTeamViewInjected = AgentTeamActions

/** Complete props of the Agent Teams conversation view. */
export type AgentTeamViewProps = ConvViewProps & InjectFace<AgentTeamActions> & PropsLocale<typeof NS>

type PendingAction =
  | 'members'
  | 'spawn'
  | 'guide'
  | `interrupt:${string}`
  | 'debate-start'
  | 'debate-contribute'
  | 'debate-update'
  | 'template-save'
  | `template-delete:${string}`

interface SpawnDraft {
  name: string
  description: string
  prompt: string
  context: 'fresh' | 'fork'
  llmProvider: string
  model: string
  persona: string
}

interface GuideDraft {
  target: string
  content: string
  delivery: 'quiet' | 'wakeup'
}

interface DebateDraft {
  topic: string
  participants: string[]
  maxRounds: string
}

const EMPTY_SPAWN: SpawnDraft = {
  name: '',
  description: '',
  prompt: '',
  context: 'fresh',
  llmProvider: '',
  model: '',
  persona: '',
}

const EMPTY_GUIDE: GuideDraft = { target: '', content: '', delivery: 'wakeup' }
const EMPTY_DEBATE: DebateDraft = { topic: '', participants: [], maxRounds: '3' }

const DEBATE_PHASES: readonly TeamDebatePhase[] = [
  'positions',
  'critique',
  'rebuttal',
  'verification',
  'synthesis',
]

function optionalText(value: string): string | undefined {
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

const MEMBER_STATUS_LABELS: Record<TeamMemberView['status'], string> = {
  running: 'em execução',
  idle: 'ocioso',
  inactive: 'inativo',
  provisioning: 'em criação',
  failed: 'falhou',
}

const MEMBER_ROLE_LABELS: Record<TeamMemberView['role'], string> = {
  lead: 'líder',
  teammate: 'integrante',
}

const MEMBER_CONTEXT_LABELS: Record<NonNullable<TeamMemberView['context']>, string> = {
  fresh: 'contexto novo',
  fork: 'histórico copiado',
}

const TASK_STATUS_LABELS: Record<TeamProjection['tasks'][number]['status'], string> = {
  pending: 'pendente',
  in_progress: 'em andamento',
  completed: 'concluída',
  deleted: 'excluída',
}

const DEBATE_PHASE_LABELS: Record<TeamDebatePhase, string> = {
  positions: 'posições',
  critique: 'crítica',
  rebuttal: 'réplica',
  verification: 'verificação',
  synthesis: 'síntese',
}

const DEBATE_STATUS_LABELS: Record<TeamDebateSnapshot['status'], string> = {
  active: 'ativo',
  paused: 'pausado',
  completed: 'concluído',
}

function resultError(result: RemoteResult<unknown>): string | null {
  return result.ok ? null : `Não foi possível concluir a ação: ${result.error.message} (${result.error.code})`
}

function statusClass(status: TeamMemberView['status']): string {
  switch (status) {
    case 'running': return css.statusRunning ?? ''
    case 'idle': return css.statusIdle ?? ''
    case 'inactive': return css.statusInactive ?? ''
    case 'provisioning': return css.statusProvisioning ?? ''
    case 'failed': return css.statusFailed ?? ''
  }
}

function projectionMembers(
  projection: TeamProjection | null,
  sessionId: AgentTeamViewProps['sessionId'],
): TeamMemberView[] {
  const lead: TeamMemberView = {
    id: sessionId,
    name: 'lead',
    role: 'lead',
    status: 'idle',
    diagnostics: [],
  }
  if (projection === null) return [lead]
  return [
    lead,
    ...projection.members.map((member): TeamMemberView => ({
      id: member.id,
      name: member.name,
      role: 'teammate',
      status: member.phase === 'active' ? 'inactive' : member.phase,
      description: member.description,
      provider: member.provider,
      context: member.context,
      ...member.llmProvider === undefined ? {} : { llmProvider: member.llmProvider },
      ...member.model === undefined ? {} : { model: member.model },
      ...member.persona === undefined ? {} : { persona: member.persona },
      diagnostics: member.error === undefined ? [] : [member.error],
    })),
  ]
}

function fieldId(sessionId: string, name: string): string {
  return `agent-team-${sessionId}-${name}`
}

interface AttachmentInputProps {
  label: string
  attachments: readonly TeamDraftAttachment[]
  disabled: boolean
  onFiles: (files: readonly File[]) => void
  onRemove: (id: DraftAttachmentId) => void
}

function AttachmentInput({ label, attachments, disabled, onFiles, onRemove }: AttachmentInputProps) {
  return (
    <div className={`${css.attachmentInput} ${css.fieldWide}`}>
      <label className={css.attachmentPicker}>
        <span>{label}</span>
        <input
          type="file"
          multiple
          disabled={disabled}
          onChange={(event) => {
            const files = [...(event.target.files ?? [])]
            event.target.value = ''
            if (files.length > 0) onFiles(files)
          }}
        />
      </label>
      {attachments.length > 0 && (
        <div className={css.draftAttachments} role="list" aria-label={`${label}: arquivos selecionados`}>
          {attachments.map(attachment => (
            <div className={css.attachmentCard} role="listitem" key={attachment.id}>
              {attachment.previewUrl === undefined
                ? <span className={css.fileMark} aria-hidden="true">ARQ</span>
                : <img src={attachment.previewUrl} alt="" />}
              <span><strong>{attachment.name}</strong><small>{formatAttachmentBytes(attachment.bytes)}</small></span>
              <button type="button" className={css.textButton} disabled={disabled} onClick={() => { onRemove(attachment.id) }}>Remover</button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

interface DurableBlockProps {
  block: TeamDebateContentBlock
  resolveAttachment: AgentTeamActions['resolveAttachment']
}

function DurableBlock({ block, resolveAttachment }: DurableBlockProps) {
  const [url, setUrl] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    if (block.type === 'text') return
    let active = true
    void resolveAttachment(block.attachment).then((resolved) => {
      if (active) setUrl(resolved)
    }).catch(() => {
      if (active) setFailed(true)
    })
    return () => { active = false }
  }, [block, resolveAttachment])
  if (block.type === 'text') return <p className={css.contributionText}>{block.text}</p>
  const name = block.attachment.name ?? (block.type === 'image' ? 'imagem' : 'arquivo')
  if (failed) return <span className={css.attachmentUnavailable}>{name} · indisponível</span>
  if (block.type === 'image') {
    return url === null
      ? <span className={css.attachmentUnavailable}>{name} · carregando…</span>
      : <a className={css.historicalImage} href={url} target="_blank" rel="noreferrer"><img src={url} alt={name} /><span>{name} · {formatAttachmentBytes(block.attachment.bytes)}</span></a>
  }
  return url === null
    ? <span className={css.attachmentUnavailable}>{name} · preparando download…</span>
    : <a className={css.historicalFile} href={url} download={name}><span className={css.fileMark} aria-hidden="true">ARQ</span><span>{name} · {formatAttachmentBytes(block.attachment.bytes)}</span></a>
}

/** Agent Teams roster, task board, debate protocol, and operator controls. */
export function AgentTeamView({
  sessionId,
  useProjection,
  useSessions,
  loadModels,
  members,
  spawn,
  guide,
  interrupt,
  debateStart,
  debateContribute,
  debateUpdate,
  createAttachments,
  serializeAttachments,
  releaseAttachments,
  resolveAttachment,
  saveTemplate,
  deleteTemplate,
  useTeamTemplates,
}: AgentTeamViewProps) {
  const projection = useProjection('agentTeam')
  const sessions = useSessions(state => state)
  const templateState = useTeamTemplates(state => state)
  const [runtimeMembers, setRuntimeMembers] = useState<TeamMemberView[] | null>(null)
  const [spawnDraft, setSpawnDraft] = useState<SpawnDraft>(EMPTY_SPAWN)
  const [spawnAttachments, setSpawnAttachments] = useState<TeamDraftAttachment[]>([])
  const [guideAttachments, setGuideAttachments] = useState<TeamDraftAttachment[]>([])
  const [debateAttachments, setDebateAttachments] = useState<TeamDraftAttachment[]>([])
  const [contributionAttachments, setContributionAttachments] = useState<TeamDraftAttachment[]>([])
  const [contributionText, setContributionText] = useState('')
  const [templateTitle, setTemplateTitle] = useState('')
  const [sideTab, setSideTab] = useState<'spawn' | 'guide'>('spawn')
  const [modelDirectory, setModelDirectory] = useState<SessionModels | null>(null)
  const [modelDirectoryStatus, setModelDirectoryStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [modelDirectoryError, setModelDirectoryError] = useState<string | null>(null)
  const [guideDraft, setGuideDraft] = useState<GuideDraft>(EMPTY_GUIDE)
  const [debateDraft, setDebateDraft] = useState<DebateDraft>(EMPTY_DEBATE)
  const [debateNote, setDebateNote] = useState('')
  const [pending, setPending] = useState<PendingAction | null>(null)
  const [error, setError] = useState<string | null>(null)
  const pendingRef = useRef<PendingAction | null>(null)
  const attachmentIdsRef = useRef(new Set<DraftAttachmentId>())

  useEffect(() => () => {
    releaseAttachments([...attachmentIdsRef.current])
    attachmentIdsRef.current.clear()
  }, [releaseAttachments])

  const addAttachments = useCallback((
    files: readonly File[],
    setter: (update: (current: TeamDraftAttachment[]) => TeamDraftAttachment[]) => void,
  ) => {
    const created = [...createAttachments(files)]
    for (const attachment of created) attachmentIdsRef.current.add(attachment.id)
    setter(current => [...current, ...created])
  }, [createAttachments])

  const removeAttachment = useCallback((
    id: DraftAttachmentId,
    setter: (update: (current: TeamDraftAttachment[]) => TeamDraftAttachment[]) => void,
  ) => {
    releaseAttachments([id])
    attachmentIdsRef.current.delete(id)
    setter(current => current.filter(attachment => attachment.id !== id))
  }, [releaseAttachments])

  const releaseSubmitted = useCallback((attachments: readonly TeamDraftAttachment[]) => {
    const ids = attachments.map(attachment => attachment.id)
    releaseAttachments(ids)
    for (const id of ids) attachmentIdsRef.current.delete(id)
  }, [releaseAttachments])

  const refreshModelDirectory = useCallback(async () => {
    setModelDirectoryStatus('loading')
    setModelDirectoryError(null)
    try {
      const directory = await loadModels()
      setModelDirectory(directory)
      setModelDirectoryStatus('ready')
    } catch (cause: unknown) {
      setModelDirectoryStatus('error')
      setModelDirectoryError(cause instanceof Error ? cause.message : 'Não foi possível carregar providers e modelos.')
    }
  }, [loadModels])

  const teamEnabled = projection !== undefined
  useEffect(() => {
    if (!teamEnabled) return
    void refreshModelDirectory()
  }, [refreshModelDirectory, teamEnabled])

  const refreshMembers = useCallback(async (showPending = false) => {
    if (showPending && pendingRef.current !== null) return false
    if (showPending) {
      pendingRef.current = 'members'
      setPending('members')
      setError(null)
    }
    try {
      const result = await members()
      if (!result.ok) {
        if (showPending) setError(resultError(result))
        return false
      }
      setRuntimeMembers(result.value)
      return true
    } catch (cause: unknown) {
      if (showPending) setError(cause instanceof Error ? `Não foi possível carregar os integrantes: ${cause.message}` : 'Não foi possível carregar os integrantes da equipe.')
      return false
    } finally {
      if (showPending) {
        pendingRef.current = null
        setPending(null)
      }
    }
  }, [members])

  useEffect(() => {
    if (projection === undefined) return
    let active = true
    void members().then((result) => {
      if (active && result.ok) setRuntimeMembers(result.value)
    }).catch(() => {
      // The durable projection remains usable when the optional live refresh fails.
    })
    return () => { active = false }
  }, [members, projection])

  const runAction = useCallback(async <T,>(
    key: PendingAction,
    action: () => Promise<RemoteResult<T>>,
  ): Promise<RemoteResult<T> | undefined> => {
    if (pendingRef.current !== null) return undefined
    pendingRef.current = key
    setPending(key)
    setError(null)
    try {
      const result = await action()
      const message = resultError(result)
      if (message !== null) setError(message)
      return result
    } catch (cause: unknown) {
      setError(cause instanceof Error ? `A ação da equipe falhou: ${cause.message}` : 'A ação da equipe de agentes falhou.')
      return undefined
    } finally {
      pendingRef.current = null
      setPending(null)
    }
  }, [])

  const fallbackMembers = useMemo(
    () => projectionMembers(projection ?? null, sessionId),
    [projection, sessionId],
  )
  const roster = useMemo(() => {
    const source = runtimeMembers ?? fallbackMembers
    return source.slice(0, 10).map((member): TeamMemberView => {
      if (member.status === 'failed' || member.status === 'provisioning') return member
      const summary = sessions.byId[member.id]
      if (summary?.running === true) return { ...member, status: 'running' }
      if (summary !== undefined && member.status !== 'inactive') return { ...member, status: 'idle' }
      return member
    })
  }, [fallbackMembers, runtimeMembers, sessions.byId])

  const teammateNames = useMemo(
    () => roster.filter(member => member.role === 'teammate' && member.status !== 'failed').map(member => member.name),
    [roster],
  )
  const memberNameById = useMemo(
    () => new Map(roster.map(member => [member.id, member.name] as const)),
    [roster],
  )

  useEffect(() => {
    if (guideDraft.target === '' && teammateNames[0] !== undefined) {
      setGuideDraft(current => ({ ...current, target: teammateNames[0] ?? '' }))
    }
  }, [guideDraft.target, teammateNames])

  const handleSpawn = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const name = normalizeTeamMemberName(spawnDraft.name)
    if (name === '' || name === 'lead') {
      setError('Informe um nome que gere um identificador válido e diferente de lead.')
      return
    }
    if (roster.some(member => member.name === name)) {
      setError(`O identificador ${name} já pertence a um integrante e não pode ser reutilizado.`)
      return
    }
    const llmProvider = optionalText(spawnDraft.llmProvider)
    const model = optionalText(spawnDraft.model)
    if (llmProvider !== undefined) {
      const provider = modelDirectory?.groups.find(group => group.id === llmProvider)
      if (model === undefined || provider?.models.some(candidate => candidate.id === model) !== true) {
        setError('Selecione um modelo válido para o provider escolhido.')
        return
      }
    }
    const controller = new AbortController()
    const result = await runAction('spawn', async () => {
      const attachments = await serializeAttachments(spawnAttachments.map(item => item.id), controller.signal)
      const persona = optionalText(spawnDraft.persona)
      const request: SpawnTeamMemberRemoteRequest = {
        name,
        description: spawnDraft.description.trim(),
        prompt: spawnDraft.prompt.trim(),
        context: spawnDraft.context,
        ...(attachments.length === 0 ? {} : { attachments }),
        ...llmProvider === undefined || model === undefined ? {} : { llmProvider, model },
        ...persona === undefined ? {} : { persona },
      }
      return await spawn(request, controller.signal)
    })
    if (result?.ok) {
      releaseSubmitted(spawnAttachments)
      setSpawnAttachments([])
      setSpawnDraft(EMPTY_SPAWN)
      setTemplateTitle('')
      await refreshMembers()
    }
  }

  const handleGuide = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const controller = new AbortController()
    const result = await runAction('guide', async () => {
      const attachments = await serializeAttachments(guideAttachments.map(item => item.id), controller.signal)
      const request: GuideTeamMemberRemoteRequest = {
        target: guideDraft.target,
        content: guideDraft.content.trim(),
        delivery: guideDraft.delivery,
        ...(attachments.length === 0 ? {} : { attachments }),
      }
      return await guide(request, controller.signal)
    })
    if (result?.ok) {
      releaseSubmitted(guideAttachments)
      setGuideAttachments([])
      setGuideDraft(current => ({ ...current, content: '' }))
    }
  }

  const handleInterrupt = async (targetName: string) => {
    const result = await runAction(`interrupt:${targetName}`, () => interrupt(targetName))
    if (result?.ok) await refreshMembers()
  }

  const handleDebateStart = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const maxRounds = Number(debateDraft.maxRounds)
    const result = await runAction('debate-start', async () => {
      const attachments = await serializeAttachments(debateAttachments.map(item => item.id))
      const request: StartTeamDebateRemoteRequest = {
        topic: debateDraft.topic.trim(),
        participants: ['lead', ...debateDraft.participants],
        ...(attachments.length === 0 ? {} : { attachments }),
        ...(Number.isSafeInteger(maxRounds) && maxRounds > 0 ? { maxRounds } : {}),
      }
      return await debateStart(request)
    })
    if (result?.ok) {
      releaseSubmitted(debateAttachments)
      setDebateAttachments([])
      setDebateDraft(EMPTY_DEBATE)
    }
  }

  const handleDebateContribute = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const debate = projection?.debate
    if (debate === null || debate === undefined) return
    const result = await runAction('debate-contribute', async () => {
      const attachments = await serializeAttachments(contributionAttachments.map(item => item.id))
      return await debateContribute({
        debateId: debate.id,
        expectedRevision: debate.revision,
        content: contributionText.trim(),
        ...(attachments.length === 0 ? {} : { attachments }),
      })
    })
    if (result?.ok) {
      releaseSubmitted(contributionAttachments)
      setContributionAttachments([])
      setContributionText('')
    }
  }

  const handleDebateUpdate = async (action: UpdateTeamDebateRequest['action']) => {
    const debate = projection?.debate
    if (debate === null || debate === undefined) return
    const note = optionalText(debateNote)
    const request: UpdateTeamDebateRequest = {
      debateId: debate.id,
      expectedRevision: debate.revision,
      action,
      ...note === undefined ? {} : { note },
    }
    const result = await runAction('debate-update', () => debateUpdate(request))
    if (result?.ok) setDebateNote('')
  }

  const applyTemplate = (template: SavedTeamTemplate) => {
    setSpawnDraft({
      name: template.name,
      description: template.description,
      prompt: template.prompt,
      context: template.context,
      llmProvider: template.llmProvider ?? '',
      model: template.model ?? '',
      persona: template.persona ?? '',
    })
    setTemplateTitle(template.title)
  }

  const handleSaveTemplate = async () => {
    if (pendingRef.current !== null || templateTitle.trim() === '') return
    pendingRef.current = 'template-save'
    setPending('template-save')
    setError(null)
    try {
      const llmProvider = optionalText(spawnDraft.llmProvider)
      const model = optionalText(spawnDraft.model)
      await saveTemplate({
        title: templateTitle.trim(),
        name: spawnDraft.name.trim(),
        description: spawnDraft.description.trim(),
        prompt: spawnDraft.prompt.trim(),
        context: spawnDraft.context,
        ...llmProvider === undefined || model === undefined ? {} : { llmProvider, model },
        ...optionalText(spawnDraft.persona) === undefined ? {} : { persona: spawnDraft.persona.trim() },
      })
    } catch (cause: unknown) {
      setError(cause instanceof Error ? `Não foi possível salvar o modelo: ${cause.message}` : 'Não foi possível salvar o modelo de integrante.')
    } finally {
      pendingRef.current = null
      setPending(null)
    }
  }

  const handleDeleteTemplate = async (id: string) => {
    const key = `template-delete:${id}` as const
    if (pendingRef.current !== null) return
    pendingRef.current = key
    setPending(key)
    setError(null)
    try {
      await deleteTemplate(id)
    } catch (cause: unknown) {
      setError(cause instanceof Error ? `Não foi possível excluir o modelo: ${cause.message}` : 'Não foi possível excluir o modelo de integrante.')
    } finally {
      pendingRef.current = null
      setPending(null)
    }
  }

  if (projection === undefined) {
    return (
      <div className={css.root} data-agent-team-view>
        <section className={css.empty} aria-labelledby={fieldId(sessionId, 'empty-title')}>
          <span className={css.emptyMark} aria-hidden="true">EA</span>
          <div>
            <h2 id={fieldId(sessionId, 'empty-title')}>Equipe de agentes não habilitada</h2>
            <p>Habilite o recurso Agent Teams nesta sessão para coordenar integrantes, tarefas e debates.</p>
          </div>
        </section>
      </div>
    )
  }

  const tasks = (projection?.tasks ?? []).filter(task => task.status !== 'deleted')
  const debate = projection?.debate ?? null
  const activeCount = roster.filter(member => member.status === 'running').length
  const openTaskCount = tasks.filter(task => task.status !== 'completed').length
  const selectedProvider = modelDirectory?.groups.find(group => group.id === spawnDraft.llmProvider)
  const explicitRouteComplete = spawnDraft.llmProvider === '' || (
    selectedProvider !== undefined
    && selectedProvider.models.some(model => model.id === spawnDraft.model)
  )
  const formsDisabled = pending !== null
  const canSpawn = roster.length < 10
  const normalizedSpawnName = normalizeTeamMemberName(spawnDraft.name)
  const currentAuthors = new Set(debate?.contributions
    .filter(item => item.round === debate.round && item.phase === debate.phase)
    .map(item => item.author) ?? [])
  const missingParticipants = debate?.participants.filter(name => !currentAuthors.has(name)) ?? []
  const leadCanContribute = debate !== null && debate.status === 'active'
    && debate.participants.includes('lead') && !currentAuthors.has('lead')
  const phaseComplete = debate !== null && missingParticipants.length === 0

  return (
    <div className={css.root} data-agent-team-view>
      <header className={css.hero}>
        <div>
          <p className={css.eyebrow}>Equipe de agentes</p>
          <h2>Coordene a equipe</h2>
          <p className={css.heroCopy}>Acompanhe até dez agentes, oriente o trabalho persistente e conduza um debate estruturado.</p>
        </div>
        <dl className={css.metrics} aria-label="Resumo da equipe">
          <div><dt>Integrantes</dt><dd>{roster.length}/10</dd></div>
          <div><dt>Em execução</dt><dd>{activeCount}</dd></div>
          <div><dt>Tarefas abertas</dt><dd>{openTaskCount}</dd></div>
        </dl>
      </header>

      {projection === null && (
        <div className={css.optInNotice}>
          Ainda não há atividade persistida. Crie o primeiro integrante ou inicie um debate para ativar esta sessão.
        </div>
      )}

      {error !== null && (
        <div className={css.error} role="alert">
          <span>{error}</span>
          <button type="button" className={css.textButton} onClick={() => { setError(null) }}>Fechar</button>
        </div>
      )}

      <div className={css.layout}>
        <main className={css.mainColumn}>
          <section className={css.panel} aria-labelledby={fieldId(sessionId, 'roster-title')}>
            <div className={css.sectionHeader}>
              <div>
                <p className={css.sectionKicker}>Equipe em tempo real</p>
                <h3 id={fieldId(sessionId, 'roster-title')}>Integrantes</h3>
              </div>
              <button
                type="button"
                className={css.secondaryButton}
                disabled={formsDisabled}
                onClick={() => { void refreshMembers(true) }}
              >
                {pending === 'members' ? 'Atualizando…' : 'Atualizar status'}
              </button>
            </div>
            <div className={css.roster} role="list" aria-label="Integrantes da equipe de agentes">
              {roster.map(member => (
                <article className={css.memberCard} role="listitem" key={member.id}>
                  <div className={css.memberIdentity}>
                    <span className={`${css.statusDot} ${statusClass(member.status)}`} aria-hidden="true" />
                    <div className={css.memberCopy}>
                      <div className={css.memberTitleRow}>
                        <strong>{member.name}</strong>
                        <span className={css.roleBadge}>{MEMBER_ROLE_LABELS[member.role]}</span>
                        {member.persona !== undefined && (
                          <span className={css.personaBadge} title={member.persona}>Persona</span>
                        )}
                      </div>
                      <p>{member.description ?? (member.role === 'lead' ? 'Coordena a equipe' : 'Sem descrição')}</p>
                    </div>
                  </div>
                  <div className={css.memberFacts}>
                    <span className={css.statusLabel}>{MEMBER_STATUS_LABELS[member.status]}</span>
                    <span title="Transporte do subagente">{member.provider ?? 'host'}</span>
                    <span title="Provider e modelo de LLM">
                      {[member.llmProvider, member.model].filter(Boolean).join(' / ') || 'Modelo herdado'}
                    </span>
                    {member.context !== undefined && <span>{MEMBER_CONTEXT_LABELS[member.context]}</span>}
                  </div>
                  {member.diagnostics.length > 0 && (
                    <p className={css.diagnostic}>{member.diagnostics.join(' · ')}</p>
                  )}
                  {member.role === 'teammate' && (
                    <div className={css.memberActions}>
                      <button
                        type="button"
                        className={css.dangerButton}
                        disabled={formsDisabled || member.status !== 'running'}
                        onClick={() => { void handleInterrupt(member.name) }}
                        aria-label={`Interromper a tarefa atual de ${member.name}`}
                      >
                        {pending === `interrupt:${member.name}` ? 'Interrompendo…' : 'Interromper tarefa'}
                      </button>
                    </div>
                  )}
                </article>
              ))}
            </div>
          </section>

          <section className={css.panel} aria-labelledby={fieldId(sessionId, 'tasks-title')}>
            <div className={css.sectionHeader}>
              <div>
                <p className={css.sectionKicker}>Fluxo persistente de tarefas</p>
                <h3 id={fieldId(sessionId, 'tasks-title')}>Tarefas</h3>
              </div>
              <span className={css.countBadge}>{tasks.length}</span>
            </div>
            {tasks.length === 0 ? (
              <p className={css.emptyCopy}>Nenhuma tarefa da equipe foi registrada.</p>
            ) : (
              <div className={css.taskList}>
                {tasks.map(task => (
                  <article className={css.taskCard} key={task.id}>
                    <div className={css.taskHeader}>
                      <strong>{task.subject}</strong>
                      <span className={`${css.taskStatus} ${css[`task_${task.status}`]}`}>{TASK_STATUS_LABELS[task.status]}</span>
                    </div>
                    {task.description !== '' && <p>{task.description}</p>}
                    <dl className={css.taskFacts}>
                      <div><dt>Responsável</dt><dd>{task.ownerId === undefined ? 'Não atribuída' : memberNameById.get(task.ownerId) ?? task.ownerId}</dd></div>
                      <div><dt>Revisão</dt><dd>{task.revision}</dd></div>
                      <div><dt>Bloqueada por</dt><dd>{task.blockedBy.length === 0 ? 'Nenhuma' : task.blockedBy.join(', ')}</dd></div>
                    </dl>
                    {task.writeScopes.length > 0 && (
                      <div className={css.scopeList} aria-label="Escopos de escrita recomendados">
                        {task.writeScopes.map(scope => <code key={scope}>{scope}</code>)}
                      </div>
                    )}
                  </article>
                ))}
              </div>
            )}
          </section>

          <section className={css.panel} aria-labelledby={fieldId(sessionId, 'debate-title')}>
            <div className={css.sectionHeader}>
              <div>
                <p className={css.sectionKicker}>Deliberação estruturada</p>
                <h3 id={fieldId(sessionId, 'debate-title')}>Debate</h3>
              </div>
              {debate !== null && <span className={css.countBadge}>Rodada {debate.round}/{debate.maxRounds}</span>}
            </div>

            {debate === null ? (
              <form className={css.form} onSubmit={(event) => { void handleDebateStart(event) }}>
                <label className={css.fieldWide}>
                  <span>Tema</span>
                  <textarea
                    value={debateDraft.topic}
                    onChange={(event) => { setDebateDraft(current => ({ ...current, topic: event.target.value })) }}
                    rows={3}
                    required
                    placeholder="Descreva a decisão ou pergunta que a equipe deve debater."
                  />
                </label>
                <fieldset className={css.participants}>
                  <legend>Participantes</legend>
                  <label>
                    <input type="checkbox" checked disabled />
                    <span>líder</span>
                  </label>
                  {teammateNames.length === 0 ? (
                    <p>Crie ao menos um integrante antes de iniciar o debate.</p>
                  ) : teammateNames.map(name => (
                    <label key={name}>
                      <input
                        type="checkbox"
                        checked={debateDraft.participants.includes(name)}
                        onChange={(event) => {
                          setDebateDraft(current => ({
                            ...current,
                            participants: event.target.checked
                              ? [...current.participants, name]
                              : current.participants.filter(candidate => candidate !== name),
                          }))
                        }}
                      />
                      <span>{name}</span>
                    </label>
                  ))}
                </fieldset>
                <label className={css.compactField}>
                  <span>Máximo de rodadas</span>
                  <input
                    type="number"
                    min={1}
                    step={1}
                    value={debateDraft.maxRounds}
                    onChange={(event) => { setDebateDraft(current => ({ ...current, maxRounds: event.target.value })) }}
                    required
                  />
                </label>
                <AttachmentInput
                  label="Evidências iniciais"
                  attachments={debateAttachments}
                  disabled={formsDisabled}
                  onFiles={(files) => { addAttachments(files, setDebateAttachments) }}
                  onRemove={(id) => { removeAttachment(id, setDebateAttachments) }}
                />
                <div className={css.formActions}>
                  <button
                    type="submit"
                    className={css.primaryButton}
                    disabled={formsDisabled || debateDraft.topic.trim() === '' || debateDraft.participants.length === 0}
                  >
                    {pending === 'debate-start' ? 'Iniciando…' : 'Iniciar debate'}
                  </button>
                </div>
              </form>
            ) : (
              <div className={css.debate}>
                <div className={css.debateSummary}>
                  <div>
                    <span className={`${css.debateStatus} ${css[`debate_${debate.status}`]}`}>{DEBATE_STATUS_LABELS[debate.status]}</span>
                    <strong>{debate.topic}</strong>
                  </div>
                  <p>{debate.participants.join(', ')}</p>
                </div>
                <ol className={css.phaseTimeline} aria-label="Fases do debate">
                  {DEBATE_PHASES.map((phase, index) => {
                    const currentIndex = DEBATE_PHASES.indexOf(debate.phase)
                    const state = index < currentIndex ? 'done' : index === currentIndex ? 'current' : 'upcoming'
                    return (
                      <li className={css[`phase_${state}`]} key={phase} aria-current={state === 'current' ? 'step' : undefined}>
                        <span>{index + 1}</span>
                        <strong>{DEBATE_PHASE_LABELS[phase]}</strong>
                      </li>
                    )
                  })}
                </ol>
                <div className={`${css.readiness} ${phaseComplete ? css.readinessComplete : ''}`} role="status">
                  <strong>{phaseComplete ? 'Pronto para avançar' : 'Aguardando contribuições'}</strong>
                  <span>{phaseComplete ? 'Todos os participantes registraram sua fala nesta etapa.' : `Faltam: ${missingParticipants.join(', ')}`}</span>
                </div>
                {debate.evidence.length > 0 && (
                  <section className={css.evidence} aria-label="Evidências iniciais do debate">
                    <h4>Evidências iniciais</h4>
                    <div className={css.contentBlocks}>
                      {debate.evidence.map((block, index) => <DurableBlock block={block} resolveAttachment={resolveAttachment} key={`evidence-${String(index)}`} />)}
                    </div>
                  </section>
                )}
                <section className={css.transcript} aria-labelledby={fieldId(sessionId, 'transcript-title')}>
                  <div className={css.transcriptHeader}>
                    <h4 id={fieldId(sessionId, 'transcript-title')}>Transcrição do debate</h4>
                    <span>{debate.contributions.length} contribuições</span>
                  </div>
                  {debate.contributions.length === 0 ? (
                    <p className={css.emptyCopy}>Nenhuma contribuição registrada ainda.</p>
                  ) : (
                    <ol className={css.contributionList}>
                      {debate.contributions.map(contribution => (
                        <li key={contribution.sequence}>
                          <header>
                            <strong>{contribution.author}</strong>
                            <span>Rodada {contribution.round} · {DEBATE_PHASE_LABELS[contribution.phase]}</span>
                            <time dateTime={new Date(contribution.createdAt).toISOString()}>{new Date(contribution.createdAt).toLocaleString('pt-BR')}</time>
                          </header>
                          <div className={css.contentBlocks}>
                            {contribution.content.map((block, index) => <DurableBlock block={block} resolveAttachment={resolveAttachment} key={`${String(contribution.sequence)}-${String(index)}`} />)}
                          </div>
                        </li>
                      ))}
                    </ol>
                  )}
                </section>
                {leadCanContribute && (
                  <form className={css.contributionForm} onSubmit={(event) => { void handleDebateContribute(event) }}>
                    <label className={css.fieldWide}>
                      <span>Contribuição da líder</span>
                      <textarea value={contributionText} onChange={(event) => { setContributionText(event.target.value) }} rows={4} placeholder={`Registre uma contribuição consolidada para ${DEBATE_PHASE_LABELS[debate.phase]}.`} />
                    </label>
                    <AttachmentInput
                      label="Anexos da contribuição"
                      attachments={contributionAttachments}
                      disabled={formsDisabled}
                      onFiles={(files) => { addAttachments(files, setContributionAttachments) }}
                      onRemove={(id) => { removeAttachment(id, setContributionAttachments) }}
                    />
                    <div className={css.formActions}>
                      <button type="submit" className={css.primaryButton} disabled={formsDisabled || (contributionText.trim() === '' && contributionAttachments.length === 0)}>
                        {pending === 'debate-contribute' ? 'Registrando…' : 'Registrar contribuição'}
                      </button>
                    </div>
                  </form>
                )}
                {debate.history.length > 0 && (
                  <ol className={css.transitionList} aria-label="Histórico de transições do debate">
                    {debate.history.map(transition => (
                      <li key={transition.revision}>
                        <span>R{transition.round} · {DEBATE_PHASE_LABELS[transition.phase]}</span>
                        <strong>{transition.actor}</strong>
                        <span>{DEBATE_STATUS_LABELS[transition.status]}</span>
                        {transition.note !== undefined && <p>{transition.note}</p>}
                      </li>
                    ))}
                  </ol>
                )}
                {debate.status !== 'completed' && (
                  <div className={css.debateControls}>
                    <label className={css.fieldWide}>
                      <span>Nota da transição <em>opcional</em></span>
                      <input
                        type="text"
                        value={debateNote}
                        onChange={(event) => { setDebateNote(event.target.value) }}
                        placeholder="Registre por que o protocolo está mudando."
                      />
                    </label>
                    <div className={css.buttonRow}>
                      {debate.status === 'active' ? (
                        <button type="button" className={css.secondaryButton} disabled={formsDisabled} onClick={() => { void handleDebateUpdate('pause') }}>Pausar protocolo</button>
                      ) : (
                        <button type="button" className={css.secondaryButton} disabled={formsDisabled} onClick={() => { void handleDebateUpdate('resume') }}>Retomar protocolo</button>
                      )}
                      <button type="button" className={css.primaryButton} disabled={formsDisabled || debate.status !== 'active' || !phaseComplete} onClick={() => { void handleDebateUpdate('advance') }}>Avançar fase</button>
                      <button type="button" className={css.dangerButton} disabled={formsDisabled || debate.status !== 'active' || debate.phase !== 'synthesis' || !phaseComplete} onClick={() => { void handleDebateUpdate('complete') }}>Concluir debate</button>
                    </div>
                    <p className={css.protocolNote}>
                      Pausar impede o avanço do protocolo, mas não cancela tarefas que já estão em execução.
                    </p>
                  </div>
                )}
              </div>
            )}
          </section>
        </main>

        <aside className={css.sideColumn} aria-label="Controles da equipe">
          <div className={css.sideTabs} role="tablist" aria-label="Ações de integrantes">
            <button
              type="button"
              role="tab"
              aria-selected={sideTab === 'spawn'}
              className={`${css.sideTab} ${sideTab === 'spawn' ? css.sideTabActive : ''}`}
              onClick={() => { setSideTab('spawn') }}
            >
              <span>Novo integrante</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={sideTab === 'guide'}
              className={`${css.sideTab} ${sideTab === 'guide' ? css.sideTabActive : ''}`}
              onClick={() => { setSideTab('guide') }}
            >
              <span>Orientar integrante</span>
              {teammateNames.length > 0 && <span className={css.tabBadge}>{teammateNames.length}</span>}
            </button>
          </div>

          <section
            className={`${css.panel} ${sideTab !== 'spawn' ? css.sidePanelHidden : ''}`}
            aria-labelledby={fieldId(sessionId, 'spawn-title')}
          >
            <div className={css.sectionHeader}>
              <div>
                <p className={css.sectionKicker}>Adicionar integrante</p>
                <h3 id={fieldId(sessionId, 'spawn-title')}>Criar integrante</h3>
              </div>
            </div>
            {!canSpawn ? (
              <p className={css.emptyCopy}>O limite de dez agentes foi atingido.</p>
            ) : (
              <form className={css.form} onSubmit={(event) => { void handleSpawn(event) }}>
                <div className={`${css.templateLibrary} ${css.fieldWide}`}>
                  <div className={css.templateHeader}>
                    <div className={css.templateTitleRow}>
                      <span className={css.templateTitle}>Modelos de integrante</span>
                      <span className={css.templateBadge}>{templateState.templates.length}/50</span>
                    </div>
                    <small className={css.templateSub}>Clique para preencher o formulário</small>
                  </div>
                  {templateState.templates.length === 0 ? (
                    <div className={css.templateEmpty}>
                      <p className={css.emptyCopy}>
                        Nenhum modelo salvo. Preencha o formulário e salve para reutilizar em qualquer sessão.
                      </p>
                    </div>
                  ) : (
                    <div className={css.templateList} role="list">
                      {templateState.templates.map((template) => {
                        const isSelected = template.name === spawnDraft.name && template.description === spawnDraft.description
                        return (
                          <div
                            className={`${css.templateCard} ${isSelected ? css.templateCardActive : ''}`}
                            role="listitem"
                            key={template.id}
                          >
                            <button
                              type="button"
                              className={css.templateButton}
                              disabled={formsDisabled}
                              onClick={() => { applyTemplate(template) }}
                              title={`${template.title} — ${template.description}`}
                            >
                              <strong className={css.templateButtonTitle}>{template.title}</strong>
                              <span className={css.templateButtonMeta}>
                                <code>{template.name}</code>
                                {template.model !== undefined && <span className={css.templateModelBadge}>{template.model}</span>}
                              </span>
                            </button>
                            <button
                              type="button"
                              className={css.templateDeleteButton}
                              disabled={formsDisabled}
                              aria-label={`Excluir modelo ${template.title}`}
                              onClick={() => { void handleDeleteTemplate(template.id) }}
                              title="Excluir este modelo"
                            >
                              ✕
                            </button>
                          </div>
                        )
                      })}
                    </div>
                  )}
                  {templateState.error !== null && <p className={css.templateError}>{templateState.error}</p>}
                </div>
                <div className={css.formGroup}>
                  <label htmlFor={fieldId(sessionId, 'spawn-name')}>
                    <span>Nome</span>
                  </label>
                  <input
                    id={fieldId(sessionId, 'spawn-name')}
                    value={spawnDraft.name}
                    onChange={(event) => { setSpawnDraft(current => ({ ...current, name: event.target.value })) }}
                    required
                    placeholder="Pesquisador jurídico"
                  />
                  <small className={css.fieldHint}>ID técnico: <code>{normalizedSpawnName || '—'}</code></small>
                </div>
                <label>
                  <span>Descrição</span>
                  <input value={spawnDraft.description} onChange={(event) => { setSpawnDraft(current => ({ ...current, description: event.target.value })) }} required placeholder="Investiga restrições e riscos" />
                </label>
                <label className={css.fieldWide}>
                  <span>Instrução inicial</span>
                  <textarea
                    value={spawnDraft.prompt}
                    onChange={(event) => {
                      setSpawnDraft(current => ({ ...current, prompt: event.target.value }))
                    }}
                    required
                    rows={4}
                    placeholder="Defina o objetivo, a entrega esperada e as evidências necessárias."
                  />
                </label>
                <AttachmentInput
                  label="Imagens e arquivos da instrução"
                  attachments={spawnAttachments}
                  disabled={formsDisabled}
                  onFiles={(files) => { addAttachments(files, setSpawnAttachments) }}
                  onRemove={(id) => { removeAttachment(id, setSpawnAttachments) }}
                />

                <details className={`${css.advancedDetails} ${css.fieldWide}`} open>
                  <summary className={css.advancedSummary}>
                    <span>Opções avançadas (LLM, Persona, Contexto)</span>
                  </summary>
                  <div className={css.advancedGrid}>
                    <label>
                      <span>Contexto</span>
                      <select value={spawnDraft.context} onChange={(event) => { setSpawnDraft(current => ({ ...current, context: event.target.value as SpawnDraft['context'] })) }}>
                        <option value="fresh">Começar sem histórico</option>
                        <option value="fork">Copiar histórico concluído</option>
                      </select>
                    </label>
                    <label>
                      <span>Provider de LLM <em>opcional</em></span>
                      <select
                        value={spawnDraft.llmProvider}
                        disabled={modelDirectoryStatus === 'loading'}
                        onChange={(event) => {
                          setSpawnDraft(current => ({ ...current, llmProvider: event.target.value, model: '' }))
                        }}
                      >
                        <option value="">Herdar provider e modelo da líder</option>
                        {modelDirectory?.groups.map(group => (
                          <option value={group.id} key={group.id}>{group.name}</option>
                        ))}
                      </select>
                    </label>
                    <label>
                      <span>Modelo <em>obrigatório com provider</em></span>
                      <select
                        value={spawnDraft.model}
                        disabled={modelDirectoryStatus === 'loading' || spawnDraft.llmProvider === ''}
                        onChange={(event) => { setSpawnDraft(current => ({ ...current, model: event.target.value })) }}
                      >
                        <option value="">{spawnDraft.llmProvider === '' ? 'Herdado com o provider' : 'Selecione um modelo'}</option>
                        {selectedProvider?.models.map(model => (
                          <option value={model.id} key={model.id}>{model.name}</option>
                        ))}
                      </select>
                    </label>
                    {(modelDirectoryError !== null || (modelDirectory?.failures.length ?? 0) > 0) && (
                      <div className={`${css.routeNotice} ${css.fieldWide}`} role="status">
                        <span>
                          {modelDirectoryError === null
                            ? `${String(modelDirectory?.failures.length ?? 0)} provider(s) não puderam carregar; os demais continuam disponíveis.`
                            : `Catálogo indisponível: ${modelDirectoryError} A herança da rota da líder continua disponível.`}
                        </span>
                        <button type="button" className={css.textButton} onClick={() => { void refreshModelDirectory() }}>Tentar novamente</button>
                      </div>
                    )}
                    <label className={css.fieldWide}>
                      <span>Persona <em>opcional</em></span>
                      <textarea value={spawnDraft.persona} onChange={(event) => { setSpawnDraft(current => ({ ...current, persona: event.target.value })) }} rows={3} placeholder="Instrução de sistema adicional para este integrante" />
                    </label>
                  </div>
                </details>

                <div className={`${css.templateSave} ${css.fieldWide}`}>
                  <label>
                    <span>Nome do modelo reutilizável</span>
                    <input value={templateTitle} onChange={(event) => { setTemplateTitle(event.target.value) }} placeholder="Ex.: Pesquisador jurídico completo" />
                  </label>
                  <button type="button" className={css.secondaryButton} disabled={formsDisabled || !templateState.writable || templateTitle.trim() === '' || spawnDraft.name.trim() === '' || spawnDraft.description.trim() === '' || spawnDraft.prompt.trim() === '' || !explicitRouteComplete} onClick={() => { void handleSaveTemplate() }}>
                    {pending === 'template-save' ? 'Salvando…' : 'Salvar modelo'}
                  </button>
                </div>
                <div className={css.formActions}>
                  <button type="submit" className={css.primaryButton} disabled={formsDisabled || !canSpawn || !explicitRouteComplete || normalizedSpawnName === '' || normalizedSpawnName === 'lead'}>
                    {pending === 'spawn' ? 'Criando…' : 'Criar integrante'}
                  </button>
                </div>
              </form>
            )}
          </section>

          <section
            className={`${css.panel} ${sideTab !== 'guide' ? css.sidePanelHidden : ''}`}
            aria-labelledby={fieldId(sessionId, 'guide-title')}
          >
            <div className={css.sectionHeader}>
              <div>
                <p className={css.sectionKicker}>Caixa de mensagens persistente</p>
                <h3 id={fieldId(sessionId, 'guide-title')}>Orientar integrante</h3>
              </div>
            </div>
            <form className={css.form} onSubmit={(event) => { void handleGuide(event) }}>
              <label>
                <span>Destinatário</span>
                <select
                  value={guideDraft.target}
                  onChange={(event) => {
                    setGuideDraft(current => ({ ...current, target: event.target.value }))
                  }}
                  required
                  disabled={teammateNames.length === 0}
                >
                  {teammateNames.length === 0 && <option value="">Nenhum integrante</option>}
                  {teammateNames.map(name => <option value={name} key={name}>{name}</option>)}
                </select>
              </label>
              <label>
                <span>Entrega</span>
                <select value={guideDraft.delivery} onChange={(event) => { setGuideDraft(current => ({ ...current, delivery: event.target.value as GuideDraft['delivery'] })) }}>
                  <option value="wakeup">Acordar e orientar</option>
                  <option value="quiet">Apenas deixar na fila</option>
                </select>
              </label>
              <label className={css.fieldWide}>
                <span>Orientação</span>
                <textarea value={guideDraft.content} onChange={(event) => { setGuideDraft(current => ({ ...current, content: event.target.value })) }} rows={4} placeholder="Adicione restrições, correções ou o próximo objetivo." />
              </label>
              <AttachmentInput
                label="Imagens e arquivos da orientação"
                attachments={guideAttachments}
                disabled={formsDisabled}
                onFiles={(files) => { addAttachments(files, setGuideAttachments) }}
                onRemove={(id) => { removeAttachment(id, setGuideAttachments) }}
              />
              <div className={css.formActions}>
                <button type="submit" className={css.primaryButton} disabled={formsDisabled || guideDraft.target === '' || (guideDraft.content.trim() === '' && guideAttachments.length === 0)}>
                  {pending === 'guide' ? 'Enviando…' : 'Enviar orientação'}
                </button>
              </div>
            </form>
          </section>
        </aside>
      </div>
    </div>
  )
}
