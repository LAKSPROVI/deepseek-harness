/** Scoped model-facing tools for the opt-in Agent Teams runtime. */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { TeamDebateId, TeamTaskId } from '@deepseek-ai/dsh-experimental-agent-team'
import type { TeamMemberView } from '@deepseek-ai/dsh-experimental-agent-team'
import type {
  SavedTeamSquad, SavedTeamTemplate, TeamTemplateSettings,
} from '@deepseek-ai/dsh-experimental-agent-team'
import {
  normalizeTeamMemberName, TEAM_TEMPLATE_SETTINGS_NAMESPACE,
} from '@deepseek-ai/dsh-experimental-agent-team'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { InferValue, ValueSchemaSpec } from '@deepseek-ai/dsh-tools'

/** Cordis plugin name. */
export const name = 'tool-agent-team'
/**
 * Services required by the Team tool plugin. The settings namespace is read
 * through `ctx.get` at call time: a composition without the settings service
 * keeps every Team tool installed, and template tools fail with a clear error
 * when called.
 */
export const inject = ['agents', 'agentTeams', 'tools', 'systemPrompt']

/** Tool routing configuration. */
export interface Config {
  /** Continuable-subagent provider used for fresh teammates. */
  readonly freshProvider?: string
  /** Continuable-subagent provider used for completed-prefix fork teammates. */
  readonly forkProvider?: string
}

/** Loader schema for the opt-in Team tool plugin. */
export const Config: z<Config> = z.object({
  freshProvider: z.string().default('spawn'),
  forkProvider: z.string().default('fork'),
})

/** Model-facing collaboration guidance shared by Lead and teammates. */
const POLICY = `Agent Teams is available in this session, but create teammates only when the user explicitly asks to use Agent Teams or teammates.

The Team Lead and all teammates share the same working directory and filesystem. Edits are immediately visible to every member. Split write work into disjoint scopes, record expected write scopes on shared tasks, and use task dependencies when work must be ordered. Write-scope overlap is advisory, not a lock.

Prefer read/edit/write for file changes. If a file operation returns FS_STALE_VERSION, read the current file, rebase your intended change onto the new content, and retry. Bash, formatters, code generators, and scripts are not fully protected by the filesystem version guard; coordinate them explicitly and have the Lead review the final diff and run tests.

send_message steers a running target at its nearest step boundary, starts an idle target, and cold-resumes an inactive teammate. A delivered peer item starts with its stable message id and sender name. A successful send is already durable even when its result says queued; do not resend it. Shared-task workflow is list, get, claim with the current revision, perform the work, then complete. Task readiness never starts an owner. Before wait_agent, use list_agents and make sure another required member is running or provisioning; use send_message first when the required member is inactive. wait_agent observes only changes after that call starts, never wakes a member, and returns noProgress immediately when no other member can produce a change. Re-list after wakeup or timeout. The Lead must wait for required teammates before giving the final answer.`

const ACTIVE_WAIT_STATUSES: ReadonlySet<TeamMemberView['status']> = new Set(['running', 'provisioning'])
const NO_ACTIVE_PEER_MESSAGE = 'No other Team member is running or provisioning. wait_agent cannot make progress or wake inactive teammates. Re-list with list_agents and team_task_list, then use send_message to wake each required inactive teammate before waiting again.'

/**
 * One roster row, matching `TeamMemberView`. The Lead pseudo-row omits the
 * teammate-only provisioning fields, so only identity, role, status, and
 * diagnostics are required.
 */
const MEMBER_VIEW_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string', required: true },
    name: { type: 'string', required: true },
    role: { type: 'string', required: true, enum: ['lead', 'teammate'] },
    status: { type: 'string', required: true, enum: ['running', 'idle', 'inactive', 'provisioning', 'failed'] },
    description: { type: 'string' },
    provider: { type: 'string' },
    context: { type: 'string', enum: ['fresh', 'fork'] },
    model: { type: 'string' },
    diagnostics: { type: 'array', required: true, items: { type: 'string' } },
  },
} as const

/** One shared task, matching the public `TeamTaskView`. */
const TASK_VIEW_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string', required: true },
    revision: { type: 'integer', required: true },
    subject: { type: 'string', required: true },
    description: { type: 'string', required: true },
    status: { type: 'string', required: true, enum: ['pending', 'in_progress', 'completed', 'deleted'] },
    ownerName: { type: 'string' },
    blockedBy: { type: 'array', required: true, items: { type: 'string' } },
    writeScopes: { type: 'array', required: true, items: { type: 'string' } },
    ready: { type: 'boolean', required: true },
    writeScopeWarnings: { type: 'array', required: true, items: { type: 'string' } },
  },
} as const

const SPAWN_VALUE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    member: { ...MEMBER_VIEW_SCHEMA, required: true },
  },
} as const

const MEMBER_LIST_VALUE_SCHEMA = { type: 'array', items: MEMBER_VIEW_SCHEMA } as const

const SEND_VALUE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    messageId: { type: 'string', required: true },
    status: { type: 'string', required: true, enum: ['accepted', 'queued'] },
  },
} as const

/** `noProgress` is present only on the model-only shortcut that skips the wait. */
const WAIT_VALUE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    timedOut: { type: 'boolean', required: true },
    noProgress: {
      type: 'object',
      additionalProperties: false,
      properties: {
        reason: { type: 'string', required: true, const: 'no-active-peer' },
        message: { type: 'string', required: true },
      },
    },
  },
} as const

const INTERRUPT_VALUE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    previousStatus: { type: 'string', required: true, enum: ['running', 'idle', 'inactive'] },
  },
} as const

const TASK_LIST_VALUE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    tasks: { type: 'array', required: true, items: TASK_VIEW_SCHEMA },
    nextCursor: { type: 'integer' },
  },
} as const

const TEMPLATE_VIEW_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string', required: true },
    title: { type: 'string', required: true },
    name: { type: 'string', required: true },
    description: { type: 'string', required: true },
    prompt: { type: 'string', required: true },
    context: { type: 'string', required: true, enum: ['fresh', 'fork'] },
    llmProvider: { type: 'string' },
    model: { type: 'string' },
    persona: { type: 'string' },
  },
} as const

const TEMPLATE_LIST_VALUE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    templates: { type: 'array', required: true, items: TEMPLATE_VIEW_SCHEMA },
  },
} as const

const TEMPLATE_SAVE_VALUE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    template: { ...TEMPLATE_VIEW_SCHEMA, required: true },
  },
} as const

const TEMPLATE_DELETE_VALUE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    deletedId: { type: 'string', required: true },
  },
} as const

const SQUAD_MEMBER_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    name: { type: 'string', required: true },
    description: { type: 'string', required: true },
    prompt: { type: 'string', required: true },
    context: { type: 'string', required: true, enum: ['fresh', 'fork'] },
    llmProvider: { type: 'string' },
    model: { type: 'string' },
    persona: { type: 'string' },
  },
} as const

const SQUAD_VIEW_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string', required: true },
    title: { type: 'string', required: true },
    description: { type: 'string', required: true },
    members: { type: 'array', required: true, items: SQUAD_MEMBER_SCHEMA },
  },
} as const

const SQUAD_LIST_VALUE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    squads: { type: 'array', required: true, items: SQUAD_VIEW_SCHEMA },
  },
} as const

const SQUAD_SAVE_VALUE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    squad: { ...SQUAD_VIEW_SCHEMA, required: true },
  },
} as const

const SQUAD_DELETE_VALUE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    deletedId: { type: 'string', required: true },
  },
} as const

const SQUAD_SPAWN_VALUE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    squadId: { type: 'string', required: true },
    spawnedMembers: { type: 'array', required: true, items: MEMBER_VIEW_SCHEMA },
  },
} as const

const ROSTER_DISMISS_VALUE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    dismissedCount: { type: 'integer', required: true },
    dismissedNames: { type: 'array', required: true, items: { type: 'string' } },
  },
} as const

const DEBATE_PHASE_SCHEMA = {
  type: 'string', enum: ['positions', 'critique', 'rebuttal', 'verification', 'synthesis'],
} as const

const DEBATE_TRANSITION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    revision: { type: 'integer', required: true },
    round: { type: 'integer', required: true },
    phase: { ...DEBATE_PHASE_SCHEMA, required: true },
    status: { type: 'string', required: true, enum: ['active', 'paused', 'completed'] },
    actor: { type: 'string', required: true },
    note: { type: 'string' },
  },
} as const

const DEBATE_VIEW_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string', required: true },
    revision: { type: 'integer', required: true },
    topic: { type: 'string', required: true },
    status: { type: 'string', required: true, enum: ['active', 'paused', 'completed'] },
    phase: { ...DEBATE_PHASE_SCHEMA, required: true },
    round: { type: 'integer', required: true },
    maxRounds: { type: 'integer', required: true },
    participants: { type: 'array', required: true, items: { type: 'string' } },
    history: { type: 'array', required: true, items: DEBATE_TRANSITION_SCHEMA },
  },
} as const

const DEBATE_GET_VALUE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: { debate: DEBATE_VIEW_SCHEMA },
} as const

/**
 * Declare one canonical output schema with compact model-facing JSON. Every
 * Team result is a fixed record, so the declared schema is what makes the
 * compiler check `execute` against the value the model is promised.
 * @param schema - canonical value schema for one tool.
 * @returns the `output` declaration accepted by {@link defineTool}.
 */
function jsonOutput<const S extends ValueSchemaSpec>(schema: S): {
  schema: S
  render: (args: unknown, value: InferValue<S>) => [{ type: 'text'; text: string }]
} {
  return {
    schema,
    render: (_args: unknown, value: InferValue<S>) => [{ type: 'text', text: JSON.stringify(value) }],
  }
}

/** Recover the exact caller guaranteed by Agent-scoped tool discovery. */
function callingAgent(agent: Agent | undefined, toolName: string): Agent {
  /* v8 ignore next 2 -- Team tools are registered only in an exact Agent scope, so discovery supplies this carrier. */
  if (agent === undefined) throw new Error(`${toolName} requires a calling Agent`)
  return agent
}

/** Register the complete Team tool set in one exact Agent scope. */
function install(agent: Agent, ctx: Context, config: Required<Config>): () => void {
  const scoped = agent.ctx
  const disposers: Array<() => unknown> = []
  const register = (disposer: () => unknown): void => { disposers.push(disposer) }
  try {
    register(scoped.systemPrompt.section({
      name: 'team:policy',
      order: scoped.systemPrompt.getSectionOrder('TEAM_POLICY'),
      text: POLICY,
    }))

    register(scoped.tools.register(defineTool({
      name: 'spawn_teammate',
      description: 'Create one named, durable teammate from custom parameters or from a saved template. Only the Team Lead may call this tool.',
      parameters: {
        name: { type: 'string', description: 'Unique teammate name or natural label (e.g. "revisor"). Required unless template_id is used.' },
        description: { type: 'string', description: 'Short description of the delegated responsibility. Required unless template_id is used.' },
        prompt: { type: 'string', description: 'Complete initial task for the teammate. Required unless template_id is used.' },
        template_id: { type: 'string', description: 'Optional saved teammate template ID. When provided, missing fields are populated from the saved template.' },
        context: {
          type: 'string',
          enum: ['fresh', 'fork'],
          description: 'fresh starts without Lead history; fork inherits completed Lead turns. Defaults to fresh.',
        },
        llm_provider: {
          type: 'string',
          description: 'Optional LLM adapter route (e.g. "openai", "deepseek", "anthropic"). Omit to inherit the Lead provider or template value.',
        },
        model: {
          type: 'string',
          description: 'Optional provider-owned model id (e.g. "gpt-5", "deepseek-chat"). Omit to inherit the Lead model or template value.',
        },
        persona: {
          type: 'string',
          description: 'Optional teammate-only system persona describing its role and constraints.',
        },
      },
      output: jsonOutput(SPAWN_VALUE_SCHEMA),
      async execute(args, exec) {
        const agent = callingAgent(exec.agent, 'spawn_teammate')
        let name = args.name
        let description = args.description
        let prompt = args.prompt
        let context = args.context
        let llmProvider = args.llm_provider
        let model = args.model
        let persona = args.persona

        if (args.template_id !== undefined) {
          const settings = ctx.get('settings')
          const settingsVal = settings?.get(TEAM_TEMPLATE_SETTINGS_NAMESPACE) as TeamTemplateSettings | undefined
          const found = settingsVal?.templates.find((t: SavedTeamTemplate) =>
            t.id === args.template_id || t.title.toLowerCase() === args.template_id?.toLowerCase(),
          )
          if (found === undefined) {
            throw new Error(`Template "${args.template_id}" not found in saved templates`)
          }
          name = name ?? found.name
          description = description ?? found.description
          prompt = prompt ?? found.prompt
          context = context ?? found.context
          llmProvider = llmProvider ?? found.llmProvider
          model = model ?? found.model
          persona = persona ?? found.persona
        }

        if (name === undefined || description === undefined || prompt === undefined) {
          throw new Error('spawn_teammate requires name, description, and prompt (either directly or via template_id)')
        }

        const resolvedContext = context ?? 'fresh'
        return await ctx.agentTeams.spawnTeammate(agent, {
          name: normalizeTeamMemberName(name),
          description,
          prompt: [
            { type: 'text', text: `<system-reminder>\nYou are teammate "${normalizeTeamMemberName(name).trim()}".\n</system-reminder>\n\n` },
            { type: 'text', text: prompt },
          ],
          context: resolvedContext,
          provider: resolvedContext === 'fork' ? config.forkProvider : config.freshProvider,
          ...(llmProvider === undefined ? {} : { llmProvider }),
          ...(model === undefined ? {} : { model }),
          ...(persona === undefined ? {} : { persona }),
          signal: exec.signal,
        })
      },
    })))

    register(scoped.tools.register(defineTool({
      name: 'send_message',
      description: 'Send one durable message to another Team member. A running target receives it at the nearest step boundary; an idle target starts a turn; an inactive teammate cold-resumes.',
      parameters: {
        target: { type: 'string', required: true, description: 'Team member name, or lead.' },
        message: { type: 'string', required: true, description: 'Self-contained message for the target.' },
      },
      output: jsonOutput(SEND_VALUE_SCHEMA),
      execute(args, exec) {
        return ctx.agentTeams.sendMessage(callingAgent(exec.agent, 'send_message'), {
          target: args.target,
          content: [{ type: 'text', text: args.message }],
          signal: exec.signal,
        })
      },
    })))

    register(scoped.tools.register(defineTool({
      name: 'list_agents',
      description: 'List the Lead and every durable teammate with current runtime status.',
      parameters: {},
      output: jsonOutput(MEMBER_LIST_VALUE_SCHEMA),
      async execute(_args, exec) {
        return Promise.resolve(ctx.agentTeams.listMembers(callingAgent(exec.agent, 'list_agents')))
      },
    })))

    register(scoped.tools.register(defineTool({
      name: 'wait_agent',
      description: 'Wait for the next teammate status, mailbox, or shared-task change after this call starts. This never wakes inactive members and returns noProgress immediately when no other member is running or provisioning. Re-list after wakeup or timeout instead of polling.',
      parameters: {
        timeout_ms: {
          type: 'integer',
          description: 'Wait duration in milliseconds, from 10000 through 3600000. Defaults to 30000.',
        },
      },
      output: jsonOutput(WAIT_VALUE_SCHEMA),
      async execute(args, exec) {
        const caller = callingAgent(exec.agent, 'wait_agent')
        const timeoutMs = args.timeout_ms ?? 30_000
        // Preserve TeamService's authoritative timeout validation before the
        // model-only no-progress shortcut.
        if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 10_000 || timeoutMs > 3_600_000) {
          return await ctx.agentTeams.waitForChange(caller, timeoutMs, exec.signal)
        }
        // The active-peer read and waiter registration must remain one synchronous
        // span; awaiting between them can lose the only peer-status edge.
        const hasActivePeer = ctx.agentTeams.listMembers(caller).some(member =>
          member.id !== caller.id && ACTIVE_WAIT_STATUSES.has(member.status))
        if (!hasActivePeer) {
          return {
            timedOut: false,
            noProgress: {
              reason: 'no-active-peer' as const,
              message: NO_ACTIVE_PEER_MESSAGE,
            },
          }
        }
        return await ctx.agentTeams.waitForChange(caller, timeoutMs, exec.signal)
      },
    })))

    register(scoped.tools.register(defineTool({
      name: 'interrupt_agent',
      description: 'Interrupt one teammate\'s current turn while preserving its pending inbox. Team Lead only.',
      parameters: {
        target: { type: 'string', required: true, description: 'Teammate name.' },
      },
      output: jsonOutput(INTERRUPT_VALUE_SCHEMA),
      async execute(args, exec) {
        return Promise.resolve(ctx.agentTeams.interrupt(
          callingAgent(exec.agent, 'interrupt_agent'),
          args.target,
        ))
      },
    })))

    register(scoped.tools.register(defineTool({
      name: 'team_task_create',
      description: 'Create one unowned pending task on the shared Team task board.',
      parameters: {
        subject: { type: 'string', required: true, description: 'Concise task title.' },
        description: { type: 'string', required: true, description: 'Complete task details and acceptance criteria.' },
        blocked_by: { type: 'array', items: { type: 'string' }, description: 'Task ids that must complete first.' },
        write_scopes: {
          type: 'array',
          items: { type: 'string' },
          description: 'Advisory workspace-relative file or directory prefixes this task expects to modify.',
        },
      },
      output: jsonOutput(TASK_VIEW_SCHEMA),
      async execute(args, exec) {
        return await ctx.agentTeams.createTask(callingAgent(exec.agent, 'team_task_create'), {
          subject: args.subject,
          description: args.description,
          ...args.blocked_by === undefined ? {} : { blockedBy: args.blocked_by.map(TeamTaskId) },
          ...args.write_scopes === undefined ? {} : { writeScopes: args.write_scopes },
        })
      },
    })))

    register(scoped.tools.register(defineTool({
      name: 'team_task_list',
      description: 'List shared tasks, including readiness, owner, revision, blockers, and write-scope warnings.',
      parameters: {
        status: {
          type: 'string',
          enum: ['pending', 'in_progress', 'completed'],
          description: 'Optional exact status filter.',
        },
        owner: { type: 'string', description: 'Optional member-name filter; use unowned for tasks without an owner.' },
        ready: { type: 'boolean', description: 'Optional readiness filter.' },
        cursor: { type: 'integer', description: 'Zero-based result offset. Defaults to 0.' },
        limit: { type: 'integer', description: 'Number of rows, 1 through 100. Defaults to 50.' },
      },
      output: jsonOutput(TASK_LIST_VALUE_SCHEMA),
      execute(args, exec) {
        const status = args.status
        const filtered = ctx.agentTeams.listTasks(callingAgent(exec.agent, 'team_task_list')).filter(task =>
          (status === undefined || task.status === status)
          && (args.owner === undefined || (args.owner === 'unowned' ? task.ownerName === undefined : task.ownerName === args.owner))
          && (args.ready === undefined || task.ready === args.ready))
        const cursor = args.cursor ?? 0
        const limit = args.limit ?? 50
        if (!Number.isSafeInteger(cursor) || cursor < 0) throw new Error('cursor must be a non-negative safe integer')
        if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new Error('limit must be an integer from 1 through 100')
        return Promise.resolve({
          tasks: filtered.slice(cursor, cursor + limit),
          ...(cursor + limit < filtered.length ? { nextCursor: cursor + limit } : {}),
        })
      },
    })))

    register(scoped.tools.register(defineTool({
      name: 'team_task_get',
      description: 'Read the complete latest value of one shared task before changing or executing it.',
      parameters: {
        task_id: { type: 'string', required: true, description: 'Shared task id.' },
      },
      output: jsonOutput(TASK_VIEW_SCHEMA),
      async execute(args, exec) {
        return Promise.resolve(ctx.agentTeams.getTask(
          callingAgent(exec.agent, 'team_task_get'),
          TeamTaskId(args.task_id),
        ))
      },
    })))

    register(scoped.tools.register(defineTool({
      name: 'team_task_update',
      description: 'Compare-and-set a shared task action using the latest revision from team_task_get or team_task_list.',
      parameters: {
        task_id: { type: 'string', required: true, description: 'Shared task id.' },
        expected_revision: { type: 'integer', required: true, description: 'Current task revision used as the CAS precondition.' },
        action: {
          type: 'string',
          required: true,
          enum: ['claim', 'release', 'edit', 'set_dependencies', 'complete', 'reopen', 'reassign', 'delete'],
          description: 'Task transition to apply.',
        },
        subject: { type: 'string', description: 'Replacement title for edit.' },
        description: { type: 'string', description: 'Replacement details for edit.' },
        blocked_by: { type: 'array', items: { type: 'string' }, description: 'Complete blocker list for set_dependencies.' },
        write_scopes: { type: 'array', items: { type: 'string' }, description: 'Replacement advisory write scopes for edit.' },
        owner: { type: 'string', description: 'Member name for Lead-only reassign; omit to unassign.' },
      },
      output: jsonOutput(TASK_VIEW_SCHEMA),
      async execute(args, exec) {
        return await ctx.agentTeams.updateTask(callingAgent(exec.agent, 'team_task_update'), {
          taskId: TeamTaskId(args.task_id),
          expectedRevision: args.expected_revision,
          action: args.action,
          ...args.subject === undefined ? {} : { subject: args.subject },
          ...args.description === undefined ? {} : { description: args.description },
          ...args.blocked_by === undefined ? {} : { blockedBy: args.blocked_by.map(TeamTaskId) },
          ...args.write_scopes === undefined ? {} : { writeScopes: args.write_scopes },
          ...args.owner === undefined ? {} : { owner: args.owner },
        })
      },
    })))

    register(scoped.tools.register(defineTool({
      name: 'team_template_list',
      description: 'List all reusable teammate templates saved in system settings.',
      parameters: {},
      output: jsonOutput(TEMPLATE_LIST_VALUE_SCHEMA),
      async execute(_args, _exec) {
        const settings = ctx.get('settings')
        const settingsVal = settings?.get(TEAM_TEMPLATE_SETTINGS_NAMESPACE) as TeamTemplateSettings | undefined
        return { templates: settingsVal?.templates ?? [] }
      },
    })))

    register(scoped.tools.register(defineTool({
      name: 'team_template_save',
      description: 'Save or update a reusable teammate template in settings so it can be reused across sessions and teams.',
      parameters: {
        id: { type: 'string', description: 'Optional unique template ID. If omitted, derived from title.' },
        title: { type: 'string', required: true, description: 'User-facing title for the template (e.g. "Pesquisador Jurídico Sênior").' },
        name: { type: 'string', description: 'Default member name. If omitted, derived from title.' },
        description: { type: 'string', required: true, description: 'Short description of the responsibility.' },
        prompt: { type: 'string', required: true, description: 'Default initial prompt/instructions for teammates created with this template.' },
        context: { type: 'string', enum: ['fresh', 'fork'], description: 'Default context mode (fresh or fork). Defaults to fresh.' },
        llm_provider: { type: 'string', description: 'Optional default LLM provider.' },
        model: { type: 'string', description: 'Optional default model ID.' },
        persona: { type: 'string', description: 'Optional default persona.' },
      },
      output: jsonOutput(TEMPLATE_SAVE_VALUE_SCHEMA),
      async execute(args, _exec) {
        const settings = ctx.get('settings')
        if (settings === undefined) throw new Error('Settings service is unavailable')
        const current = (settings.get(TEAM_TEMPLATE_SETTINGS_NAMESPACE) as TeamTemplateSettings | undefined)?.templates ?? []
        const normalizedName = normalizeTeamMemberName(args.name || args.title)
        const normalizedId = normalizeTeamMemberName(args.id || args.title)
        const template: SavedTeamTemplate = {
          id: normalizedId,
          title: args.title,
          name: normalizedName,
          description: args.description,
          prompt: args.prompt,
          context: args.context ?? 'fresh',
          ...(args.llm_provider === undefined ? {} : { llmProvider: args.llm_provider }),
          ...(args.model === undefined ? {} : { model: args.model }),
          ...(args.persona === undefined ? {} : { persona: args.persona }),
        }
        const updated = [...current.filter((item: SavedTeamTemplate) => item.id !== normalizedId), template]
        await settings.update(TEAM_TEMPLATE_SETTINGS_NAMESPACE, { templates: updated })
        return { template }
      },
    })))

    register(scoped.tools.register(defineTool({
      name: 'team_template_delete',
      description: 'Delete a reusable teammate template from settings by id or title.',
      parameters: {
        id: { type: 'string', required: true, description: 'Template id or title to delete.' },
      },
      output: jsonOutput(TEMPLATE_DELETE_VALUE_SCHEMA),
      async execute(args, _exec) {
        const settings = ctx.get('settings')
        if (settings === undefined) throw new Error('Settings service is unavailable')
        const settingsVal = settings.get(TEAM_TEMPLATE_SETTINGS_NAMESPACE) as TeamTemplateSettings | undefined
        const currentTemplates = settingsVal?.templates ?? []
        const currentSquads = settingsVal?.squads ?? []
        const target = currentTemplates.find((item: SavedTeamTemplate) =>
          item.id === args.id || item.title.toLowerCase() === args.id.toLowerCase())
        if (target === undefined) throw new Error(`Template "${args.id}" not found in saved templates`)
        const updated = currentTemplates.filter((item: SavedTeamTemplate) => item.id !== target.id)
        await settings.update(TEAM_TEMPLATE_SETTINGS_NAMESPACE, { templates: updated, squads: currentSquads })
        return { deletedId: target.id }
      },
    })))

    register(scoped.tools.register(defineTool({
      name: 'team_squad_list',
      description: 'List all reusable multi-agent squad presets saved in system settings.',
      parameters: {},
      output: jsonOutput(SQUAD_LIST_VALUE_SCHEMA),
      async execute(_args, _exec) {
        const settings = ctx.get('settings')
        const settingsVal = settings?.get(TEAM_TEMPLATE_SETTINGS_NAMESPACE) as TeamTemplateSettings | undefined
        return { squads: settingsVal?.squads ?? [] }
      },
    })))

    register(scoped.tools.register(defineTool({
      name: 'team_squad_save',
      description: 'Save or update a reusable multi-agent squad preset (1-9 members) in settings.',
      parameters: {
        id: { type: 'string', description: 'Optional unique squad ID. If omitted, derived from title.' },
        title: { type: 'string', required: true, description: 'User-facing title for the squad preset.' },
        description: { type: 'string', required: true, description: 'What this squad does when instantiated.' },
        members: {
          type: 'array', required: true,
          description: 'One to nine squad members with name, description, prompt, context, and optional provider/model/persona.',
        },
      },
      output: jsonOutput(SQUAD_SAVE_VALUE_SCHEMA),
      async execute(args, _exec) {
        const settings = ctx.get('settings')
        if (settings === undefined) throw new Error('Settings service is unavailable')
        const settingsVal = settings.get(TEAM_TEMPLATE_SETTINGS_NAMESPACE) as TeamTemplateSettings | undefined
        const currentSquads = settingsVal?.squads ?? []
        const currentTemplates = settingsVal?.templates ?? []
        const members = (args.members as Array<Record<string, unknown>>).map((member) => {
          const name = normalizeTeamMemberName(String(member.name ?? member.description ?? ''))
          return {
            name,
            description: String(member.description ?? ''),
            prompt: String(member.prompt ?? ''),
            context: (member.context === 'fork' ? 'fork' : 'fresh') as 'fresh' | 'fork',
            ...(member.llm_provider === undefined ? {} : { llmProvider: String(member.llm_provider) }),
            ...(member.model === undefined ? {} : { model: String(member.model) }),
            ...(member.persona === undefined ? {} : { persona: String(member.persona) }),
          }
        })
        const normalizedId = normalizeTeamMemberName(args.id || args.title)
        const squad = { id: normalizedId, title: args.title, description: args.description, members }
        const updated = [...currentSquads.filter((item: SavedTeamSquad) => item.id !== normalizedId), squad]
        await settings.update(TEAM_TEMPLATE_SETTINGS_NAMESPACE, { templates: currentTemplates, squads: updated })
        return { squad }
      },
    })))

    register(scoped.tools.register(defineTool({
      name: 'team_squad_delete',
      description: 'Delete a reusable squad preset from settings by id or title.',
      parameters: {
        id: { type: 'string', required: true, description: 'Squad id or title to delete.' },
      },
      output: jsonOutput(SQUAD_DELETE_VALUE_SCHEMA),
      async execute(args, _exec) {
        const settings = ctx.get('settings')
        if (settings === undefined) throw new Error('Settings service is unavailable')
        const settingsVal = settings.get(TEAM_TEMPLATE_SETTINGS_NAMESPACE) as TeamTemplateSettings | undefined
        const currentTemplates = settingsVal?.templates ?? []
        const currentSquads = settingsVal?.squads ?? []
        const target = currentSquads.find((item: SavedTeamSquad) =>
          item.id === args.id || item.title.toLowerCase() === args.id.toLowerCase())
        if (target === undefined) throw new Error(`Squad preset "${args.id}" not found in saved squads`)
        const updated = currentSquads.filter((item: SavedTeamSquad) => item.id !== target.id)
        await settings.update(TEAM_TEMPLATE_SETTINGS_NAMESPACE, { templates: currentTemplates, squads: updated })
        return { deletedId: target.id }
      },
    })))

    register(scoped.tools.register(defineTool({
      name: 'team_squad_spawn',
      description: 'Spawn an entire multi-agent squad preset in this session in one batch operation.',
      parameters: {
        squad_id: { type: 'string', required: true, description: 'Saved squad preset ID or title to instantiate.' },
      },
      output: jsonOutput(SQUAD_SPAWN_VALUE_SCHEMA),
      async execute(args, exec) {
        const agent = callingAgent(exec.agent, 'team_squad_spawn')
        const settings = ctx.get('settings')
        const settingsVal = settings?.get(TEAM_TEMPLATE_SETTINGS_NAMESPACE) as TeamTemplateSettings | undefined
        const found = settingsVal?.squads?.find((s: SavedTeamSquad) =>
          s.id === args.squad_id || s.title.toLowerCase() === args.squad_id?.toLowerCase(),
        )
        if (found === undefined) {
          throw new Error(`Squad preset "${args.squad_id}" not found in saved squads`)
        }
        const spawnedMembers: TeamMemberView[] = []
        for (const member of found.members) {
          const res = await ctx.agentTeams.spawnTeammate(agent, {
            name: normalizeTeamMemberName(member.name),
            description: member.description,
            prompt: [{ type: 'text', text: member.prompt }],
            context: member.context,
            provider: member.context === 'fork' ? config.forkProvider : config.freshProvider,
            ...(member.llmProvider === undefined ? {} : { llmProvider: member.llmProvider }),
            ...(member.model === undefined ? {} : { model: member.model }),
            ...(member.persona === undefined ? {} : { persona: member.persona }),
            signal: exec.signal,
          })
          spawnedMembers.push(res.member)
        }
        return {
          squadId: found.id,
          spawnedMembers,
        }
      },
    })))

    register(scoped.tools.register(defineTool({
      name: 'team_roster_dismiss',
      description: 'Interrupt and dismiss all active teammates, or specific named teammates, in one batch call to clean up the team.',
      parameters: {
        names: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional list of specific teammate names to dismiss. If omitted, all active teammates are dismissed.',
        },
      },
      output: jsonOutput(ROSTER_DISMISS_VALUE_SCHEMA),
      async execute(args, exec) {
        const agent = callingAgent(exec.agent, 'team_roster_dismiss')
        const membersList = ctx.agentTeams.listMembers(agent)
        const teammates = membersList.filter(m => m.role === 'teammate')
        const targetNames = args.names !== undefined && args.names.length > 0
          ? args.names.map(normalizeTeamMemberName)
          : teammates.map(m => m.name)

        const dismissedNames: string[] = []
        for (const name of targetNames) {
          try {
            ctx.agentTeams.interrupt(agent, name)
            dismissedNames.push(name)
          } catch {
            // Teammates already inactive are already dismissed.
          }
        }
        return {
          dismissedCount: dismissedNames.length,
          dismissedNames,
        }
      },
    })))

    register(scoped.tools.register(defineTool({
      name: 'team_debate_start',
      description: 'Start one structured Team debate. Team Lead only.',
      parameters: {
        topic: { type: 'string', required: true, description: 'Question or proposition the Team must debate.' },
        participants: {
          type: 'array', required: true, items: { type: 'string' },
          description: 'Two through ten unique Team member names, including lead when it participates.',
        },
        max_rounds: { type: 'integer', description: 'Maximum complete debate rounds. Defaults to 2.' },
      },
      output: jsonOutput(DEBATE_VIEW_SCHEMA),
      async execute(args, exec) {
        return await ctx.agentTeams.startDebate(callingAgent(exec.agent, 'team_debate_start'), {
          topic: args.topic,
          participants: args.participants,
          ...(args.max_rounds === undefined ? {} : { maxRounds: args.max_rounds }),
        })
      },
    })))

    register(scoped.tools.register(defineTool({
      name: 'team_debate_get',
      description: 'Read the current structured debate, its CAS revision, round, phase, status, and transition history.',
      parameters: {},
      output: jsonOutput(DEBATE_GET_VALUE_SCHEMA),
      async execute(_args, exec) {
        const debate = ctx.agentTeams.getDebate(callingAgent(exec.agent, 'team_debate_get'))
        return Promise.resolve(debate === undefined ? {} : { debate })
      },
    })))

    register(scoped.tools.register(defineTool({
      name: 'team_debate_update',
      description: 'Compare-and-set a structured debate transition. Team Lead only.',
      parameters: {
        debate_id: { type: 'string', required: true, description: 'Current debate id.' },
        expected_revision: { type: 'integer', required: true, description: 'Current debate revision.' },
        action: {
          type: 'string', required: true, enum: ['pause', 'resume', 'advance', 'complete'],
          description: 'Protocol transition. Pausing does not interrupt active model turns.',
        },
        note: { type: 'string', description: 'Short audit note about completed work or the human instruction.' },
      },
      output: jsonOutput(DEBATE_VIEW_SCHEMA),
      async execute(args, exec) {
        return await ctx.agentTeams.updateDebate(callingAgent(exec.agent, 'team_debate_update'), {
          debateId: TeamDebateId(args.debate_id),
          expectedRevision: args.expected_revision,
          action: args.action,
          ...(args.note === undefined ? {} : { note: args.note }),
        })
      },
    })))
  } catch (error: unknown) {
    for (const dispose of disposers.reverse()) void dispose()
    throw error
  }
  return () => {
    for (const dispose of disposers.reverse()) void dispose()
  }
}

/** Install Team tools in every live or subsequently published Team member scope. */
export function apply(ctx: Context, config: Config = {}): void {
  const resolved: Required<Config> = {
    freshProvider: config.freshProvider ?? 'spawn',
    forkProvider: config.forkProvider ?? 'fork',
  }
  const installed = new Map<Agent, () => void>()
  const maybeInstall = (agent: Agent): void => {
    if (installed.has(agent) || ctx.agentTeams.tryMembership(agent) === undefined) return
    installed.set(agent, install(agent, ctx, resolved))
  }
  for (const agent of ctx.agents.list()) maybeInstall(agent)
  ctx.on('agent/created', ({ agent }) => { maybeInstall(agent) })
  ctx.on('agent/disposed', ({ agent }) => {
    installed.get(agent)?.()
    installed.delete(agent)
  })
  ctx.effect(() => () => {
    for (const dispose of installed.values()) dispose()
    installed.clear()
  }, 'tool-team.scopedTools()')
}
