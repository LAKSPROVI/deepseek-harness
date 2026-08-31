// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  TeamDebateSnapshot,
  TeamMemberView,
  TeamProjection,
} from '@deepseek-ai/dsh-agent-team/client'
import type {
  SessionId,
  SessionListState,
  SessionSummary,
} from '@deepseek-ai/dsh-client-runtime/client'
import {
  AgentTeamView,
  type AgentTeamActions,
  type AgentTeamViewProps,
} from '../src/client/AgentTeamView.tsx'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const LEAD = 'lead-session' as SessionId
const WORKER = 'worker-session' as SessionId

function debate(over: Partial<TeamDebateSnapshot> = {}): TeamDebateSnapshot {
  return {
    id: 'debate-1' as TeamDebateSnapshot['id'],
    revision: 4,
    topic: 'Choose the release strategy',
    status: 'active',
    phase: 'critique',
    round: 1,
    maxRounds: 3,
    participants: ['researcher'],
    history: [{
      revision: 2,
      round: 1,
      phase: 'positions',
      status: 'active',
      actor: 'lead',
      note: 'Initial positions recorded',
    }],
    ...over,
  }
}

function projection(over: Partial<TeamProjection> = {}): TeamProjection {
  return {
    teamId: LEAD as unknown as TeamProjection['teamId'],
    members: [{
      id: WORKER,
      name: 'researcher',
      description: 'Investigates release risks',
      provider: 'spawn',
      llmProvider: 'openai',
      model: 'gpt-5',
      persona: 'Skeptical release reviewer',
      context: 'fresh',
      phase: 'active',
    }],
    tasks: [{
      id: 'task-1' as TeamProjection['tasks'][number]['id'],
      revision: 2,
      subject: 'Audit release blockers',
      description: 'Check CI, migration, and rollback risks.',
      status: 'in_progress',
      ownerId: WORKER,
      blockedBy: ['task-0' as TeamProjection['tasks'][number]['id']],
      writeScopes: ['packages/release'],
    }],
    debate: debate(),
    ...over,
  }
}

function runtimeMembers(): TeamMemberView[] {
  return [{
    id: LEAD,
    name: 'lead',
    role: 'lead',
    status: 'idle',
    llmProvider: 'deepseek',
    model: 'deepseek-chat',
    diagnostics: [],
  }, {
    id: WORKER,
    name: 'researcher',
    role: 'teammate',
    status: 'running',
    description: 'Investigates release risks',
    provider: 'spawn',
    llmProvider: 'openai',
    model: 'gpt-5',
    persona: 'Skeptical release reviewer',
    context: 'fresh',
    diagnostics: [],
  }]
}

function sessionState(): SessionListState {
  const lead: SessionSummary = {
    id: LEAD,
    displayTitle: 'Lead',
    running: false,
    blank: false,
    updatedAt: 1,
  }
  const worker: SessionSummary = {
    id: WORKER,
    displayTitle: 'researcher',
    parentId: LEAD,
    origin: 'subagent',
    running: true,
    blank: false,
    updatedAt: 2,
  }
  return {
    ids: [LEAD, WORKER],
    byId: { [LEAD]: lead, [WORKER]: worker },
    current: LEAD,
    phase: 'ready',
    subagentsByParent: {},
    jobsBySession: {},
    currentAddress: undefined,
  }
}

function actions(over: Partial<AgentTeamActions> = {}): AgentTeamActions {
  return {
    members: vi.fn<AgentTeamActions['members']>(() => Promise.resolve({ ok: true, value: runtimeMembers() })),
    spawn: vi.fn<AgentTeamActions['spawn']>(() => Promise.resolve({ ok: true, value: {} })),
    guide: vi.fn<AgentTeamActions['guide']>(() => Promise.resolve({ ok: true, value: {} })),
    interrupt: vi.fn<AgentTeamActions['interrupt']>(() => Promise.resolve({
      ok: true,
      value: { previousStatus: 'running' },
    })),
    debateStart: vi.fn<AgentTeamActions['debateStart']>(() => Promise.resolve({ ok: true, value: debate() })),
    debateUpdate: vi.fn<AgentTeamActions['debateUpdate']>(() => Promise.resolve({ ok: true, value: debate() })),
    ...over,
  }
}

function viewProps(
  value: TeamProjection | null | undefined,
  actionFace: AgentTeamActions = actions(),
): AgentTeamViewProps {
  const sessions = sessionState()
  return {
    sessionId: LEAD,
    useProjection: () => value,
    useSessions: selector => selector(sessions),
    useSession: selector => selector({} as never),
    inspect: null,
    onInspectDone: vi.fn(),
    t: ((key: string) => key) as AgentTeamViewProps['t'],
    ...actionFace,
  } as AgentTeamViewProps
}

describe('AgentTeamView', () => {
  it('distinguishes an absent projection from an enabled Team with no durable activity', () => {
    const absent = render(<AgentTeamView {...viewProps(undefined)} />)
    expect(screen.getByRole('heading', { name: 'Agent Teams is not enabled' })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Members' })).toBeNull()
    absent.unmount()

    render(<AgentTeamView {...viewProps(null)} />)
    expect(screen.getByText(/No durable Team activity yet/)).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Members' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Spawn teammate' })).toBeTruthy()
  })

  it('renders runtime roster details, durable tasks, and the debate timeline', async () => {
    render(<AgentTeamView {...viewProps(projection())} />)

    const roster = await screen.findByRole('list', { name: 'Agent Team members' })
    expect(within(roster).getByText('researcher')).toBeTruthy()
    expect(within(roster).getByText('openai / gpt-5')).toBeTruthy()
    expect(within(roster).getByText('Persona')).toBeTruthy()
    expect(within(roster).getByTitle('Skeptical release reviewer')).toBeTruthy()
    expect(within(roster).getByText('running')).toBeTruthy()

    const tasks = screen.getByRole('heading', { name: 'Tasks' }).closest('section')
    if (tasks === null) throw new Error('Tasks section not found')
    expect(within(tasks).getByText('Audit release blockers')).toBeTruthy()
    expect(within(tasks).getByText('in progress')).toBeTruthy()
    expect(within(tasks).getByText('task-0')).toBeTruthy()
    expect(within(tasks).getByText('packages/release')).toBeTruthy()

    expect(screen.getByText('Choose the release strategy')).toBeTruthy()
    expect(screen.getByText('Round 1/3')).toBeTruthy()
    expect(screen.getByText('critique')).toBeTruthy()
    expect(screen.getByText('Initial positions recorded')).toBeTruthy()
    expect(screen.getByText(/Pausing blocks protocol advancement/)).toBeTruthy()
  })

  it('submits an LLM-specific spawn request and keeps the form single-flight while pending', async () => {
    let settle!: (result: Awaited<ReturnType<AgentTeamActions['spawn']>>) => void
    const spawn = vi.fn<AgentTeamActions['spawn']>(() => new Promise((resolve) => { settle = resolve }))
    const actionFace = actions({ spawn })
    render(<AgentTeamView {...viewProps(null, actionFace)} />)

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'critic' } })
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Reviews the proposal' } })
    fireEvent.change(screen.getByLabelText('Initial prompt'), { target: { value: 'Find release risks.' } })
    fireEvent.change(screen.getByLabelText('Context'), { target: { value: 'fork' } })
    fireEvent.change(screen.getByLabelText(/LLM provider/), { target: { value: 'openai' } })
    fireEvent.change(screen.getByLabelText(/Model/), { target: { value: 'gpt-5' } })
    fireEvent.change(screen.getByLabelText(/Persona/), { target: { value: 'Adversarial reviewer' } })
    fireEvent.click(screen.getByRole('button', { name: 'Spawn teammate' }))

    expect(spawn).toHaveBeenCalledTimes(1)
    expect(spawn.mock.calls[0]?.[0]).toEqual({
      name: 'critic',
      description: 'Reviews the proposal',
      prompt: 'Find release risks.',
      context: 'fork',
      llmProvider: 'openai',
      model: 'gpt-5',
      persona: 'Adversarial reviewer',
    })
    expect(spawn.mock.calls[0]?.[1]).toBeInstanceOf(AbortSignal)
    const pendingButton = screen.getByRole<HTMLButtonElement>('button', { name: 'Spawning…' })
    expect(pendingButton.disabled).toBe(true)
    fireEvent.click(pendingButton)
    expect(spawn).toHaveBeenCalledTimes(1)

    await act(async () => { settle({ ok: true, value: {} }) })
    await waitFor(() => {
      expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Spawn teammate' }).disabled).toBe(false)
    })
  })

  it('starts a debate and submits revision-bound protocol updates', async () => {
    const debateStart = vi.fn<AgentTeamActions['debateStart']>(() => Promise.resolve({ ok: true, value: debate() }))
    const startActions = actions({ debateStart })
    const startView = render(<AgentTeamView {...viewProps(projection({ debate: null }), startActions)} />)

    fireEvent.change(screen.getByLabelText('Topic'), { target: { value: '  Select a release path  ' } })
    fireEvent.click(screen.getByLabelText('researcher'))
    fireEvent.change(screen.getByLabelText('Maximum rounds'), { target: { value: '5' } })
    fireEvent.click(screen.getByRole('button', { name: 'Start debate' }))

    await waitFor(() => {
      expect(debateStart).toHaveBeenCalledWith({
        topic: 'Select a release path',
        participants: ['lead', 'researcher'],
        maxRounds: 5,
      })
    })
    startView.unmount()

    const debateUpdate = vi.fn<AgentTeamActions['debateUpdate']>(() => Promise.resolve({ ok: true, value: debate() }))
    render(<AgentTeamView {...viewProps(projection(), actions({ debateUpdate }))} />)
    fireEvent.change(screen.getByLabelText(/Transition note/), { target: { value: 'Review evidence first' } })
    fireEvent.click(screen.getByRole('button', { name: 'Advance phase' }))

    await waitFor(() => {
      expect(debateUpdate).toHaveBeenCalledWith({
        debateId: 'debate-1',
        expectedRevision: 4,
        action: 'advance',
        note: 'Review evidence first',
      })
    })
  })

  it('shows a Remote failure and dismisses it without hiding the Team', async () => {
    const guide = vi.fn<AgentTeamActions['guide']>(() => Promise.resolve({
      ok: false,
      error: { code: 'team-busy', message: 'guidance rejected', details: {} },
    }))
    render(<AgentTeamView {...viewProps(projection(), actions({ guide }))} />)

    fireEvent.change(screen.getByLabelText('Guidance'), { target: { value: 'Verify the rollback plan.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send guidance' }))

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('guidance rejected (team-busy)')
    expect(screen.getByRole('heading', { name: 'Members' })).toBeTruthy()
    fireEvent.click(within(alert).getByRole('button', { name: 'Dismiss' }))
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
