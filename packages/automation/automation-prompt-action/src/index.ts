/**
 * The `CUSTOM_PROMPT` executor for the automation engine: each due run opens
 * one ordinary root Session in the task's workspace and sends it the task's
 * prompt, the same fire-and-forget transaction the webhook runtime performs.
 * The run is recorded successful once the prompt is admitted; the Session
 * then lives its normal life under `ctx.agents`.
 *
 * @module @deepseek-ai/dsh-automation-prompt-action
 */

import { randomUUID } from 'node:crypto'
import { isAbsolute } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { ModelSelection } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import type {} from '@deepseek-ai/dsh-agent-presets'
import type { TaskExecutionContext } from '@deepseek-ai/dsh-automation'
import { brandString } from '@deepseek-ai/dsh-brand'
import { boundContextSummary, createUserMessage, errorChain, type LlmCallConfig } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-permission-presets'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-title'
import type {} from '@deepseek-ai/dsh-workspace'

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    /** Programmatic input admitted by one automation run. */
    automation: {
      readonly kind: 'automation'
      readonly taskId: string
      readonly runId: string
      readonly form: 'notice'
      readonly summary: string
    }
  }
}

/** Cordis plugin name. */
export const name = 'automation-prompt-action'
/** Services one run needs: the engine that hosts the handler and the Session-creation seams. */
export const inject = [
  'automation',
  'agents',
  'agentDefaultModel',
  'agentPresets',
  'permissionPresets',
  'sessionTitle',
  'workspaceRegistry',
]

/** Deployment policy for the Sessions this executor opens. */
export interface Config {
  /** Handler key registered on the worker; tasks reference it as `actionType`. */
  readonly actionType?: string
  /** Agent preset every run mounts; omitted, the roster default applies. */
  readonly agentPreset?: string
  /** Permission preset every run's Session gets; omitted, the deployment default applies. */
  readonly permissionPreset?: string
}

/** Loader schema; every field has a deployment default. */
export const Config: z<Config> = z.object({
  actionType: z.string().default('CUSTOM_PROMPT'),
  agentPreset: z.string(),
  permissionPreset: z.string(),
})

/** What a `CUSTOM_PROMPT` task carries in `actionPayload`. */
export interface PromptActionPayload {
  /** Instruction the new Session receives. */
  readonly prompt: string
  /** Absolute workspace directory the Session opens in. */
  readonly workspacePath: string
  /** Session title; defaults to the task title. */
  readonly title?: string
  /** Per-task preset override. */
  readonly agentPreset?: string
  /** Per-task permission preset override. */
  readonly permissionPreset?: string
}

/** The one value a successful run records. */
export interface PromptActionResult {
  readonly sessionId: string
}

/** Require one non-empty string field from an untyped payload. */
function requiredString(record: Record<string, unknown>, field: string): string {
  const value = record[field]
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`automation prompt action: payload.${field} must be a non-empty string`)
  }
  return value
}

/** One optional string field; anything else than a string or absence is rejected. */
function optionalString(record: Record<string, unknown>, field: string): string | undefined {
  const value = record[field]
  if (value === undefined) return undefined
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`automation prompt action: payload.${field} must be a non-empty string when present`)
  }
  return value
}

/**
 * Validate a task payload before crossing any await.
 * @param payload - the persisted `actionPayload` of the due task.
 * @returns the typed payload.
 */
export function resolvePayload(payload: Record<string, unknown>): PromptActionPayload {
  const workspacePath = requiredString(payload, 'workspacePath')
  if (!isAbsolute(workspacePath)) {
    throw new TypeError(`automation prompt action: payload.workspacePath must be absolute, got ${JSON.stringify(workspacePath)}`)
  }
  const title = optionalString(payload, 'title')
  const agentPreset = optionalString(payload, 'agentPreset')
  const permissionPreset = optionalString(payload, 'permissionPreset')
  return {
    prompt: requiredString(payload, 'prompt'),
    workspacePath,
    ...title === undefined ? {} : { title },
    ...agentPreset === undefined ? {} : { agentPreset },
    ...permissionPreset === undefined ? {} : { permissionPreset },
  }
}

/** Apply the creation-time selection until the Session's first durable request header exists. */
function installInitialModelSelection(agentCtx: Context, selection: ModelSelection): void {
  agentCtx.on('agent/request', async ({ agent }, next): Promise<LlmCallConfig> => {
    const resolved = await next()
    if (agent.session.requestHeader() !== undefined
      || resolved.provider !== selection.provider
      || resolved.model !== selection.model) return resolved
    const { reasoningEffort: _inheritedEffort, ...withoutInheritedEffort } = resolved
    return {
      ...withoutInheritedEffort,
      ...selection.reasoningEffort === undefined ? {} : { reasoningEffort: selection.reasoningEffort },
    }
  })
}

/** Log a rollback failure without replacing the operation's original failure. */
function reportRollbackFailure(ctx: Context, subject: string, error: unknown): void {
  ctx.logger.warn(`automation prompt action: ${subject} rollback failed: ${errorChain(error)}`)
}

/**
 * Create, attach, title, configure, and prompt one ordinary root Session for
 * one automation run. A failure after attachment rolls the attachment and the
 * Agent back and rethrows, so the run is recorded failed with the real cause.
 * @param ctx - untraced runtime context that owns the resulting Agent.
 * @param config - deployment policy with every default applied.
 * @param payload - validated task payload.
 * @param run - identity and title of the run, used for provenance and the Session title fallback.
 * @returns the new Session id.
 */
export async function openPromptSession(
  ctx: Context,
  config: Required<Pick<Config, 'actionType'>> & Config,
  payload: PromptActionPayload,
  run: Pick<TaskExecutionContext, 'runId' | 'taskId' | 'taskTitle'>,
): Promise<PromptActionResult> {
  const permissionPreset = payload.permissionPreset ?? config.permissionPreset ?? ctx.permissionPresets.defaultPreset
  ctx.permissionPresets.resolve(permissionPreset)
  const preset = await ctx.agentPresets.resolve(payload.agentPreset ?? config.agentPreset)
  await ctx.agentPresets.standingKeyFor(preset.id)
  const selected = ctx.agentDefaultModel.currentSelection()
  const modelSelection: ModelSelection = { ...selected }

  const workspace = await ctx.workspaceRegistry.create(payload.workspacePath)
  const sessionId = brandString<SessionId>(`automation-${randomUUID()}`)
  const handle = await ctx.agents.create({
    sessionId,
    meta: { cwd: workspace.path, agentPreset: preset.id },
    agentOptions: { provider: selected.provider, model: selected.model },
    setup: async (agentCtx) => {
      await ctx.agentPresets.mount(agentCtx, preset.id)
      installInitialModelSelection(agentCtx, modelSelection)
    },
  })

  let attached = false
  try {
    await workspace.attachSession(sessionId)
    attached = true
    ctx.permissionPresets.set(handle.agent.session, permissionPreset)
    ctx.sessionTitle.rename(handle.agent.session, payload.title ?? run.taskTitle)
    handle.agent.followup(createUserMessage({
      content: [{ type: 'text', text: payload.prompt }],
      source: {
        kind: 'automation',
        taskId: run.taskId,
        runId: run.runId,
        form: 'notice',
        summary: boundContextSummary(`automation task "${run.taskTitle}" run ${run.runId}`),
      },
    }))
  } catch (error: unknown) {
    if (attached) {
      try {
        await workspace.detachSession(sessionId)
      } catch (rollbackError: unknown) {
        reportRollbackFailure(ctx, `Workspace detach for Session "${sessionId}"`, rollbackError)
      }
    }
    try {
      await handle.dispose()
    } catch (rollbackError: unknown) {
      reportRollbackFailure(ctx, `Agent disposal for Session "${sessionId}"`, rollbackError)
    }
    throw error
  }
  return { sessionId }
}

/**
 * Register the executor on the engine's worker for the configured action type;
 * disposing the plugin fiber removes it again.
 * @param ctx - plugin context carrying the engine and the Session seams.
 * @param config - deployment policy; schemastery has applied the defaults.
 */
export function apply(ctx: Context, config: Config): void {
  // Copied field by field: the loader hands a schema instance, and spreading a
  // class instance would drop its prototype. Optionals stay absent when unset
  // (`exactOptionalPropertyTypes`).
  const resolved: Required<Pick<Config, 'actionType'>> & Config = {
    actionType: config.actionType ?? 'CUSTOM_PROMPT',
    ...config.agentPreset !== undefined ? { agentPreset: config.agentPreset } : {},
    ...config.permissionPreset !== undefined ? { permissionPreset: config.permissionPreset } : {},
  }
  ctx.effect(() => ctx.automation.worker.registerHandler(resolved.actionType, async (payload, run) => {
    const typed = resolvePayload(payload)
    run.log(`opening a "${typed.agentPreset ?? resolved.agentPreset ?? 'default'}" session in ${typed.workspacePath}`)
    const result = await openPromptSession(ctx, resolved, typed, run)
    run.log(`prompt admitted by session ${result.sessionId}`)
    return { sessionId: result.sessionId }
  }), `automation-prompt-action: ${resolved.actionType} handler`)
}
