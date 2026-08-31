import {
  useCallback, useEffect, useMemo, useRef, useState,
  type FormEvent,
} from 'react'
import type {
  GuideTeamMemberRemoteRequest,
  SpawnTeamMemberRemoteRequest,
  StartTeamDebateRequest,
  TeamDebatePhase,
  TeamDebateSnapshot,
  TeamMemberView,
  TeamProjection,
  UpdateTeamDebateRequest,
} from '@deepseek-ai/dsh-agent-team/client'
import type { ConvViewProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import { NS } from './locales.ts'
import css from './AgentTeamView.module.css'

/** Browser actions supplied by the ui-subagent registration. */
export interface AgentTeamActions {
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
    request: StartTeamDebateRequest,
  ) => Promise<RemoteResult<TeamDebateSnapshot>>
  /** Apply one compare-and-set debate transition. */
  debateUpdate: (
    request: UpdateTeamDebateRequest,
  ) => Promise<RemoteResult<TeamDebateSnapshot>>
}

/** Alias used by the slot registration's inject factory. */
export type AgentTeamViewInjected = AgentTeamActions

/** Complete props of the Agent Teams conversation view. */
export type AgentTeamViewProps = ConvViewProps & AgentTeamActions & PropsLocale<typeof NS>

type PendingAction =
  | 'members'
  | 'spawn'
  | 'guide'
  | `interrupt:${string}`
  | 'debate-start'
  | 'debate-update'

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

function readable(value: string): string {
  return value.replaceAll('_', ' ')
}

function resultError(result: RemoteResult<unknown>): string | null {
  return result.ok ? null : `${result.error.message} (${result.error.code})`
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

/** Agent Teams roster, task board, debate protocol, and operator controls. */
export function AgentTeamView({
  sessionId,
  useProjection,
  useSessions,
  members,
  spawn,
  guide,
  interrupt,
  debateStart,
  debateUpdate,
}: AgentTeamViewProps) {
  const projection = useProjection('agentTeam') as TeamProjection | null | undefined
  const sessions = useSessions(state => state)
  const [runtimeMembers, setRuntimeMembers] = useState<TeamMemberView[] | null>(null)
  const [spawnDraft, setSpawnDraft] = useState<SpawnDraft>(EMPTY_SPAWN)
  const [guideDraft, setGuideDraft] = useState<GuideDraft>(EMPTY_GUIDE)
  const [debateDraft, setDebateDraft] = useState<DebateDraft>(EMPTY_DEBATE)
  const [debateNote, setDebateNote] = useState('')
  const [pending, setPending] = useState<PendingAction | null>(null)
  const [error, setError] = useState<string | null>(null)
  const pendingRef = useRef<PendingAction | null>(null)

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
      if (showPending) setError(cause instanceof Error ? cause.message : 'Unable to load Team members.')
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
      setError(cause instanceof Error ? cause.message : 'The Agent Teams action failed.')
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
    const llmProvider = optionalText(spawnDraft.llmProvider)
    const model = optionalText(spawnDraft.model)
    const persona = optionalText(spawnDraft.persona)
    const request: SpawnTeamMemberRemoteRequest = {
      name: spawnDraft.name.trim(),
      description: spawnDraft.description.trim(),
      prompt: spawnDraft.prompt.trim(),
      context: spawnDraft.context,
      ...llmProvider === undefined ? {} : { llmProvider },
      ...model === undefined ? {} : { model },
      ...persona === undefined ? {} : { persona },
    }
    const controller = new AbortController()
    const result = await runAction('spawn', () => spawn(request, controller.signal))
    if (result?.ok) {
      setSpawnDraft(EMPTY_SPAWN)
      await refreshMembers()
    }
  }

  const handleGuide = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const request: GuideTeamMemberRemoteRequest = {
      target: guideDraft.target,
      content: guideDraft.content.trim(),
      delivery: guideDraft.delivery,
    }
    const controller = new AbortController()
    const result = await runAction('guide', () => guide(request, controller.signal))
    if (result?.ok) setGuideDraft(current => ({ ...current, content: '' }))
  }

  const handleInterrupt = async (targetName: string) => {
    const result = await runAction(`interrupt:${targetName}`, () => interrupt(targetName))
    if (result?.ok) await refreshMembers()
  }

  const handleDebateStart = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const maxRounds = Number(debateDraft.maxRounds)
    const request: StartTeamDebateRequest = {
      topic: debateDraft.topic.trim(),
      participants: ['lead', ...debateDraft.participants],
      ...(Number.isSafeInteger(maxRounds) && maxRounds > 0 ? { maxRounds } : {}),
    }
    const result = await runAction('debate-start', () => debateStart(request))
    if (result?.ok) setDebateDraft(EMPTY_DEBATE)
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

  if (projection === undefined) {
    return (
      <div className={css.root} data-agent-team-view>
        <section className={css.empty} aria-labelledby={fieldId(sessionId, 'empty-title')}>
          <span className={css.emptyMark} aria-hidden="true">AT</span>
          <div>
            <h2 id={fieldId(sessionId, 'empty-title')}>Agent Teams is not enabled</h2>
            <p>Mount the Agent Teams host capability for this session to coordinate teammates, tasks, and debates.</p>
          </div>
        </section>
      </div>
    )
  }

  const tasks = (projection?.tasks ?? []).filter(task => task.status !== 'deleted')
  const debate = projection?.debate ?? null
  const activeCount = roster.filter(member => member.status === 'running').length
  const openTaskCount = tasks.filter(task => task.status !== 'completed').length
  const formsDisabled = pending !== null
  const canSpawn = roster.length < 10

  return (
    <div className={css.root} data-agent-team-view>
      <header className={css.hero}>
        <div>
          <p className={css.eyebrow}>Agent Teams</p>
          <h2>Coordinate the team</h2>
          <p className={css.heroCopy}>Observe up to ten agents, guide durable work, and advance a structured debate.</p>
        </div>
        <dl className={css.metrics} aria-label="Team summary">
          <div><dt>Members</dt><dd>{roster.length}/10</dd></div>
          <div><dt>Running</dt><dd>{activeCount}</dd></div>
          <div><dt>Open tasks</dt><dd>{openTaskCount}</dd></div>
        </dl>
      </header>

      {projection === null && (
        <div className={css.optInNotice}>
          No durable Team activity yet. Spawn the first teammate or start a debate to opt this session in.
        </div>
      )}

      {error !== null && (
        <div className={css.error} role="alert">
          <span>{error}</span>
          <button type="button" className={css.textButton} onClick={() => { setError(null) }}>Dismiss</button>
        </div>
      )}

      <div className={css.layout}>
        <main className={css.mainColumn}>
          <section className={css.panel} aria-labelledby={fieldId(sessionId, 'roster-title')}>
            <div className={css.sectionHeader}>
              <div>
                <p className={css.sectionKicker}>Runtime roster</p>
                <h3 id={fieldId(sessionId, 'roster-title')}>Members</h3>
              </div>
              <button
                type="button"
                className={css.secondaryButton}
                disabled={formsDisabled}
                onClick={() => { void refreshMembers(true) }}
              >
                {pending === 'members' ? 'Refreshing…' : 'Refresh status'}
              </button>
            </div>
            <div className={css.roster} role="list" aria-label="Agent Team members">
              {roster.map(member => (
                <article className={css.memberCard} role="listitem" key={member.id}>
                  <div className={css.memberIdentity}>
                    <span className={`${css.statusDot} ${statusClass(member.status)}`} aria-hidden="true" />
                    <div className={css.memberCopy}>
                      <div className={css.memberTitleRow}>
                        <strong>{member.name}</strong>
                        <span className={css.roleBadge}>{member.role}</span>
                        {member.persona !== undefined && (
                          <span className={css.personaBadge} title={member.persona}>Persona</span>
                        )}
                      </div>
                      <p>{member.description ?? (member.role === 'lead' ? 'Team coordinator' : 'No description')}</p>
                    </div>
                  </div>
                  <div className={css.memberFacts}>
                    <span className={css.statusLabel}>{readable(member.status)}</span>
                    <span title="Subagent transport">{member.provider ?? 'host'}</span>
                    <span title="LLM provider and model">
                      {[member.llmProvider, member.model].filter(Boolean).join(' / ') || 'Inherited model'}
                    </span>
                    {member.context !== undefined && <span>{member.context} context</span>}
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
                        aria-label={`Interrupt ${member.name}'s active turn`}
                      >
                        {pending === `interrupt:${member.name}` ? 'Interrupting…' : 'Interrupt turn'}
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
                <p className={css.sectionKicker}>Durable task DAG</p>
                <h3 id={fieldId(sessionId, 'tasks-title')}>Tasks</h3>
              </div>
              <span className={css.countBadge}>{tasks.length}</span>
            </div>
            {tasks.length === 0 ? (
              <p className={css.emptyCopy}>No Team tasks have been recorded.</p>
            ) : (
              <div className={css.taskList}>
                {tasks.map(task => (
                  <article className={css.taskCard} key={task.id}>
                    <div className={css.taskHeader}>
                      <strong>{task.subject}</strong>
                      <span className={`${css.taskStatus} ${css[`task_${task.status}`]}`}>{readable(task.status)}</span>
                    </div>
                    {task.description !== '' && <p>{task.description}</p>}
                    <dl className={css.taskFacts}>
                      <div><dt>Owner</dt><dd>{task.ownerId === undefined ? 'Unassigned' : memberNameById.get(task.ownerId) ?? task.ownerId}</dd></div>
                      <div><dt>Revision</dt><dd>{task.revision}</dd></div>
                      <div><dt>Blocked by</dt><dd>{task.blockedBy.length === 0 ? 'None' : task.blockedBy.join(', ')}</dd></div>
                    </dl>
                    {task.writeScopes.length > 0 && (
                      <div className={css.scopeList} aria-label="Advisory write scopes">
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
                <p className={css.sectionKicker}>Structured deliberation</p>
                <h3 id={fieldId(sessionId, 'debate-title')}>Debate</h3>
              </div>
              {debate !== null && <span className={css.countBadge}>Round {debate.round}/{debate.maxRounds}</span>}
            </div>

            {debate === null ? (
              <form className={css.form} onSubmit={(event) => { void handleDebateStart(event) }}>
                <label className={css.fieldWide}>
                  <span>Topic</span>
                  <textarea
                    value={debateDraft.topic}
                    onChange={(event) => { setDebateDraft(current => ({ ...current, topic: event.target.value })) }}
                    rows={3}
                    required
                    placeholder="State the decision or question the team should debate."
                  />
                </label>
                <fieldset className={css.participants}>
                  <legend>Participants</legend>
                  <label>
                    <input type="checkbox" checked disabled />
                    <span>lead</span>
                  </label>
                  {teammateNames.length === 0 ? (
                    <p>Spawn at least one teammate before starting a debate.</p>
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
                  <span>Maximum rounds</span>
                  <input
                    type="number"
                    min={1}
                    step={1}
                    value={debateDraft.maxRounds}
                    onChange={(event) => { setDebateDraft(current => ({ ...current, maxRounds: event.target.value })) }}
                    required
                  />
                </label>
                <div className={css.formActions}>
                  <button
                    type="submit"
                    className={css.primaryButton}
                    disabled={formsDisabled || debateDraft.topic.trim() === '' || debateDraft.participants.length === 0}
                  >
                    {pending === 'debate-start' ? 'Starting…' : 'Start debate'}
                  </button>
                </div>
              </form>
            ) : (
              <div className={css.debate}>
                <div className={css.debateSummary}>
                  <div>
                    <span className={`${css.debateStatus} ${css[`debate_${debate.status}`]}`}>{debate.status}</span>
                    <strong>{debate.topic}</strong>
                  </div>
                  <p>{debate.participants.join(', ')}</p>
                </div>
                <ol className={css.phaseTimeline} aria-label="Debate phases">
                  {DEBATE_PHASES.map((phase, index) => {
                    const currentIndex = DEBATE_PHASES.indexOf(debate.phase)
                    const state = index < currentIndex ? 'done' : index === currentIndex ? 'current' : 'upcoming'
                    return (
                      <li className={css[`phase_${state}`]} key={phase} aria-current={state === 'current' ? 'step' : undefined}>
                        <span>{index + 1}</span>
                        <strong>{readable(phase)}</strong>
                      </li>
                    )
                  })}
                </ol>
                {debate.history.length > 0 && (
                  <ol className={css.transitionList} aria-label="Debate transition history">
                    {debate.history.map(transition => (
                      <li key={transition.revision}>
                        <span>R{transition.round} · {readable(transition.phase)}</span>
                        <strong>{transition.actor}</strong>
                        <span>{transition.status}</span>
                        {transition.note !== undefined && <p>{transition.note}</p>}
                      </li>
                    ))}
                  </ol>
                )}
                {debate.status !== 'completed' && (
                  <div className={css.debateControls}>
                    <label className={css.fieldWide}>
                      <span>Transition note <em>optional</em></span>
                      <input
                        type="text"
                        value={debateNote}
                        onChange={(event) => { setDebateNote(event.target.value) }}
                        placeholder="Record why the protocol is changing."
                      />
                    </label>
                    <div className={css.buttonRow}>
                      {debate.status === 'active' ? (
                        <button type="button" className={css.secondaryButton} disabled={formsDisabled} onClick={() => { void handleDebateUpdate('pause') }}>Pause protocol</button>
                      ) : (
                        <button type="button" className={css.secondaryButton} disabled={formsDisabled} onClick={() => { void handleDebateUpdate('resume') }}>Resume protocol</button>
                      )}
                      <button type="button" className={css.primaryButton} disabled={formsDisabled || debate.status !== 'active'} onClick={() => { void handleDebateUpdate('advance') }}>Advance phase</button>
                      <button type="button" className={css.dangerButton} disabled={formsDisabled} onClick={() => { void handleDebateUpdate('complete') }}>Complete debate</button>
                    </div>
                    <p className={css.protocolNote}>
                      Pausing blocks protocol advancement. It does not cancel turns that are already active.
                    </p>
                  </div>
                )}
              </div>
            )}
          </section>
        </main>

        <aside className={css.sideColumn} aria-label="Team controls">
          <section className={css.panel} aria-labelledby={fieldId(sessionId, 'spawn-title')}>
            <div className={css.sectionHeader}>
              <div>
                <p className={css.sectionKicker}>Provision</p>
                <h3 id={fieldId(sessionId, 'spawn-title')}>Spawn teammate</h3>
              </div>
            </div>
            {!canSpawn ? (
              <p className={css.emptyCopy}>The ten-agent observation limit has been reached.</p>
            ) : (
              <form className={css.form} onSubmit={(event) => { void handleSpawn(event) }}>
                <label>
                  <span>Name</span>
                  <input value={spawnDraft.name} onChange={(event) => { setSpawnDraft(current => ({ ...current, name: event.target.value })) }} required placeholder="researcher" pattern="[a-z0-9]+(?:-[a-z0-9]+)*" />
                </label>
                <label>
                  <span>Description</span>
                  <input value={spawnDraft.description} onChange={(event) => { setSpawnDraft(current => ({ ...current, description: event.target.value })) }} required placeholder="Investigates constraints" />
                </label>
                <label className={css.fieldWide}>
                  <span>Initial prompt</span>
                  <textarea
                    value={spawnDraft.prompt}
                    onChange={(event) => {
                      setSpawnDraft(current => ({ ...current, prompt: event.target.value }))
                    }}
                    required
                    rows={4}
                  />
                </label>
                <label>
                  <span>Context</span>
                  <select value={spawnDraft.context} onChange={(event) => { setSpawnDraft(current => ({ ...current, context: event.target.value as SpawnDraft['context'] })) }}>
                    <option value="fresh">Fresh</option>
                    <option value="fork">Fork completed history</option>
                  </select>
                </label>
                <label>
                  <span>LLM provider <em>optional</em></span>
                  <input value={spawnDraft.llmProvider} onChange={(event) => { setSpawnDraft(current => ({ ...current, llmProvider: event.target.value })) }} placeholder="inherit" />
                </label>
                <label>
                  <span>Model <em>optional</em></span>
                  <input value={spawnDraft.model} onChange={(event) => { setSpawnDraft(current => ({ ...current, model: event.target.value })) }} placeholder="inherit" />
                </label>
                <label className={css.fieldWide}>
                  <span>Persona <em>optional</em></span>
                  <textarea value={spawnDraft.persona} onChange={(event) => { setSpawnDraft(current => ({ ...current, persona: event.target.value })) }} rows={3} placeholder="Additional system persona for this teammate" />
                </label>
                <div className={css.formActions}>
                  <button type="submit" className={css.primaryButton} disabled={formsDisabled || !canSpawn}>
                    {pending === 'spawn' ? 'Spawning…' : 'Spawn teammate'}
                  </button>
                </div>
              </form>
            )}
          </section>

          <section className={css.panel} aria-labelledby={fieldId(sessionId, 'guide-title')}>
            <div className={css.sectionHeader}>
              <div>
                <p className={css.sectionKicker}>Durable mailbox</p>
                <h3 id={fieldId(sessionId, 'guide-title')}>Guide teammate</h3>
              </div>
            </div>
            <form className={css.form} onSubmit={(event) => { void handleGuide(event) }}>
              <label>
                <span>Target</span>
                <select
                  value={guideDraft.target}
                  onChange={(event) => {
                    setGuideDraft(current => ({ ...current, target: event.target.value }))
                  }}
                  required
                  disabled={teammateNames.length === 0}
                >
                  {teammateNames.length === 0 && <option value="">No teammates</option>}
                  {teammateNames.map(name => <option value={name} key={name}>{name}</option>)}
                </select>
              </label>
              <label>
                <span>Delivery</span>
                <select value={guideDraft.delivery} onChange={(event) => { setGuideDraft(current => ({ ...current, delivery: event.target.value as GuideDraft['delivery'] })) }}>
                  <option value="wakeup">Wake and guide</option>
                  <option value="quiet">Queue quietly</option>
                </select>
              </label>
              <label className={css.fieldWide}>
                <span>Guidance</span>
                <textarea value={guideDraft.content} onChange={(event) => { setGuideDraft(current => ({ ...current, content: event.target.value })) }} required rows={4} placeholder="Add constraints, corrections, or the next objective." />
              </label>
              <div className={css.formActions}>
                <button type="submit" className={css.primaryButton} disabled={formsDisabled || guideDraft.target === '' || guideDraft.content.trim() === ''}>
                  {pending === 'guide' ? 'Sending…' : 'Send guidance'}
                </button>
              </div>
            </form>
          </section>
        </aside>
      </div>
    </div>
  )
}
