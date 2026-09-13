import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AutomationService from '@deepseek-ai/dsh-automation'
import { apply, inject, openPromptSession, resolvePayload } from '../src/index.ts'

interface HarnessOptions {
  failAt?: 'attach' | 'title' | 'followup'
}

interface Harness {
  readonly ctx: Context
  readonly calls: string[]
  readonly messages: unknown[]
}

/** Fake every Session-creation seam the executor injects; records the order it drives them in. */
function harness(options: HarnessOptions = {}): Harness {
  const calls: string[] = []
  const messages: unknown[] = []
  const session = { id: 'automation-session', header: { cwd: '/workspace' }, requestHeader: () => undefined }
  const agent = {
    id: 'automation-session',
    session,
    followup(message: unknown) {
      calls.push('followup')
      if (options.failAt === 'followup') throw new Error('followup failed')
      messages.push(message)
    },
  }
  const workspace = {
    path: '/workspace',
    async attachSession() {
      calls.push('attach')
      if (options.failAt === 'attach') throw new Error('attach failed')
    },
    async detachSession() { calls.push('detach') },
  }
  const fake = {
    logger: { warn: vi.fn() },
    permissionPresets: {
      defaultPreset: 'workspace-write',
      resolve(name: string) { calls.push(`permission-resolve:${name}`); return {} },
      set(_session: unknown, name: string) { calls.push(`permission-set:${name}`) },
    },
    agentDefaultModel: {
      currentSelection() { calls.push('default-model'); return { provider: 'p', model: 'm' } },
    },
    agentPresets: {
      async resolve(name?: string) { calls.push(`preset-resolve:${name ?? '<default>'}`); return { id: name ?? 'standard' } },
      async standingKeyFor(name: string) { calls.push(`standing:${name}`); return {} },
      async mount(_agentCtx: unknown, name: string) { calls.push(`mount:${name}`); return { id: name } },
    },
    workspaceRegistry: {
      async create(path: string) { calls.push(`workspace:${path}`); return workspace },
    },
    agents: {
      async create(createOptions: { setup?: (ctx: unknown, agent: unknown) => Promise<void> }) {
        calls.push('agent-create')
        await createOptions.setup?.({ on() { return () => {} } }, agent)
        return { agent, async dispose() { calls.push('dispose') } }
      },
    },
    sessionTitle: {
      rename(_session: unknown, title: string) {
        calls.push(`title:${title}`)
        if (options.failAt === 'title') throw new Error('title failed')
        return {}
      },
    },
  }
  return { ctx: fake as unknown as Context, calls, messages }
}

const run = { runId: 'run-1', taskId: 'task-1', taskTitle: 'Revisar prazos' }

describe('resolvePayload', () => {
  it('requires a prompt and an absolute workspace and keeps only present overrides', () => {
    expect(resolvePayload({ prompt: 'p', workspacePath: resolve('/w'), title: 'T' }))
      .toEqual({ prompt: 'p', workspacePath: resolve('/w'), title: 'T' })
    expect(() => resolvePayload({ workspacePath: resolve('/w') })).toThrow('payload.prompt')
    expect(() => resolvePayload({ prompt: 'p', workspacePath: 'relative' })).toThrow('must be absolute')
    expect(() => resolvePayload({ prompt: 'p', workspacePath: resolve('/w'), agentPreset: 7 })).toThrow('payload.agentPreset')
  })
})

describe('openPromptSession', () => {
  it('preflights, mounts, attaches, titles with the task title, and prompts with automation provenance', async () => {
    const test = harness()
    const result = await openPromptSession(test.ctx, { actionType: 'CUSTOM_PROMPT' }, { prompt: 'Faça X', workspacePath: '/workspace' }, run)
    expect(result.sessionId).toMatch(/^automation-/)
    expect(test.calls).toEqual([
      'permission-resolve:workspace-write',
      'preset-resolve:<default>',
      'standing:standard',
      'default-model',
      'workspace:/workspace',
      'agent-create',
      'mount:standard',
      'attach',
      'permission-set:workspace-write',
      'title:Revisar prazos',
      'followup',
    ])
    expect(test.messages).toEqual([expect.objectContaining({
      role: 'user',
      content: [{ type: 'text', text: 'Faça X' }],
      source: { kind: 'automation', taskId: 'task-1', runId: 'run-1', form: 'notice', summary: 'automation task "Revisar prazos" run run-1' },
    })])
  })

  it('lets the payload override the deployment preset, permission, and title', async () => {
    const test = harness()
    await openPromptSession(
      test.ctx,
      { actionType: 'CUSTOM_PROMPT', agentPreset: 'ptc', permissionPreset: 'danger-full-access' },
      { prompt: 'p', workspacePath: '/workspace', title: 'Custom', agentPreset: 'minimal', permissionPreset: 'workspace-write' },
      run,
    )
    expect(test.calls).toContain('preset-resolve:minimal')
    expect(test.calls).toContain('permission-set:workspace-write')
    expect(test.calls).toContain('title:Custom')
  })

  it('rolls the attachment and the Agent back when the prompt is refused', async () => {
    const test = harness({ failAt: 'followup' })
    await expect(openPromptSession(test.ctx, { actionType: 'CUSTOM_PROMPT' }, { prompt: 'p', workspacePath: '/workspace' }, run))
      .rejects.toThrow('followup failed')
    expect(test.calls.slice(-2)).toEqual(['detach', 'dispose'])
  })

  it('disposes the Agent without detaching when attachment itself failed', async () => {
    const test = harness({ failAt: 'attach' })
    await expect(openPromptSession(test.ctx, { actionType: 'CUSTOM_PROMPT' }, { prompt: 'p', workspacePath: '/workspace' }, run))
      .rejects.toThrow('attach failed')
    expect(test.calls).not.toContain('detach')
    expect(test.calls.at(-1)).toBe('dispose')
  })
})

describe('plugin', () => {
  let root: string

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-prompt-action-'))
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('registers the handler on the engine worker under the configured action type and removes it on dispose', async () => {
    const ctx = new Context()
    await ctx.plugin(AutomationService, { storePath: join(root, 'store.json'), enabled: false })
    expect(inject).toContain('automation')
    expect(ctx.automation.worker.hasHandler('CUSTOM_PROMPT')).toBe(false)
    // The Session seams are injected only when the handler actually runs; the
    // registration itself needs the engine alone.
    const fiber = ctx.plugin({ name: 'prompt-action-test', inject: ['automation'], apply }, { actionType: 'CUSTOM_PROMPT' })
    await fiber.await()
    expect(ctx.automation.worker.hasHandler('CUSTOM_PROMPT')).toBe(true)
    await fiber.dispose()
    expect(ctx.automation.worker.hasHandler('CUSTOM_PROMPT')).toBe(false)
  })
})
