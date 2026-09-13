/**
 * Model-facing Consumer of the `ctx.automation` engine: six tools that let an
 * agent create, list, trigger, pause, resume, and delete the deployment
 * owner's persisted tasks. Every write goes through the service's owner check,
 * so a task another owner holds is reported absent rather than touched.
 *
 * @module @deepseek-ai/dsh-tool-automation
 */

import type { Context } from '@deepseek-ai/cordis'
import { AutomationTaskNotFoundError } from '@deepseek-ai/dsh-automation'
import type { AutomationTaskView, CreateTaskDTO, TaskScheduleType } from '@deepseek-ai/dsh-automation'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'

/** Cordis plugin name. */
export const name = 'tool-automation'
/** Services the tools read: the registry they join and the engine they drive. */
export const inject = ['tools', 'automation']

/** Action type the prompt-session executor registers; the default for a created task. */
export const PROMPT_ACTION_TYPE = 'CUSTOM_PROMPT'

const SCHEDULE_TYPES: readonly TaskScheduleType[] = ['ONCE', 'INTERVAL', 'CRON', 'RRULE']

/** One task as the model sees it, matching `AutomationTaskView`. */
const TASK_VIEW_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string', required: true },
    title: { type: 'string', required: true },
    description: { type: 'string' },
    scheduleType: { type: 'string', required: true, enum: SCHEDULE_TYPES },
    status: { type: 'string', required: true, enum: ['ACTIVE', 'PAUSED', 'COMPLETED', 'ERROR', 'ARCHIVED'] },
    nextRunAt: { oneOf: [{ type: 'string' }, { type: 'null' }], required: true },
    lastRunAt: { oneOf: [{ type: 'string' }, { type: 'null' }], required: true },
    totalRunsCompleted: { type: 'integer', required: true },
    maxRuns: { oneOf: [{ type: 'integer' }, { type: 'null' }], required: true },
    createdAt: { type: 'string', required: true },
    updatedAt: { type: 'string', required: true },
  },
} as const

const TASK_ID_PARAMETER = {
  type: 'string',
  required: true,
  description: 'Task id as returned by automation_create_task or automation_list_tasks.',
} as const

/** Copy a view into the exact plain shape the output schema declares. */
function plainView(view: AutomationTaskView): AutomationTaskView {
  return {
    id: view.id,
    title: view.title,
    ...view.description === undefined ? {} : { description: view.description },
    scheduleType: view.scheduleType,
    status: view.status,
    nextRunAt: view.nextRunAt,
    lastRunAt: view.lastRunAt,
    totalRunsCompleted: view.totalRunsCompleted,
    maxRuns: view.maxRuns,
    createdAt: view.createdAt,
    updatedAt: view.updatedAt,
  }
}

/** Turn the engine's owner failure into the one-line message the model can act on. */
async function owned<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation()
  } catch (error: unknown) {
    if (error instanceof AutomationTaskNotFoundError) {
      throw new Error(`${error.message}. Call automation_list_tasks to see the tasks you own.`)
    }
    throw error
  }
}

/** Register the six task tools on the shared registry; disposal follows the plugin fiber. */
export function apply(ctx: Context): void {
  const automation = ctx.automation

  ctx.tools.register(defineTool({
    name: 'automation_create_task',
    description: 'Schedule a persistent task that survives restarts. By default the task opens a new session in a workspace '
      + 'and sends it `prompt` when due (action_type CUSTOM_PROMPT); the workspace defaults to this session\'s directory. '
      + 'schedule_expr depends on schedule_type: an ISO-8601 instant for ONCE, a number of seconds for INTERVAL, '
      + 'a five-field UTC cron line for CRON, or an RRULE string for RRULE.',
    parameters: {
      title: { type: 'string', required: true, description: 'Short human-readable task title.' },
      description: { type: 'string', description: 'Optional longer explanation shown in the task list.' },
      schedule_type: { type: 'string', required: true, enum: SCHEDULE_TYPES, description: 'How schedule_expr is read.' },
      schedule_expr: { type: 'string', required: true, description: 'ISO instant, seconds, cron line, or RRULE, per schedule_type.' },
      timezone: { type: 'string', description: 'IANA zone for RRULE evaluation, e.g. America/Sao_Paulo. Defaults to UTC.' },
      max_runs: { type: 'integer', description: 'Stop after this many completed runs. Omit for an open-ended schedule.' },
      prompt: { type: 'string', description: 'Instruction the new session receives on each run. Required when action_type is CUSTOM_PROMPT.' },
      workspace_path: { type: 'string', description: 'Absolute workspace directory the run\'s session opens in. Defaults to this session\'s directory.' },
      action_type: { type: 'string', description: `Executor key; defaults to ${PROMPT_ACTION_TYPE}. Another key needs a deployment-registered handler.` },
      action_payload: {
        type: 'object',
        additionalProperties: true,
        properties: {},
        description: 'Extra fields passed verbatim to the executor. For CUSTOM_PROMPT they merge with prompt and workspace_path.',
      },
    },
    output: {
      schema: TASK_VIEW_SCHEMA,
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    async execute(args, exec: ToolRunContext) {
      const actionType = args.action_type ?? PROMPT_ACTION_TYPE
      const workspacePath = args.workspace_path ?? exec.agent?.session.header.cwd
      if (actionType === PROMPT_ACTION_TYPE) {
        if (args.prompt === undefined || args.prompt.trim() === '') {
          throw new Error(`automation_create_task: prompt is required when action_type is ${PROMPT_ACTION_TYPE}`)
        }
        if (workspacePath === undefined) {
          throw new Error('automation_create_task: workspace_path is required because this session has no working directory')
        }
      }
      const dto: CreateTaskDTO = {
        userId: automation.owner,
        title: args.title,
        ...args.description === undefined ? {} : { description: args.description },
        scheduleType: args.schedule_type,
        scheduleExpr: args.schedule_expr,
        ...args.timezone === undefined ? {} : { timezone: args.timezone },
        ...args.max_runs === undefined ? {} : { maxRuns: args.max_runs },
        actionType,
        actionPayload: {
          ...args.action_payload ?? {},
          ...args.prompt === undefined ? {} : { prompt: args.prompt },
          ...workspacePath === undefined ? {} : { workspacePath },
        },
      }
      const task = await automation.store.createTask(dto)
      return plainView(await automation.taskView(task.id))
    },
  }))

  ctx.tools.register(defineTool({
    name: 'automation_list_tasks',
    description: 'List the persistent tasks this deployment owns, with status and next run time.',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: { tasks: { type: 'array', required: true, items: TASK_VIEW_SCHEMA } },
      },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    isConcurrencySafe: () => true,
    async execute() {
      return { tasks: (await automation.list()).map(plainView) }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'automation_trigger_task',
    description: 'Run a persistent task now, outside its schedule. Returns the run id; the run itself proceeds in the background.',
    parameters: { id: TASK_ID_PARAMETER },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: { runId: { type: 'string', required: true } },
      },
      render: (_args, value) => [{ type: 'text', text: `Run queued: ${value.runId}` }],
    },
    async execute(args) {
      return await owned(() => automation.triggerNow(args.id))
    },
  }))

  ctx.tools.register(defineTool({
    name: 'automation_pause_task',
    description: 'Pause a persistent task so the scheduler skips it until resumed.',
    parameters: { id: TASK_ID_PARAMETER },
    output: {
      schema: TASK_VIEW_SCHEMA,
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    async execute(args) {
      return plainView(await owned(() => automation.pauseTask(args.id)))
    },
  }))

  ctx.tools.register(defineTool({
    name: 'automation_resume_task',
    description: 'Resume a paused persistent task; its next run is recalculated from now.',
    parameters: { id: TASK_ID_PARAMETER },
    output: {
      schema: TASK_VIEW_SCHEMA,
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    async execute(args) {
      return plainView(await owned(() => automation.resumeTask(args.id)))
    },
  }))

  ctx.tools.register(defineTool({
    name: 'automation_delete_task',
    description: 'Delete a persistent task and its run history. This cannot be undone.',
    parameters: { id: TASK_ID_PARAMETER },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string', required: true },
          deleted: { type: 'boolean', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: value.deleted ? `Deleted task ${value.id}` : `Task ${value.id} was already gone` }],
    },
    async execute(args) {
      const deleted = await owned(() => automation.deleteTask(args.id))
      return { id: args.id, deleted }
    },
  }))
}
