/** Implicit-root Agent Teams service, durable peer mailbox, shared task DAG, and structured debates. */

import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-session-persistence'
import type {} from '@deepseek-ai/dsh-session-projection'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { TeamActivity } from './activity.ts'
import { TeamDebateBoard } from './debate.ts'
import { errorMessage, TeamError } from './error.ts'
import { TeamJournal } from './journal.ts'
import { TeamRuntimeLifecycle } from './lifecycle.ts'
import { TeamMailbox } from './mailbox.ts'
import { applyTeamProjection, teamProjectionSchema } from './projection.ts'
import { TeamRoster } from './roster.ts'
import type { TeamMembership } from './roster.ts'
import { TeamTaskBoard } from './task-board.ts'
import { TeamId, TeamTaskId } from './types.ts'
import type {
  Config,
  CreateTeamTaskRequest,
  GuideTeamMemberRemoteRequest,
  SendTeamMessageRequest,
  SendTeamMessageResult,
  SpawnTeamMemberRemoteRequest,
  SpawnTeammateRequest,
  SpawnTeammateResult,
  StartTeamDebateRequest,
  TeamDebateSnapshot,
  TeamMemberView,
  TeamTaskMutationResult,
  TeamTaskView,
  TeamView,
  TeamWaitResult,
  UpdateTeamDebateRequest,
  UpdateTeamTaskRequest,
} from './types.ts'

export type * from './types.ts'
export type { TeamMembership } from './roster.ts'
export { TeamDebateId, TeamId, TeamMessageId, TeamTaskId } from './types.ts'
export { TeamError } from './error.ts'
export { foldTeam } from './fold.ts'
export { applyTeamProjection, teamProjectionSchema } from './projection.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    agentTeams: TeamService
  }
}

const MAX_TEAMMATES = 9
const DEFAULT_MAX_MEMBERS = MAX_TEAMMATES
const DEFAULT_FRESH_PROVIDER = 'spawn'
const DEFAULT_FORK_PROVIDER = 'fork'
const DEFAULT_MAX_TASKS = 256
const DEFAULT_MAX_DEBATE_ROUNDS = 8
const DEFAULT_MAX_PENDING_MESSAGES = 64
const DEFAULT_MAX_MESSAGE_BYTES = 65_536
const DEFAULT_DISPOSAL_TIMEOUT_MS = 5_000

/** Validate one positive safe-integer deployment limit. */
function positiveLimit(name: string, value: number, maximum = Number.MAX_SAFE_INTEGER): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    const range = maximum === Number.MAX_SAFE_INTEGER ? 'a positive safe integer' : `an integer from 1 through ${maximum}`
    throw new TeamError(`${name} must be ${range}`, 'TEAM_INVALID_CONFIG')
  }
  return value
}

/** Validate one required provider name supplied outside Loader normalization. */
function providerName(name: string, value: string): string {
  const normalized = value.trim()
  if (normalized.length === 0 || normalized.length > 200) {
    throw new TeamError(`${name} must be a non-empty string of at most 200 characters`, 'TEAM_INVALID_CONFIG')
  }
  return normalized
}

/** Agent Teams service backed by the exact live Lead Session log. */
export class TeamService extends TypertRemoteService {
  static inject = ['agents', 'sessions', 'sessionPersistence', 'subagents']

  static Config: z<Config> = z.object({
    maxMembers: z.number().step(1).min(1).max(MAX_TEAMMATES).default(DEFAULT_MAX_MEMBERS),
    freshProvider: z.string().default(DEFAULT_FRESH_PROVIDER),
    forkProvider: z.string().default(DEFAULT_FORK_PROVIDER),
    maxTasks: z.number().step(1).min(1).default(DEFAULT_MAX_TASKS),
    maxDebateRounds: z.number().step(1).min(1).default(DEFAULT_MAX_DEBATE_ROUNDS),
    maxPendingMessagesPerMember: z.number().step(1).min(1).default(DEFAULT_MAX_PENDING_MESSAGES),
    maxMessageBytes: z.number().step(1).min(1).default(DEFAULT_MAX_MESSAGE_BYTES),
    disposalTimeoutMs: z.number().step(1).min(1).default(DEFAULT_DISPOSAL_TIMEOUT_MS),
  })

  /** Validated deployment limits used by every Team operation. */
  private readonly config: Required<Config>

  private readonly activity: TeamActivity
  private readonly lifecycle: TeamRuntimeLifecycle
  private readonly journal: TeamJournal
  private readonly roster: TeamRoster
  private readonly mailbox: TeamMailbox
  private readonly tasks: TeamTaskBoard
  private readonly debates: TeamDebateBoard

  constructor(ctx: Context, config: Config = {}) {
    super(ctx, 'agentTeams')
    this.config = {
      maxMembers: positiveLimit('maxMembers', config.maxMembers ?? DEFAULT_MAX_MEMBERS, MAX_TEAMMATES),
      freshProvider: providerName('freshProvider', config.freshProvider ?? DEFAULT_FRESH_PROVIDER),
      forkProvider: providerName('forkProvider', config.forkProvider ?? DEFAULT_FORK_PROVIDER),
      maxTasks: positiveLimit('maxTasks', config.maxTasks ?? DEFAULT_MAX_TASKS),
      maxDebateRounds: positiveLimit(
        'maxDebateRounds',
        config.maxDebateRounds ?? DEFAULT_MAX_DEBATE_ROUNDS,
      ),
      maxPendingMessagesPerMember: positiveLimit(
        'maxPendingMessagesPerMember',
        config.maxPendingMessagesPerMember ?? DEFAULT_MAX_PENDING_MESSAGES,
      ),
      maxMessageBytes: positiveLimit('maxMessageBytes', config.maxMessageBytes ?? DEFAULT_MAX_MESSAGE_BYTES),
      disposalTimeoutMs: positiveLimit(
        'disposalTimeoutMs',
        config.disposalTimeoutMs ?? DEFAULT_DISPOSAL_TIMEOUT_MS,
      ),
    }

    this.activity = new TeamActivity()
    this.lifecycle = new TeamRuntimeLifecycle(this.config.disposalTimeoutMs)
    this.journal = new TeamJournal(ctx, (root) => { this.activity.notify(TeamId(root.id)) })
    this.roster = new TeamRoster(ctx, this.journal, this.lifecycle, this.config.maxMembers)
    this.mailbox = new TeamMailbox(
      ctx,
      this.journal,
      this.roster,
      this.lifecycle,
      this.config.maxPendingMessagesPerMember,
      this.config.maxMessageBytes,
    )
    this.tasks = new TeamTaskBoard(this.journal, this.config.maxTasks)
    this.debates = new TeamDebateBoard(this.journal, this.roster, this.config.maxDebateRounds)

    ctx.inject(['sessionProjections'], (projectionCtx) => {
      projectionCtx.sessionProjections.register<'agentTeam', import('./types.ts').TeamProjection | null>({
        key: 'agentTeam',
        stateSchema: teamProjectionSchema.nullable(),
        init: () => null,
        apply: applyTeamProjection,
        wire: { viewSchema: teamProjectionSchema.nullable(), view: state => state },
        stateVersion: 1,
      })
    })

    ctx.on('session/event', (session, event) => { this.mailbox.observeSessionEvent(session, event) })
    ctx.on('agent/session-start', ({ agent }) => { this.scheduleRecovery(agent) })
    ctx.on('agent/status', ({ agent }) => {
      const membership = this.roster.tryMembership(agent)
      if (membership !== undefined) this.activity.notify(membership.id)
    })
    ctx.effect(() => () => this.disposeRuntime(), 'agentTeams.runtimeLifecycle()')
    for (const agent of ctx.agents.list()) this.scheduleRecovery(agent)
  }

  /**
   * Resolve one exact live Agent's Team role.
   * @param agent - exact live Agent used as the authority credential.
   * @returns its root, Team identity, role, and model-facing name.
   */
  membership(agent: Agent): TeamMembership {
    return this.roster.membership(agent)
  }

  /**
   * List the runtime-enriched roster visible to one Team member.
   * @param agent - exact live Team member.
   * @returns Lead and teammate rows in creation order.
   */
  @Remote('members')
  listMembers(agent: Agent): TeamMemberView[] {
    return this.roster.list(this.roster.membership(agent))
  }

  /**
   * Create one teammate from browser-safe text fields.
   * @param agent - exact live Lead Agent resolved by the Remote gateway.
   * @param request - identity, initial prompt, context, and optional LLM route.
   * @param signal - caller cancellation before the durable creation edge.
   * @returns the active roster row.
   */
  @Remote('spawn')
  async remoteSpawn(
    agent: Agent,
    request: SpawnTeamMemberRemoteRequest,
    signal: AbortSignal,
  ): Promise<SpawnTeammateResult> {
    return await this.spawnTeammate(agent, {
      ...request,
      prompt: [{ type: 'text', text: request.prompt }],
      provider: request.context === 'fork' ? this.config.forkProvider : this.config.freshProvider,
      signal,
    })
  }

  /**
   * Create one named, continuable direct child of the Team Lead.
   * @param caller - exact live Lead Agent.
   * @param request - immutable name, description, prompt, context mode, provider, and cancellation.
   * @returns the active roster row.
   */
  async spawnTeammate(caller: Agent, request: SpawnTeammateRequest): Promise<SpawnTeammateResult> {
    return await this.roster.spawn(caller, request)
  }

  /**
   * Queue one durable peer message, then attempt immediate delivery.
   * @param caller - exact live sending Team member.
   * @param request - target name, content, scheduling mode, and pre-queue cancellation.
   * @returns durable message identity and immediate-delivery observation.
   */
  async sendMessage(caller: Agent, request: SendTeamMessageRequest): Promise<SendTeamMessageResult> {
    return await this.mailbox.send(caller, request)
  }

  /**
   * Send browser-authored guidance through the durable Team mailbox.
   * @param agent - exact live Team member resolved by the Remote gateway.
   * @param request - target, plain text, and quiet-or-wakeup delivery.
   * @param signal - caller cancellation before the durable queue edge.
   * @returns durable message identity and immediate delivery observation.
   */
  @Remote('guide')
  async remoteGuide(
    agent: Agent,
    request: GuideTeamMemberRemoteRequest,
    signal: AbortSignal,
  ): Promise<SendTeamMessageResult> {
    return await this.sendMessage(agent, {
      ...request,
      content: [{ type: 'text', text: request.content }],
      signal,
    })
  }

  /**
   * Create one unowned pending task in the Team Lead log.
   * @param caller - exact live Team member creating the task.
   * @param request - task text, blockers, and advisory write scopes.
   * @returns the revision-one task view.
   */
  async createTask(caller: Agent, request: CreateTeamTaskRequest): Promise<TeamTaskView> {
    return await this.tasks.create(this.roster.membership(caller), request)
  }

  /**
   * Return one task, including a deleted tombstone.
   * @param caller - exact live Team member reading the task.
   * @param id - Team-local task identity.
   * @returns the latest task value and derived readiness diagnostics.
   */
  getTask(caller: Agent, id: TeamTaskId): TeamTaskView {
    return this.tasks.get(this.roster.membership(caller), id)
  }

  /**
   * List current non-deleted tasks in numeric creation order.
   * @param caller - exact live Team member reading the board.
   * @returns detached current task views.
   */
  listTasks(caller: Agent): TeamTaskView[] {
    return this.tasks.list(this.roster.membership(caller))
  }

  /**
   * Compare-and-set one authorized task transition.
   * @param caller - exact live Team member authorizing the mutation.
   * @param request - task identity, expected revision, action, and action fields.
   * @returns the committed next task revision.
   */
  async updateTask(caller: Agent, request: UpdateTeamTaskRequest): Promise<TeamTaskView> {
    return await this.tasks.update(caller, this.roster.membership(caller), request)
  }

  /**
   * Return the current structured debate visible to one Team member.
   * @param caller - exact live Team member reading the debate.
   * @returns the current debate, or undefined before one starts.
   */
  getDebate(caller: Agent): TeamDebateSnapshot | undefined {
    return this.debates.get(this.roster.membership(caller))
  }

  /**
   * Create one active structured debate.
   * @param agent - exact live Lead Agent authorizing creation.
   * @param request - topic, participants, and round limit.
   * @returns the committed initial debate snapshot.
   */
  @Remote('debateStart')
  async startDebate(agent: Agent, request: StartTeamDebateRequest): Promise<TeamDebateSnapshot> {
    return await this.debates.start(agent, request)
  }

  /**
   * Apply one Lead-authorized compare-and-set debate transition.
   * @param agent - exact live Lead Agent authorizing the transition.
   * @param request - debate identity, expected revision, action, and optional note.
   * @returns the committed next debate snapshot.
   */
  @Remote('debateUpdate')
  async updateDebate(agent: Agent, request: UpdateTeamDebateRequest): Promise<TeamDebateSnapshot> {
    return await this.debates.update(agent, request)
  }

  /**
   * Wait for the next Team-domain or member-status change.
   * @param caller - exact live Team member waiting for activity.
   * @param timeoutMs - bounded wait duration from ten seconds through one hour.
   * @param signal - caller cancellation for the wait only.
   * @returns one observed change or a timeout result.
   */
  async waitForChange(caller: Agent, timeoutMs: number, signal: AbortSignal): Promise<TeamWaitResult> {
    const membership = this.roster.membership(caller)
    return await this.activity.wait(membership.id, timeoutMs, signal)
  }

  /**
   * Interrupt one live teammate turn without clearing its pending inbox.
   * @param agent - exact live Lead Agent.
   * @param targetName - durable teammate name.
   * @returns the target status sampled before cancellation.
   */
  @Remote('interrupt')
  interrupt(agent: Agent, targetName: string): { previousStatus: 'running' | 'idle' | 'inactive' } {
    return this.roster.interrupt(agent, targetName)
  }

  /**
   * Resolve a caller without throwing, used by scoped-tool installation and observers.
   * @param agent - candidate exact live Agent.
   * @returns Team membership, or undefined for non-Team subagents and stale identities.
   */
  tryMembership(agent: Agent): TeamMembership | undefined {
    return this.roster.tryMembership(agent)
  }

  /**
   * Read the current roster and non-deleted task board through the generated Remote API.
   * @param agent - exact live Team member used as the authority credential.
   * @returns detached current roster and task views.
   */
  @Remote('view')
  remoteView(agent: Agent): TeamView {
    return {
      members: this.listMembers(agent),
      tasks: this.listTasks(agent),
    }
  }

  /**
   * Create one shared task through the generated Remote API.
   * @param agent - exact live Team member creating the task.
   * @param request - task text, blockers, and advisory write scopes.
   * @returns the revision-one task or a typed Team rejection.
   */
  @Remote('createTask')
  remoteCreateTask(agent: Agent, request: CreateTeamTaskRequest): Promise<TeamTaskMutationResult> {
    return this.taskMutationResult(this.createTask(agent, request))
  }

  /**
   * Apply one task mutation and preserve Team rejections as business results.
   * @param agent - exact live Team member authorizing the mutation.
   * @param request - task identity, expected revision, action, and action fields.
   * @returns the committed task or a typed Team rejection.
   */
  @Remote('updateTask')
  remoteUpdateTask(agent: Agent, request: UpdateTeamTaskRequest): Promise<TeamTaskMutationResult> {
    return this.taskMutationResult(this.updateTask(agent, request))
  }

  /** Preserve Team task rejections while allowing unexpected failures to reject the Remote call. */
  private async taskMutationResult(operation: Promise<TeamTaskView>): Promise<TeamTaskMutationResult> {
    try {
      return { ok: true, value: await operation }
    } catch (error) {
      if (!(error instanceof TeamError)) throw error
      return {
        ok: false,
        error: {
          code: error.code === 'TEAM_TASK_STALE_REVISION' ? 'team-task-conflict' : 'team-rejected',
          message: error.message,
        },
      }
    }
  }

  /** Queue one contained recovery pass after publication has unwound. */
  private scheduleRecovery(agent: Agent): void {
    queueMicrotask(() => {
      if (this.lifecycle.disposed) return
      void this.recoverFor(agent).catch((error: unknown) => {
        if (this.lifecycle.disposed) return
        this.ctx.logger.warn(`Agent Teams recovery for "${agent.id}" failed: ${errorMessage(error)}`)
      })
    })
  }

  /** Reconcile roster provisioning before retrying that member's pending mailbox. */
  private async recoverFor(agent: Agent): Promise<void> {
    await this.roster.recoverFor(agent, this.lifecycle.signal)
    await this.mailbox.recoverFor(agent, this.lifecycle.signal)
  }

  /** Stop Team-owned live branches and release every waiter before service disposal completes. */
  private async disposeRuntime(): Promise<void> {
    this.lifecycle.close()
    this.activity.close()

    const failures: unknown[] = []
    await this.lifecycle.settle(this.roster.pendingCreations(), failures)
    await this.lifecycle.settle(this.mailbox.pendingDispatches(), failures)
    for (const [root, childIds] of this.roster.liveChildrenByRoot()) {
      try {
        await this.roster.stopTeammates(root, childIds)
      } catch (error: unknown) {
        failures.push(error)
      }
    }
    if (failures.length > 0) throw new AggregateError(failures, 'Agent Teams runtime disposal failed')
  }
}

export default TeamService
