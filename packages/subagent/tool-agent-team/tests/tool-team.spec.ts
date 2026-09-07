import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { CallId } from '@deepseek-ai/dsh-llm'
import { scopeOf } from '@deepseek-ai/dsh-scope'
import { SessionId } from '@deepseek-ai/dsh-session'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import SubagentService from '@deepseek-ai/dsh-subagent'
import * as SubagentFork from '@deepseek-ai/dsh-subagent-fork-in-process'
import * as SubagentSpawn from '@deepseek-ai/dsh-subagent-spawn-in-process'
import { renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import * as ToolSubagentControl from '@deepseek-ai/dsh-tool-subagent-control'
import { defineContentToolFixture } from '@deepseek-ai/dsh-tools'
import { MockAdapter, textResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import TeamService from '../../agent-team/src/index.ts'
import * as toolTeam from '../src/index.ts'
import FileSettingsProvider from '@deepseek-ai/dsh-settings-file'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import {
  TEAM_TEMPLATE_SETTINGS_NAMESPACE,
  TeamTemplateSettingsSchema,
  validateTeamTemplateSettings,
} from '@deepseek-ai/dsh-agent-team'

const SIGNAL = new AbortController().signal
const TOOL_NAMES = [
  'spawn_teammate',
  'send_message',
  'followup_task',
  'list_agents',
  'wait_agent',
  'interrupt_agent',
  'team_debate_start',
  'team_debate_get',
  'team_debate_contribute',
  'team_debate_update',
  'team_task_create',
  'team_task_list',
  'team_task_get',
  'team_task_update',
  'team_template_list',
  'team_template_save',
  'team_template_delete',
].sort()

const roots: string[] = []
let callNumber = 0

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

async function setup(script: ConstructorParameters<typeof MockAdapter>[0], legacyControl = false) {
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx)
  const storageRoot = mkdtempSync(join(tmpdir(), 'dsh-tool-team-'))
  roots.push(storageRoot)
  const settingsRoot = mkdtempSync(join(tmpdir(), 'dsh-tool-team-settings-'))
  roots.push(settingsRoot)
  const settingsFile = join(settingsRoot, 'settings.yaml')
  await writeFile(settingsFile, '{}\n')
  await ctx.plugin(JsonlSessionPersistence, { root: storageRoot })
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(SubagentService)
  if (legacyControl) await ctx.plugin(ToolSubagentControl)
  await ctx.plugin(SubagentSpawn, { providerName: 'spawn' })
  await ctx.plugin(SubagentFork, { providerName: 'fork' })
  await ctx.plugin(TeamService)
  await ctx.plugin(FileSettingsProvider, { path: settingsFile })
  // Register the agent-team-templates namespace with its schema
  ctx.inject(['settings'], (settingsCtx) => {
    settingsCtx.settings.register(
      settingsNamespace(TEAM_TEMPLATE_SETTINGS_NAMESPACE),
      TeamTemplateSettingsSchema,
      { validate: validateTeamTemplateSettings },
    )
  })
  const fiber = await ctx.plugin(toolTeam)
  const adapter = new MockAdapter(script)
  ctx.llm.registerAdapter(['mock'], adapter)
  const lead = ctx.agentLoop.create(SessionId('tool-team-lead'), { provider: 'mock', model: 'mock' })
  return { ctx, lead, fiber }
}

function execute(
  ctx: Context,
  agent: Agent | undefined,
  name: string,
  args: unknown,
  signal: AbortSignal = SIGNAL,
) {
  return ctx.tools.execute({
    callId: CallId(`team-call-${++callNumber}`),
    name,
    arguments: args,
    signal,
    ...agent === undefined ? {} : { agent },
  })
}

function text(result: Awaited<ReturnType<typeof execute>>): string {
  return result.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('')
}

function spawnedChildId(result: Awaited<ReturnType<typeof execute>>): SessionId {
  const parsed: unknown = JSON.parse(text(result))
  if (typeof parsed !== 'object' || parsed === null || !('member' in parsed)) {
    throw new Error('spawn_teammate result has no member')
  }
  const member = parsed.member
  if (typeof member !== 'object' || member === null || !('id' in member) || typeof member.id !== 'string') {
    throw new Error('spawn_teammate result has no member id')
  }
  return SessionId(member.id)
}

async function assembly(ctx: Context, agent: Agent) {
  const scope = scopeOf(agent.ctx)
  if (scope === undefined) throw new Error('expected Agent scope')
  return ctx.systemPrompt.assemble({ scope })
}

async function waitRunning(ctx: Context, id: SessionId): Promise<Agent> {
  return vi.waitFor(() => {
    const child = ctx.agents.get(id)
    expect(child?.status).toBe('running')
    return child!
  }, { timeout: 5_000 })
}

async function waitNoAgent(ctx: Context, id: SessionId): Promise<void> {
  await vi.waitFor(() => { expect(ctx.agents.get(id)).toBeUndefined() }, { timeout: 5_000 })
}

describe('dsh-tool-team', { timeout: 60_000 }, () => {
  it('installs the complete scoped schema and shared-checkout policy for roots and teammates', async () => {
    const { ctx, lead } = await setup(['hang'])
    const leadAssembly = await assembly(ctx, lead)
    expect(leadAssembly.tools.map(schema => schema.name).filter(name => TOOL_NAMES.includes(name)).sort())
      .toEqual(TOOL_NAMES)
    const leadPrompt = renderPrompt(leadAssembly)
    expect(leadPrompt).toContain('You can configure and coordinate the entire team directly from chat instructions')
    expect(leadPrompt).toContain('FS_STALE_VERSION')
    expect(leadPrompt).toContain('Bash, formatters, code generators, and scripts are not fully protected')
    expect(leadPrompt).toContain('Task readiness never starts an owner')
    expect(leadPrompt).toContain('returns noProgress immediately')
    expect(leadPrompt).toContain('Your Team role is lead')

    const spawned = await execute(ctx, lead, 'spawn_teammate', {
      name: 'tool-worker',
      description: 'exercise scoped tools',
      prompt: 'stay available',
    })
    expect(spawned.isError).toBe(false)
    const childId = spawnedChildId(spawned)
    const child = await waitRunning(ctx, childId)
    const childAssembly = await assembly(ctx, child)
    expect(childAssembly.tools.map(schema => schema.name).filter(name => TOOL_NAMES.includes(name)).sort())
      .toEqual(TOOL_NAMES)
    expect(renderPrompt(childAssembly)).toContain('Your Team role is teammate; your Team name is tool-worker')

    const denied = await execute(ctx, child, 'spawn_teammate', {
      name: 'nested', description: 'not allowed', prompt: 'no',
    })
    expect(denied.isError).toBe(true)
    expect(text(denied)).toContain('only the Team Lead')
    await execute(ctx, lead, 'interrupt_agent', { target: 'tool-worker' })
    await vi.waitFor(() => { expect(ctx.agents.get(childId)).toBeUndefined() }, { timeout: 5_000 })
  })

  it('adapts heterogeneous routes and structured debate controls to canonical JSON', async () => {
    const { ctx, lead } = await setup(['hang'])
    const spawned = await execute(ctx, lead, 'spawn_teammate', {
      name: 'debate-worker',
      description: 'challenge the Lead position',
      prompt: 'stay available for debate',
      context: 'fresh',
      llm_provider: 'mock',
      model: 'alternate-model',
      persona: 'Skeptical verifier',
    })
    const childId = spawnedChildId(spawned)
    const child = await waitRunning(ctx, childId)
    expect(JSON.parse(text(spawned))).toMatchObject({
      member: {
        name: 'debate-worker',
        llmProvider: 'mock',
        model: 'alternate-model',
        persona: 'Skeptical verifier',
      },
    })
    expect(JSON.parse(text(await execute(ctx, lead, 'list_agents', {})))).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: 'debate-worker',
        llmProvider: 'mock',
        model: 'alternate-model',
        persona: 'Skeptical verifier',
      }),
    ]))

    const started = await execute(ctx, lead, 'team_debate_start', {
      topic: 'Which release strategy is safer?',
      participants: ['lead', 'debate-worker'],
      max_rounds: 1,
    })
    const initial = JSON.parse(text(started)) as { id: string; revision: number }
    expect(initial).toMatchObject({ revision: 1, phase: 'positions', status: 'active' })
    expect(JSON.parse(text(await execute(ctx, child, 'team_debate_get', {}))))
      .toMatchObject({ debate: { id: initial.id, revision: 1, phase: 'positions' } })

    const paused = JSON.parse(text(await execute(ctx, lead, 'team_debate_update', {
      debate_id: initial.id,
      expected_revision: initial.revision,
      action: 'pause',
      note: 'human review',
    }))) as { revision: number }
    expect(paused).toMatchObject({ revision: 2, status: 'paused' })
    expect((await execute(ctx, lead, 'team_debate_update', {
      debate_id: initial.id,
      expected_revision: paused.revision,
      action: 'advance',
    })).isError).toBe(true)
    const resumed = JSON.parse(text(await execute(ctx, lead, 'team_debate_update', {
      debate_id: initial.id,
      expected_revision: paused.revision,
      action: 'resume',
    }))) as { revision: number }
    expect(resumed).toMatchObject({ revision: 3, status: 'active' })

    const leadContribution = JSON.parse(text(await execute(ctx, lead, 'team_debate_contribute', {
      debate_id: initial.id,
      expected_revision: resumed.revision,
      content: 'Prefer the staged release because rollback stays bounded.',
    }))) as { revision: number }
    const workerContribution = JSON.parse(text(await execute(ctx, child, 'team_debate_contribute', {
      debate_id: initial.id,
      expected_revision: leadContribution.revision,
      content: 'Challenge: the migration still needs a compatibility window.',
    }))) as { revision: number }
    expect(JSON.parse(text(await execute(ctx, child, 'team_debate_get', {}))))
      .toMatchObject({ debate: { revision: workerContribution.revision, contributions: [
        { sequence: 1, author: 'lead', phase: 'positions' },
        { sequence: 2, author: 'debate-worker', phase: 'positions' },
      ] } })
    expect(JSON.parse(text(await execute(ctx, lead, 'team_debate_update', {
      debate_id: initial.id,
      expected_revision: workerContribution.revision,
      action: 'advance',
    })))).toMatchObject({ phase: 'critique', revision: workerContribution.revision + 1 })

    await execute(ctx, lead, 'interrupt_agent', { target: 'debate-worker' })
    await waitNoAgent(ctx, childId)
  })

  it('returns actionable no-progress output and renders structured wait cancellation', async () => {
    const inactiveSetup = await setup([textResponse('worker done')])
    const inactiveSpawn = await execute(inactiveSetup.ctx, inactiveSetup.lead, 'spawn_teammate', {
      name: 'inactive-worker', description: 'finish immediately', prompt: 'finish',
    })
    const inactiveId = spawnedChildId(inactiveSpawn)
    await waitNoAgent(inactiveSetup.ctx, inactiveId)
    const noProgress = await execute(inactiveSetup.ctx, inactiveSetup.lead, 'wait_agent', { timeout_ms: 3_600_000 })
    expect(noProgress.isError).toBe(false)
    expect(JSON.parse(text(noProgress))).toEqual({
      timedOut: false,
      noProgress: {
        reason: 'no-active-peer',
        message: 'No other Team member is running or provisioning. wait_agent cannot make progress or wake inactive teammates. Re-list with list_agents and team_task_list, then use followup_task to wake each required inactive teammate before waiting again.',
      },
    })
    for (const timeout_ms of [9_999, 3_600_001, Number.MAX_SAFE_INTEGER + 1]) {
      const invalid = await execute(inactiveSetup.ctx, inactiveSetup.lead, 'wait_agent', { timeout_ms })
      expect(invalid.isError).toBe(true)
      expect(text(invalid)).toContain('timeoutMs must be an integer from 10000 through 3600000')
    }

    const activeSetup = await setup(['hang'])
    const activeSpawn = await execute(activeSetup.ctx, activeSetup.lead, 'spawn_teammate', {
      name: 'active-worker', description: 'stay active', prompt: 'wait',
    })
    const activeId = spawnedChildId(activeSpawn)
    await waitRunning(activeSetup.ctx, activeId)
    const controller = new AbortController()
    const waiting = execute(activeSetup.ctx, activeSetup.lead, 'wait_agent', { timeout_ms: 10_000 }, controller.signal)
    await new Promise(resolve => setTimeout(resolve, 0))
    controller.abort({ kind: 'user' })
    const aborted = await waiting
    expect(aborted.isError).toBe(true)
    expect(text(aborted)).toBe("Error: wait_agent aborted: { kind: 'user' }")
    await execute(activeSetup.ctx, activeSetup.lead, 'interrupt_agent', { target: 'active-worker' })
    await waitNoAgent(activeSetup.ctx, activeId)
  })

  it('adapts roster, mailbox, wait, and task CAS operations to canonical JSON', async () => {
    const { ctx, lead } = await setup(['hang', textResponse('lead received wakeup')])
    const spawned = await execute(ctx, lead, 'spawn_teammate', {
      name: 'json-worker', description: 'json worker', prompt: 'wait', context: 'fresh',
    })
    const childId = spawnedChildId(spawned)
    const child = await waitRunning(ctx, childId)

    const roster = await execute(ctx, child, 'list_agents', {})
    expect(JSON.parse(text(roster))).toMatchObject([
      { name: 'lead', role: 'lead' },
      { name: 'json-worker', role: 'teammate' },
    ])
    // Every Team result reaches the model as compact JSON: indentation would
    // spend tokens on every roster, task, and receipt without adding meaning.
    expect(text(roster)).toBe(JSON.stringify(JSON.parse(text(roster))))
    const peer = await execute(ctx, child, 'send_message', { target: 'lead', message: 'quiet report' })
    expect(peer.isError).toBe(false)
    expect(JSON.parse(text(peer))).toMatchObject({ status: 'accepted' })
    const waking = await execute(ctx, child, 'followup_task', { target: 'lead', message: 'review the report' })
    expect(waking.isError).toBe(false)
    expect(JSON.parse(text(waking))).toMatchObject({ status: 'accepted' })
    await lead.whenIdle()

    const created = await execute(ctx, lead, 'team_task_create', {
      subject: 'tool task',
      description: 'created through tool',
      blocked_by: [],
      write_scopes: ['src/team'],
    })
    const task = JSON.parse(text(created)) as { id: string; revision: number }
    const listed = await execute(ctx, child, 'team_task_list', { ready: true, limit: 1 })
    expect(JSON.parse(text(listed))).toMatchObject({ tasks: [{ id: task.id, ready: true }] })
    const read = await execute(ctx, child, 'team_task_get', { task_id: task.id })
    expect(JSON.parse(text(read))).toMatchObject({ id: task.id, revision: 1 })
    const claimed = await execute(ctx, child, 'team_task_update', {
      task_id: task.id,
      expected_revision: task.revision,
      action: 'claim',
    })
    expect(JSON.parse(text(claimed))).toMatchObject({ status: 'in_progress', ownerName: 'json-worker' })
    const stale = await execute(ctx, lead, 'team_task_update', {
      task_id: task.id,
      expected_revision: task.revision,
      action: 'delete',
    })
    expect(stale.isError).toBe(true)
    expect(text(stale)).toContain('stale team task')

    const wait = execute(ctx, lead, 'wait_agent', { timeout_ms: 10_000 })
    const completedCall = new Promise<Awaited<ReturnType<typeof execute>>>((resolve, reject) => {
      setTimeout(() => {
        void execute(ctx, child, 'team_task_update', {
          task_id: task.id,
          expected_revision: 2,
          action: 'complete',
        }).then(resolve, reject)
      }, 0)
    })
    await expect(wait).resolves.toMatchObject({ isError: false })
    expect((await completedCall).isError).toBe(false)

    const childInterrupt = await execute(ctx, child, 'interrupt_agent', { target: 'json-worker' })
    expect(childInterrupt.isError).toBe(true)
    await execute(ctx, lead, 'interrupt_agent', { target: 'json-worker' })
    await vi.waitFor(() => { expect(ctx.agents.get(childId)).toBeUndefined() }, { timeout: 5_000 })
  })

  it('adapts optional task filters, mutations, pagination, and default waiting', async () => {
    const { ctx, lead } = await setup(['hang'])
    const spawned = await execute(ctx, lead, 'spawn_teammate', {
      name: 'fork-worker', description: 'fork worker', prompt: 'stay active', context: 'fork',
    })
    const childId = spawnedChildId(spawned)
    await waitRunning(ctx, childId)

    const firstResult = await execute(ctx, lead, 'team_task_create', {
      subject: 'first', description: 'first task',
    })
    const secondResult = await execute(ctx, lead, 'team_task_create', {
      subject: 'second', description: 'second task',
    })
    const first = JSON.parse(text(firstResult)) as { id: string; revision: number }
    const second = JSON.parse(text(secondResult)) as { id: string; revision: number }
    const claimed = await execute(ctx, lead, 'team_task_update', {
      task_id: first.id, expected_revision: first.revision, action: 'claim',
    })
    const claim = JSON.parse(text(claimed)) as { revision: number }

    expect(JSON.parse(text(await execute(ctx, lead, 'team_task_list', {
      status: 'in_progress', owner: 'lead', cursor: 0, limit: 1,
    })))).toMatchObject({ tasks: [{ id: first.id }] })
    expect(JSON.parse(text(await execute(ctx, lead, 'team_task_list', {
      owner: 'unowned', limit: 1,
    })))).toMatchObject({ tasks: [{ id: second.id }] })
    expect(JSON.parse(text(await execute(ctx, lead, 'team_task_list', {
      cursor: 0, limit: 1,
    })))).toMatchObject({ nextCursor: 1 })
    expect(JSON.parse(text(await execute(ctx, lead, 'team_task_list', {
      cursor: 1,
    })))).not.toHaveProperty('nextCursor')
    expect((await execute(ctx, lead, 'team_task_list', { cursor: -1 })).isError).toBe(true)
    expect((await execute(ctx, lead, 'team_task_list', { limit: 101 })).isError).toBe(true)

    const edited = await execute(ctx, lead, 'team_task_update', {
      task_id: first.id,
      expected_revision: claim.revision,
      action: 'edit',
      subject: 'edited',
      description: 'edited description',
      write_scopes: ['src/team'],
    })
    const edit = JSON.parse(text(edited)) as { revision: number }
    const dependencies = await execute(ctx, lead, 'team_task_update', {
      task_id: first.id,
      expected_revision: edit.revision,
      action: 'set_dependencies',
      blocked_by: [second.id],
    })
    expect(dependencies.isError).toBe(false)
    const dependency = JSON.parse(text(dependencies)) as { revision: number }
    expect((await execute(ctx, lead, 'team_task_update', {
      task_id: first.id,
      expected_revision: dependency.revision,
      action: 'reassign',
      owner: 'fork-worker',
    })).isError).toBe(true)

    const wait = execute(ctx, lead, 'wait_agent', {})
    const wake = new Promise<Awaited<ReturnType<typeof execute>>>((resolve, reject) => {
      setTimeout(() => {
        void execute(ctx, lead, 'team_task_create', {
          subject: 'wake', description: 'wake default wait',
        }).then(resolve, reject)
      }, 0)
    })
    expect((await wait).isError).toBe(false)
    expect((await wake).isError).toBe(false)

    await execute(ctx, lead, 'interrupt_agent', { target: 'fork-worker' })
    await vi.waitFor(() => { expect(ctx.agents.get(childId)).toBeUndefined() }, { timeout: 5_000 })
  })

  it('removes and reinstalls every scoped registration across plugin HMR without stopping the child', async () => {
    const { ctx, lead, fiber } = await setup(['hang'])
    const spawned = await execute(ctx, lead, 'spawn_teammate', {
      name: 'hmr-worker', description: 'hmr worker', prompt: 'wait',
    })
    const childId = spawnedChildId(spawned)
    const child = await waitRunning(ctx, childId)

    await fiber.dispose()
    expect((await assembly(ctx, lead)).tools.map(schema => schema.name).some(name => TOOL_NAMES.includes(name))).toBe(false)
    expect((await assembly(ctx, child)).tools.map(schema => schema.name).some(name => TOOL_NAMES.includes(name))).toBe(false)
    expect(ctx.agents.get(childId)).toBe(child)

    const replacement = await ctx.plugin(toolTeam)
    expect((await assembly(ctx, lead)).tools.map(schema => schema.name).filter(name => TOOL_NAMES.includes(name)).sort())
      .toEqual(TOOL_NAMES)
    expect((await assembly(ctx, child)).tools.map(schema => schema.name).filter(name => TOOL_NAMES.includes(name)).sort())
      .toEqual(TOOL_NAMES)
    await execute(ctx, lead, 'interrupt_agent', { target: 'hmr-worker' })
    await vi.waitFor(() => { expect(ctx.agents.get(childId)).toBeUndefined() }, { timeout: 5_000 })
    await replacement.dispose()
  })

  it('shadows legacy global control names only inside Team member scopes', async () => {
    const { ctx, lead, fiber } = await setup([], true)
    const teamSchema = (await assembly(ctx, lead)).tools.find(schema => schema.name === 'send_message')
    expect(JSON.stringify(teamSchema)).toContain('target')
    expect(JSON.stringify(teamSchema)).not.toContain('subagent_id')

    await fiber.dispose()
    const legacySchema = (await assembly(ctx, lead)).tools.find(schema => schema.name === 'send_message')
    expect(JSON.stringify(legacySchema)).toContain('subagent_id')
  })

  it('rolls back partial scoped installation after a same-scope collision', async () => {
    const { ctx, lead, fiber } = await setup([])
    await fiber.dispose()
    lead.ctx.tools.register(defineContentToolFixture({
      name: 'spawn_teammate',
      description: 'intentional collision',
      parameters: {},
      async execute() { return [{ type: 'text', text: 'collision' }] },
    }))

    await expect(ctx.plugin(toolTeam)).rejects.toThrow(/already registered/u)
    const assembled = await assembly(ctx, lead)
    expect(assembled.tools.filter(schema => TOOL_NAMES.includes(schema.name)).map(schema => schema.name))
      .toEqual(['spawn_teammate'])
    expect(renderPrompt(assembled)).not.toContain('Your Team role is lead')
  })

  it('resolves direct-apply defaults without Loader schema normalization', async () => {
    const { ctx, lead, fiber } = await setup([textResponse('ordinary child')])
    await fiber.dispose()
    toolTeam.apply(ctx, {})
    expect((await assembly(ctx, lead)).tools.map(schema => schema.name).filter(name => TOOL_NAMES.includes(name)).sort())
      .toEqual(TOOL_NAMES)
    const ordinary = await ctx.subagents.startContinuable({
      provider: 'spawn',
      label: 'ordinary child',
      request: { prompt: [{ type: 'text', text: 'finish' }], parent: lead },
      signal: SIGNAL,
    })
    await vi.waitFor(() => { expect(ctx.agents.get(ordinary.childId)).toBeUndefined() }, { timeout: 5_000 })
  })

  it('reinstalls Team scope before a cold-resumed teammate request', async () => {
    const { ctx, lead } = await setup([textResponse('first'), 'hang'])
    const spawned = await execute(ctx, lead, 'spawn_teammate', {
      name: 'cold-worker', description: 'cold worker', prompt: 'finish once',
    })
    const childId = spawnedChildId(spawned)
    await vi.waitFor(() => { expect(ctx.agents.get(childId)).toBeUndefined() }, { timeout: 5_000 })

    await ctx.agentTeams.sendMessage(lead, {
      target: 'cold-worker',
      content: [{ type: 'text', text: 'resume with Team scope' }],
      delivery: 'wakeup',
      signal: SIGNAL,
    })
    const resumed = await waitRunning(ctx, childId)
    expect((await assembly(ctx, resumed)).tools.map(schema => schema.name)
      .filter(name => TOOL_NAMES.includes(name)).sort()).toEqual(TOOL_NAMES)
    expect(renderPrompt(await assembly(ctx, resumed))).toContain('Your Team role is teammate; your Team name is cold-worker')
    await execute(ctx, lead, 'interrupt_agent', { target: 'cold-worker' })
    await vi.waitFor(() => { expect(ctx.agents.get(childId)).toBeUndefined() }, { timeout: 5_000 })
  })

  it('manages reusable teammate templates via team_template_save, list, delete', async () => {
    const { ctx, lead } = await setup([])

    // Initially no templates
    const emptyList = JSON.parse(text(await execute(ctx, lead, 'team_template_list', {})))
    expect(emptyList).toEqual({ templates: [] })

    // Save a template
    const saved = JSON.parse(text(await execute(ctx, lead, 'team_template_save', {
      title: 'Pesquisador Jurídico Sênior',
      name: 'pesquisador-juridico-senior',
      description: 'Pesquisa doutrina e jurisprudência',
      prompt: 'Pesquise o tema e retorne citações',
      context: 'fresh',
      llm_provider: 'deepseek',
      model: 'deepseek-chat',
      persona: 'Especialista em pesquisa jurídica',
    })))
    expect(saved.template).toMatchObject({
      title: 'Pesquisador Jurídico Sênior',
      name: 'pesquisador-juridico-senior',
      description: 'Pesquisa doutrina e jurisprudência',
      prompt: 'Pesquise o tema e retorne citações',
      context: 'fresh',
      llmProvider: 'deepseek',
      model: 'deepseek-chat',
      persona: 'Especialista em pesquisa jurídica',
    })
    expect(saved.template.id).toBeTruthy()

    // List templates
    const list = JSON.parse(text(await execute(ctx, lead, 'team_template_list', {})))
    expect(list.templates).toHaveLength(1)
    expect(list.templates[0].title).toBe('Pesquisador Jurídico Sênior')

    // Save another template with same title (should update)
    const saved2 = JSON.parse(text(await execute(ctx, lead, 'team_template_save', {
      title: 'Pesquisador Jurídico Sênior',
      name: 'pesquisador-juridico-senior',
      description: 'Atualizado: pesquisa doutrina, jurisprudência e legislação',
      prompt: 'Pesquise completamente',
      context: 'fork',
    })))
    expect(saved2.template.description).toContain('Atualizado')
    expect(saved2.template.context).toBe('fork')

    // List should still have 1
    const list2 = JSON.parse(text(await execute(ctx, lead, 'team_template_list', {})))
    expect(list2.templates).toHaveLength(1)
    expect(list2.templates[0].description).toContain('Atualizado')

    // Delete template
    const deleted = JSON.parse(text(await execute(ctx, lead, 'team_template_delete', {
      id: saved2.template.id,
    })))
    expect(deleted.deletedId).toBe(saved2.template.id)

    // List should be empty again
    const emptyAgain = JSON.parse(text(await execute(ctx, lead, 'team_template_list', {})))
    expect(emptyAgain.templates).toHaveLength(0)
  })

  it('spawns teammate from saved template via template_id', async () => {
    const { ctx, lead } = await setup(['hang'])

    // Save a template
    const saved = JSON.parse(text(await execute(ctx, lead, 'team_template_save', {
      title: 'Revisor de Contratos',
      description: 'Revisa cláusulas contratuais',
      prompt: 'Revise o contrato enviado',
      context: 'fresh',
      llm_provider: 'deepseek',
      model: 'deepseek-chat',
    })))
    const templateId = saved.template.id

    // Spawn teammate using template_id (omit name, description, prompt)
    const spawned = JSON.parse(text(await execute(ctx, lead, 'spawn_teammate', {
      template_id: templateId,
    })))
    expect(spawned.member).toMatchObject({
      name: 'revisor-de-contratos',
      description: 'Revisa cláusulas contratuais',
      llmProvider: 'deepseek',
      model: 'deepseek-chat',
    })

    // Spawn with override
    const spawned2 = JSON.parse(text(await execute(ctx, lead, 'spawn_teammate', {
      template_id: templateId,
      name: 'revisor-especial',
      description: 'Revisão especial',
      prompt: 'Prompt customizado',
      context: 'fork',
      model: 'gpt-5',
    })))
    expect(spawned2.member).toMatchObject({
      name: 'revisor-especial',
      description: 'Revisão especial',
      model: 'gpt-5',
    })
  }, 15000)

  it('manages and spawns multi-agent squads via team_squad_save, list, spawn, delete', async () => {
    const { ctx, lead } = await setup(['hang', 'hang'])

    // Save squad
    const saved = JSON.parse(text(await execute(ctx, lead, 'team_squad_save', {
      title: 'Esquadrão Jurídico Rápido',
      description: 'Pesquisador e Revisor trabalhando em conjunto',
      members: [
        {
          name: 'Pesquisador',
          description: 'Busca precedentes',
          prompt: 'Pesquise a jurisprudência',
          context: 'fresh',
          llm_provider: 'deepseek',
          model: 'deepseek-chat',
        },
        {
          name: 'Revisor',
          description: 'Audita minutas',
          prompt: 'Revise o texto final',
          context: 'fresh',
        },
      ],
    })))
    expect(saved.squad).toMatchObject({
      title: 'Esquadrão Jurídico Rápido',
      description: 'Pesquisador e Revisor trabalhando em conjunto',
    })
    expect(saved.squad.members).toHaveLength(2)
    expect(saved.squad.members[0].name).toBe('pesquisador')
    expect(saved.squad.members[1].name).toBe('revisor')

    // List squads
    const list = JSON.parse(text(await execute(ctx, lead, 'team_squad_list', {})))
    expect(list.squads).toHaveLength(1)
    expect(list.squads[0].title).toBe('Esquadrão Jurídico Rápido')

    // Spawn squad
    const spawned = JSON.parse(text(await execute(ctx, lead, 'team_squad_spawn', {
      squad_id: saved.squad.id,
    })))
    expect(spawned.spawnedMembers).toHaveLength(2)
    expect(spawned.spawnedMembers[0].name).toBe('pesquisador')
    expect(spawned.spawnedMembers[1].name).toBe('revisor')

    // Dismiss roster
    const dismissed = JSON.parse(text(await execute(ctx, lead, 'team_roster_dismiss', {})))
    expect(dismissed.dismissedCount).toBe(2)
    expect(dismissed.dismissedNames).toEqual(['pesquisador', 'revisor'])

    // Delete squad
    const deleted = JSON.parse(text(await execute(ctx, lead, 'team_squad_delete', {
      id: saved.squad.id,
    })))
    expect(deleted.deletedId).toBe(saved.squad.id)

    // List empty again
    const listAfter = JSON.parse(text(await execute(ctx, lead, 'team_squad_list', {})))
    expect(listAfter.squads).toHaveLength(0)
  }, 20000)

  it('normalizes natural names in spawn_teammate to lower-kebab-case', async () => {
    const { ctx, lead } = await setup(['hang', 'hang', 'hang'])

    // Natural name with spaces, accents, uppercase
    const spawned = JSON.parse(text(await execute(ctx, lead, 'spawn_teammate', {
      name: 'Revisor de Contratos - Sênior',
      description: 'Test normalization',
      prompt: 'Test prompt',
    })))
    expect(spawned.member.name).toBe('revisor-de-contratos-senior')

    // Name with underscores and special chars
    const spawned2 = JSON.parse(text(await execute(ctx, lead, 'spawn_teammate', {
      name: 'pesquisador_juridico (tributário)',
      description: 'Test normalization 2',
      prompt: 'Test prompt 2',
    })))
    expect(spawned2.member.name).toBe('pesquisador-juridico-tributario')

    // Name already in kebab-case should stay the same
    const spawned3 = JSON.parse(text(await execute(ctx, lead, 'spawn_teammate', {
      name: 'valid-name-123',
      description: 'Test normalization 3',
      prompt: 'Test prompt 3',
    })))
    expect(spawned3.member.name).toBe('valid-name-123')
  }, 20000)

  it('fails safely without a calling Agent and has the function-plugin export shape', async () => {
    const { ctx } = await setup([])
    const result = await execute(ctx, undefined, 'list_agents', {})
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('unknown tool "list_agents"')
    expect('default' in toolTeam).toBe(false)
    expect(toolTeam.name).toBe('tool-agent-team')
    expect(toolTeam.inject).toEqual(['agents', 'agentTeams', 'tools', 'systemPrompt'])
  })

  it('uses configured fresh and fork provider names', async () => {
    const { ctx, lead, fiber } = await setup([textResponse('custom')])
    await fiber.dispose()
    await ctx.plugin(SubagentSpawn, { providerName: 'team-fresh' })
    await ctx.plugin(toolTeam, { freshProvider: 'team-fresh', forkProvider: 'fork' })
    const result = await execute(ctx, lead, 'spawn_teammate', {
      name: 'custom-provider', description: 'custom provider', prompt: 'go',
    })
    expect(result.isError).toBe(false)
    const childId = spawnedChildId(result)
    await vi.waitFor(() => { expect(ctx.agents.get(childId)).toBeUndefined() }, { timeout: 10_000 })
    expect(ctx.agentTeams.listMembers(lead)[1]).toMatchObject({ provider: 'team-fresh' })
  }, 15000)
})
