import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import AgentRegistry, { type Agent } from '@deepseek-ai/dsh-agent'
import AutomationService from '@deepseek-ai/dsh-automation'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import * as toolAutomation from '@deepseek-ai/dsh-tool-automation'

const signal = new AbortController().signal
const TOOL_NAMES = [
  'automation_create_task',
  'automation_delete_task',
  'automation_list_tasks',
  'automation_pause_task',
  'automation_resume_task',
  'automation_trigger_task',
]

let root: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'dsh-tool-automation-'))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

/** Boot the registry, the engine (scheduler off), and the tools over one temp store. */
async function setup(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AutomationService, { storePath: join(root, 'store.json'), userId: 'host', enabled: false })
  await ctx.plugin(toolAutomation)
  return ctx
}

/** The calling agent's session directory is what CUSTOM_PROMPT defaults the workspace to. */
function agentIn(cwd: string): Agent {
  return { id: 'agent-1', session: { id: 'session-1', header: { cwd, delegationDepth: 0 } } } as unknown as Agent
}

async function call(ctx: Context, name: string, args: Record<string, unknown>, agent?: Agent) {
  const result = await ctx.tools.execute({
    signal,
    callId: ToolCallId(`${name}-${Math.random().toString(36).slice(2, 8)}`),
    name,
    arguments: args,
    ...agent === undefined ? {} : { agent },
  })
  const text = result.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('')
  const value = !result.isError && text.startsWith('{') ? JSON.parse(text) as Record<string, unknown> : undefined
  return { isError: result.isError, text, value }
}

describe('automation tools', () => {
  it('registers the six model-facing tools with strict argument roots', async () => {
    const ctx = await setup()
    const schemas = ctx.tools.schemas().filter(schema => schema.name.startsWith('automation_'))
    expect(schemas.map(schema => schema.name).sort()).toEqual(TOOL_NAMES)
    const create = schemas.find(schema => schema.name === 'automation_create_task')
    expect(create?.parameters).toMatchObject({
      type: 'object',
      required: ['title', 'schedule_type', 'schedule_expr'],
    })
  })

  it('creates a CUSTOM_PROMPT task for the deployment owner, defaulting the workspace to the caller cwd', async () => {
    const ctx = await setup()
    const created = await call(ctx, 'automation_create_task', {
      title: 'Revisar prazos',
      schedule_type: 'INTERVAL',
      schedule_expr: '3600',
      prompt: 'Liste os prazos da semana.',
    }, agentIn('/work/peticoes'))
    expect(created.isError).toBe(false)
    expect(created.value).toMatchObject({ title: 'Revisar prazos', status: 'ACTIVE', scheduleType: 'INTERVAL', maxRuns: null })

    const stored = await ctx.automation.store.getTask(created.value?.['id'] as string)
    expect(stored).toMatchObject({
      userId: 'host',
      actionType: 'CUSTOM_PROMPT',
      actionPayload: { prompt: 'Liste os prazos da semana.', workspacePath: '/work/peticoes' },
    })
  })

  it('refuses a CUSTOM_PROMPT task without a prompt or without any workspace', async () => {
    const ctx = await setup()
    const noPrompt = await call(ctx, 'automation_create_task', {
      title: 'x', schedule_type: 'INTERVAL', schedule_expr: '60',
    }, agentIn('/work'))
    expect(noPrompt.isError).toBe(true)
    expect(noPrompt.text).toContain('prompt is required')

    const noWorkspace = await call(ctx, 'automation_create_task', {
      title: 'x', schedule_type: 'INTERVAL', schedule_expr: '60', prompt: 'p',
    })
    expect(noWorkspace.isError).toBe(true)
    expect(noWorkspace.text).toContain('workspace_path is required')
    expect(await ctx.automation.list()).toEqual([])
  })

  it('lists, pauses, resumes, triggers, and deletes an owned task', async () => {
    const ctx = await setup()
    const created = await call(ctx, 'automation_create_task', {
      title: 'Ciclo', schedule_type: 'INTERVAL', schedule_expr: '60', prompt: 'p',
    }, agentIn('/work'))
    const id = created.value?.['id'] as string

    const listed = await call(ctx, 'automation_list_tasks', {})
    expect(listed.value).toMatchObject({ tasks: [{ id, status: 'ACTIVE' }] })

    const paused = await call(ctx, 'automation_pause_task', { id })
    expect(paused.value).toMatchObject({ id, status: 'PAUSED' })

    const resumed = await call(ctx, 'automation_resume_task', { id })
    expect(resumed.value).toMatchObject({ id, status: 'ACTIVE' })

    const triggered = await call(ctx, 'automation_trigger_task', { id })
    expect(triggered.isError).toBe(false)
    expect(triggered.text).toMatch(/^Run queued: run-/)
    // The run is fire-and-forget; let the worker record its (handler-less) failure
    // before the store is deleted from under it.
    for (let i = 0; i < 50 && (await ctx.automation.store.getTask(id))?.lastRunStatus === undefined; i++) {
      await new Promise(resolve => setTimeout(resolve, 20))
    }
    expect((await ctx.automation.store.getTask(id))?.lastRunStatus).toBe('FAILED')

    const deleted = await call(ctx, 'automation_delete_task', { id })
    expect(deleted.isError).toBe(false)
    expect(deleted.text).toBe(`Deleted task ${id}`)
    expect(await ctx.automation.list()).toEqual([])
  })

  it('reports a task owned by someone else as absent instead of touching it', async () => {
    const ctx = await setup()
    const foreign = await ctx.automation.store.createTask({
      userId: 'someone-else', title: 'Privada', scheduleType: 'INTERVAL', scheduleExpr: '60', actionType: 'CUSTOM_PROMPT',
    })
    for (const name of ['automation_pause_task', 'automation_resume_task', 'automation_trigger_task', 'automation_delete_task']) {
      const result = await call(ctx, name, { id: foreign.id })
      expect(result.isError, name).toBe(true)
      expect(result.text, name).toContain('automation_list_tasks')
    }
    expect((await ctx.automation.store.getTask(foreign.id))?.status).toBe('ACTIVE')
    const listed = await call(ctx, 'automation_list_tasks', {})
    expect(listed.value).toEqual({ tasks: [] })
  })
})
