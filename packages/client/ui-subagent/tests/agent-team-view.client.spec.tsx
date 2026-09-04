// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  TeamDebateSnapshot,
  TeamMemberView,
  TeamProjection,
} from '@deepseek-ai/dsh-agent-team/client'
import type { SessionModels } from '@deepseek-ai/dsh-api-remotes/client'
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

function modelDirectory(over: Partial<SessionModels> = {}): SessionModels {
  return {
    current: { provider: 'deepseek', model: 'deepseek-chat' },
    routable: true,
    groups: [{
      id: 'deepseek',
      name: 'DeepSeek',
      models: [{ id: 'deepseek-chat', name: 'DeepSeek Chat' }],
    }, {
      id: 'openai',
      name: 'OpenAI',
      models: [
        { id: 'gpt-5', name: 'GPT-5' },
        { id: 'gpt-5-mini', name: 'GPT-5 mini' },
      ],
    }],
    failures: [],
    ...over,
  }
}

function debate(over: Partial<TeamDebateSnapshot> = {}): TeamDebateSnapshot {
  return {
    id: 'debate-1' as TeamDebateSnapshot['id'],
    revision: 4,
    topic: 'Choose the release strategy',
    evidence: [],
    status: 'active',
    phase: 'critique',
    round: 1,
    maxRounds: 3,
    participants: ['researcher'],
    contributions: [{
      sequence: 1,
      revision: 3,
      round: 1,
      phase: 'critique',
      author: 'researcher',
      content: [{ type: 'text', text: 'The rollback window needs a compatibility check.' }],
      createdAt: 1_700_000_000_000,
    }],
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
  const templateSnapshot = {
    status: 'ready' as const, templates: [], writable: true, saving: false, error: null,
  }
  return {
    hooks: {
      teamTemplates: { getSnapshot: () => templateSnapshot, subscribe: () => () => {} },
    },
    loadModels: vi.fn<AgentTeamActions['loadModels']>(() => Promise.resolve(modelDirectory())),
    members: vi.fn<AgentTeamActions['members']>(() => Promise.resolve({ ok: true, value: runtimeMembers() })),
    spawn: vi.fn<AgentTeamActions['spawn']>(() => Promise.resolve({ ok: true, value: {} })),
    guide: vi.fn<AgentTeamActions['guide']>(() => Promise.resolve({ ok: true, value: {} })),
    interrupt: vi.fn<AgentTeamActions['interrupt']>(() => Promise.resolve({
      ok: true,
      value: { previousStatus: 'running' },
    })),
    debateStart: vi.fn<AgentTeamActions['debateStart']>(() => Promise.resolve({ ok: true, value: debate() })),
    debateContribute: vi.fn<AgentTeamActions['debateContribute']>(() => Promise.resolve({ ok: true, value: debate() })),
    debateUpdate: vi.fn<AgentTeamActions['debateUpdate']>(() => Promise.resolve({ ok: true, value: debate() })),
    createAttachments: vi.fn<AgentTeamActions['createAttachments']>(() => []),
    serializeAttachments: vi.fn<AgentTeamActions['serializeAttachments']>(() => Promise.resolve([])),
    releaseAttachments: vi.fn<AgentTeamActions['releaseAttachments']>(),
    resolveAttachment: vi.fn<AgentTeamActions['resolveAttachment']>(() => Promise.resolve('blob:test')),
    saveTemplate: vi.fn<AgentTeamActions['saveTemplate']>(() => Promise.resolve()),
    deleteTemplate: vi.fn<AgentTeamActions['deleteTemplate']>(() => Promise.resolve()),
    ...over,
  }
}

function viewProps(
  value: TeamProjection | null | undefined,
  actionFace: AgentTeamActions = actions(),
): AgentTeamViewProps {
  const sessions = sessionState()
  const { hooks, ...callbacks } = actionFace
  return {
    sessionId: LEAD,
    useProjection: () => value,
    useSessions: selector => selector(sessions),
    useSession: selector => selector({} as never),
    inspect: null,
    onInspectDone: vi.fn(),
    t: ((key: string) => key) as AgentTeamViewProps['t'],
    useTeamTemplates: selector => selector(hooks.teamTemplates.getSnapshot()),
    ...callbacks,
  } as AgentTeamViewProps
}

describe('AgentTeamView', () => {
  it('distinguishes an absent projection from an enabled Team with no durable activity', () => {
    const absent = render(<AgentTeamView {...viewProps(undefined)} />)
    expect(screen.getByRole('heading', { name: 'Equipe de agentes não habilitada' })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Integrantes' })).toBeNull()
    absent.unmount()

    render(<AgentTeamView {...viewProps(null)} />)
    expect(screen.getByText(/Ainda não há atividade persistida/)).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Integrantes' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Criar integrante' })).toBeTruthy()
  })

  it('renders Portuguese runtime details, durable tasks, and the debate timeline', async () => {
    render(<AgentTeamView {...viewProps(projection())} />)

    const roster = await screen.findByRole('list', { name: 'Integrantes da equipe de agentes' })
    expect(within(roster).getByText('researcher')).toBeTruthy()
    expect(within(roster).getByText('openai / gpt-5')).toBeTruthy()
    expect(within(roster).getByText('Persona')).toBeTruthy()
    expect(within(roster).getByTitle('Skeptical release reviewer')).toBeTruthy()
    expect(within(roster).getByText('em execução')).toBeTruthy()

    const tasks = screen.getByRole('heading', { name: 'Tarefas' }).closest('section')
    if (tasks === null) throw new Error('Tasks section not found')
    expect(within(tasks).getByText('Audit release blockers')).toBeTruthy()
    expect(within(tasks).getByText('em andamento')).toBeTruthy()
    expect(within(tasks).getByText('task-0')).toBeTruthy()
    expect(within(tasks).getByText('packages/release')).toBeTruthy()

    expect(screen.getByText('Choose the release strategy')).toBeTruthy()
    expect(screen.getByText('Rodada 1/3')).toBeTruthy()
    expect(screen.getByText('crítica')).toBeTruthy()
    expect(screen.getByText('Initial positions recorded')).toBeTruthy()
    expect(screen.getByText(/Pausar impede o avanço do protocolo/)).toBeTruthy()
  })

  it('submits an LLM-specific spawn request and keeps the form single-flight while pending', async () => {
    let settle!: (result: Awaited<ReturnType<AgentTeamActions['spawn']>>) => void
    const spawn = vi.fn<AgentTeamActions['spawn']>(() => new Promise((resolve) => { settle = resolve }))
    const actionFace = actions({ spawn })
    render(<AgentTeamView {...viewProps(null, actionFace)} />)

    fireEvent.change(screen.getByLabelText('Nome'), { target: { value: 'critic' } })
    fireEvent.change(screen.getByLabelText('Descrição'), { target: { value: 'Reviews the proposal' } })
    fireEvent.change(screen.getByLabelText('Instrução inicial'), { target: { value: 'Find release risks.' } })
    fireEvent.change(screen.getByLabelText('Contexto'), { target: { value: 'fork' } })
    await screen.findByRole('option', { name: 'OpenAI' })
    fireEvent.change(screen.getByLabelText(/Provider de LLM/), { target: { value: 'openai' } })
    expect(screen.getByRole('option', { name: 'GPT-5 mini' })).toBeTruthy()
    fireEvent.change(screen.getByLabelText(/Modelo/), { target: { value: 'gpt-5' } })
    fireEvent.change(screen.getByLabelText(/Persona/), { target: { value: 'Adversarial reviewer' } })
    fireEvent.click(screen.getByRole('button', { name: 'Criar integrante' }))

    await waitFor(() => {
      expect(spawn).toHaveBeenCalledTimes(1)
    })
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
    const pendingButton = screen.getByRole<HTMLButtonElement>('button', { name: 'Criando…' })
    expect(pendingButton.disabled).toBe(true)
    fireEvent.click(pendingButton)
    expect(spawn).toHaveBeenCalledTimes(1)

    await act(async () => { settle({ ok: true, value: {} }) })
    await waitFor(() => {
      expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Criar integrante' })).toBeTruthy()
      expect(screen.getByLabelText<HTMLInputElement>('Nome').value).toBe('')
    })
  })

  it('keeps inherited routing available when the model catalog fails and retries on demand', async () => {
    const loadModels = vi.fn<AgentTeamActions['loadModels']>()
      .mockRejectedValueOnce(new Error('catalog offline'))
      .mockResolvedValueOnce(modelDirectory())
    const spawn = vi.fn<AgentTeamActions['spawn']>(() => Promise.resolve({ ok: true, value: {} }))
    render(<AgentTeamView {...viewProps(null, actions({ loadModels, spawn }))} />)

    expect(await screen.findByText(/Catálogo indisponível: catalog offline/)).toBeTruthy()
    expect(screen.getByRole<HTMLSelectElement>('combobox', { name: /Provider de LLM/ }).value).toBe('')
    fireEvent.change(screen.getByLabelText('Nome'), { target: { value: 'inherited' } })
    fireEvent.change(screen.getByLabelText('Descrição'), { target: { value: 'Uses the Lead route' } })
    fireEvent.change(screen.getByLabelText('Instrução inicial'), { target: { value: 'Review the decision.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Criar integrante' }))

    await waitFor(() => {
      expect(spawn).toHaveBeenCalledWith({
        name: 'inherited',
        description: 'Uses the Lead route',
        prompt: 'Review the decision.',
        context: 'fresh',
      }, expect.any(AbortSignal))
    })
    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }))
    expect(await screen.findByRole('option', { name: 'OpenAI' })).toBeTruthy()
    expect(loadModels).toHaveBeenCalledTimes(2)
  })

  it('starts a debate and submits revision-bound protocol updates', async () => {
    const debateStart = vi.fn<AgentTeamActions['debateStart']>(() => Promise.resolve({ ok: true, value: debate() }))
    const startActions = actions({ debateStart })
    const startView = render(<AgentTeamView {...viewProps(projection({ debate: null }), startActions)} />)

    fireEvent.change(screen.getByLabelText('Tema'), { target: { value: '  Select a release path  ' } })
    fireEvent.click(screen.getByLabelText('researcher'))
    fireEvent.change(screen.getByLabelText('Máximo de rodadas'), { target: { value: '5' } })
    fireEvent.click(screen.getByRole('button', { name: 'Iniciar debate' }))

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
    fireEvent.change(screen.getByLabelText(/Nota da transição/), { target: { value: 'Review evidence first' } })
    fireEvent.click(screen.getByRole('button', { name: 'Avançar fase' }))

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

    fireEvent.change(screen.getByLabelText('Orientação'), { target: { value: 'Verify the rollback plan.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Enviar orientação' }))

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('Não foi possível concluir a ação: guidance rejected (team-busy)')
    expect(screen.getByRole('heading', { name: 'Integrantes' })).toBeTruthy()
    fireEvent.click(within(alert).getByRole('button', { name: 'Fechar' }))
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('normalizes natural teammate names to technical kebab-case IDs on submit', async () => {
    const spawn = vi.fn<AgentTeamActions['spawn']>(() => Promise.resolve({ ok: true, value: {} }))
    render(<AgentTeamView {...viewProps(null, actions({ spawn }))} />)

    fireEvent.change(screen.getByLabelText('Nome'), { target: { value: '  Revisor Técnico - Sênior!  ' } })
    expect(screen.getByText('revisor-tecnico-senior')).toBeTruthy()

    fireEvent.change(screen.getByLabelText('Descrição'), { target: { value: 'Audita conformidade' } })
    fireEvent.change(screen.getByLabelText('Instrução inicial'), { target: { value: 'Verifique os prazos e acórdãos.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Criar integrante' }))

    await waitFor(() => {
      expect(spawn).toHaveBeenCalledWith({
        name: 'revisor-tecnico-senior',
        description: 'Audita conformidade',
        prompt: 'Verifique os prazos e acórdãos.',
        context: 'fresh',
      }, expect.any(AbortSignal))
    })
  })

  it('manages reusable teammate templates by applying saved values and deleting items', async () => {
    const saveTemplate = vi.fn<AgentTeamActions['saveTemplate']>(() => Promise.resolve())
    const deleteTemplate = vi.fn<AgentTeamActions['deleteTemplate']>(() => Promise.resolve())
    const templateList = [{
      id: 'template-juridico',
      title: 'Advogado Especialista',
      name: 'advogado-especialista',
      description: 'Analisa teses',
      prompt: 'Elabore a impugnação detalhada.',
      context: 'fresh' as const,
      llmProvider: 'openai',
      model: 'gpt-5',
      persona: 'Especialista em direito processual',
    }]
    const hooks = {
      teamTemplates: {
        getSnapshot: () => ({
          status: 'ready' as const,
          templates: templateList,
          writable: true,
          saving: false,
          error: null,
        }),
        subscribe: () => () => {},
      },
    }
    render(<AgentTeamView {...viewProps(null, actions({ hooks, saveTemplate, deleteTemplate }))} />)

    await screen.findByRole('option', { name: 'OpenAI' })
    expect(screen.getByText('Advogado Especialista')).toBeTruthy()
    fireEvent.click(screen.getByText('Advogado Especialista'))

    expect(screen.getByLabelText<HTMLInputElement>('Nome').value).toBe('advogado-especialista')
    expect(screen.getByLabelText<HTMLInputElement>('Descrição').value).toBe('Analisa teses')
    expect(screen.getByLabelText<HTMLTextAreaElement>('Instrução inicial').value).toBe('Elabore a impugnação detalhada.')

    fireEvent.change(screen.getByLabelText('Nome do modelo reutilizável'), { target: { value: 'Meu Novo Modelo' } })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar modelo' }))

    await waitFor(() => {
      expect(saveTemplate).toHaveBeenCalledWith({
        title: 'Meu Novo Modelo',
        name: 'advogado-especialista',
        description: 'Analisa teses',
        prompt: 'Elabore a impugnação detalhada.',
        context: 'fresh',
        llmProvider: 'openai',
        model: 'gpt-5',
        persona: 'Especialista em direito processual',
      })
    })

    fireEvent.click(screen.getByRole('button', { name: 'Excluir modelo Advogado Especialista' }))
    await waitFor(() => {
      expect(deleteTemplate).toHaveBeenCalledWith('template-juridico')
    })
  })

  it('renders debate transcript, tracks missing participants, and enables phase advance only when complete', async () => {
    const debateContribute = vi.fn<AgentTeamActions['debateContribute']>(() => Promise.resolve({ ok: true, value: debate() }))
    const debateUpdate = vi.fn<AgentTeamActions['debateUpdate']>(() => Promise.resolve({ ok: true, value: debate() }))

    const incompleteDebate = debate({
      participants: ['lead', 'researcher'],
      contributions: [{
        sequence: 1,
        revision: 3,
        round: 1,
        phase: 'critique',
        author: 'researcher',
        content: [{ type: 'text', text: 'Primeira contribuição do pesquisador.' }],
        createdAt: 1_700_000_000_000,
      }],
    })

    const { rerender } = render(
      <AgentTeamView {...viewProps(projection({ debate: incompleteDebate }), actions({ debateContribute, debateUpdate }))} />,
    )

    expect(screen.getByText('Aguardando contribuições')).toBeTruthy()
    expect(screen.getByText(/Faltam: lead/)).toBeTruthy()
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Avançar fase' }).disabled).toBe(true)
    expect(screen.getByText('Primeira contribuição do pesquisador.')).toBeTruthy()

    fireEvent.change(screen.getByLabelText('Contribuição da líder'), { target: { value: 'Síntese preliminar da liderança.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Registrar contribuição' }))

    await waitFor(() => {
      expect(debateContribute).toHaveBeenCalledWith({
        debateId: 'debate-1',
        expectedRevision: 4,
        content: 'Síntese preliminar da liderança.',
      })
    })

    const completedDebate = debate({
      participants: ['lead', 'researcher'],
      contributions: [
        {
          sequence: 1,
          revision: 3,
          round: 1,
          phase: 'critique',
          author: 'researcher',
          content: [{ type: 'text', text: 'Primeira contribuição do pesquisador.' }],
          createdAt: 1_700_000_000_000,
        },
        {
          sequence: 2,
          revision: 4,
          round: 1,
          phase: 'critique',
          author: 'lead',
          content: [{ type: 'text', text: 'Síntese preliminar da liderança.' }],
          createdAt: 1_700_000_001_000,
        },
      ],
    })

    rerender(<AgentTeamView {...viewProps(projection({ debate: completedDebate }), actions({ debateContribute, debateUpdate }))} />)

    expect(screen.getByText('Pronto para avançar')).toBeTruthy()
    expect(screen.getByText('Todos os participantes registraram sua fala nesta etapa.')).toBeTruthy()
    const advanceButton = screen.getByRole<HTMLButtonElement>('button', { name: 'Avançar fase' })
    expect(advanceButton.disabled).toBe(false)
    fireEvent.click(advanceButton)

    await waitFor(() => {
      expect(debateUpdate).toHaveBeenCalledWith({
        debateId: 'debate-1',
        expectedRevision: 4,
        action: 'advance',
      })
    })
  })
})
