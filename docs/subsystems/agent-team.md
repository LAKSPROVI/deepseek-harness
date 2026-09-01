# Agent Teams

English | [中文](agent-team.zh.md)

Types shared by the stable implicit-root Team domain, model tools, Host adapters, and Web client. The [Agent Teams Agent Note](../../.agents/notes/implemented/feature/2026-08-05-agent-teams.md) owns identity, mailbox, task, debate, and shared-checkout decisions; this page records the literal durable forms from [`packages/subagent/agent-team/src/types.ts`](../../packages/subagent/agent-team/src/types.ts).

## Identity and roster

`TeamId` is the root `SessionId` under a distinct [brand](core.md#branded-ids). `TeamTaskId` is Team-local and monotonically allocated as `task-<n>`; `TeamMessageId` is globally random. A teammate's Session id remains its persistent identity, while `name` is an immutable model/UI label.

```ts type-equiv
/** Whole durable value written on every teammate lifecycle change. */
interface TeamMemberSnapshot {
  readonly id: SessionId
  readonly name: string
  readonly description: string
  /** Continuable-child transport, normally `spawn` or `fork`. */
  readonly provider: string
  /** LLM adapter route used by this teammate; absence inherits the Lead route. */
  readonly llmProvider?: string
  /** Provider-owned model id; absence inherits the Lead model. */
  readonly model?: string
  /** Child-only system persona; absence uses the mounted preset persona. */
  readonly persona?: string
  readonly context: 'fresh' | 'fork'
  readonly phase: TeamMemberPhase
  readonly error?: string
}
```

Every member starts in `provisioning` and reaches exactly one terminal roster phase, `active` or `failed`. Runtime `running`/`idle`/`inactive` status is derived separately and never rewrites this record. Optional `llmProvider`, `model`, and child-only `persona` values are durable teammate identity inputs, so cold resume restores them rather than inheriting a later Lead selection.

## Durable mailbox

The Lead Session first stores the complete queued message. A target receipt is acknowledged only after its pending inbox item or recorded user message is durable, leaving queued-minus-delivered as the recovery mailbox.

```ts type-equiv
/** One peer message retained until its target Session records it. */
interface TeamMessageSnapshot {
  readonly id: TeamMessageId
  readonly senderId: SessionId
  readonly senderName: string
  readonly targetId: SessionId
  readonly delivery: 'quiet' | 'wakeup'
  readonly content: ContentBlock[]
}
```

The target Session keeps message identity and sender attribution on both the pending inbox item and the eventual user message. Folding that source across inbox and history is the target-side de-duplication key; the model-visible framing repeats the id and sender.

```ts type-equiv
/** Source retained by the target Session for durable mailbox de-duplication. */
interface TeamMessageSource {
  readonly kind: 'team-message'
  readonly teamId: TeamId
  readonly messageId: TeamMessageId
  readonly senderId: SessionId
  readonly senderName: string
}
```

## Shared task DAG

Every task event stores a complete snapshot. `revision` is the compare-and-set value and increments by one per mutation. `blockedBy` edges must name non-deleted tasks and keep the graph acyclic. `writeScopes` are normalized advisory path prefixes rather than locks.

```ts type-equiv
/** Whole durable task snapshot; every mutation increments {@link revision}. */
interface TeamTaskSnapshot {
  readonly id: TeamTaskId
  readonly revision: number
  readonly subject: string
  readonly description: string
  readonly status: TeamTaskStatus
  readonly ownerId?: SessionId
  readonly blockedBy: TeamTaskId[]
  readonly writeScopes: string[]
}
```

`pending` is unstarted or released, `in_progress` carries an owner, `completed` satisfies blockers, and `deleted` is a retained tombstone. Views add owner name, readiness, and write-scope overlap warnings without changing the durable snapshot.

## Structured debate

A `TeamDebateSnapshot` stores one debate id, compare-and-set revision, topic, participant names, round, maximum rounds, current phase and status, and compact transition history. The ordered phases are `positions`, `critique`, `rebuttal`, `verification`, and `synthesis`; status is `active`, `paused`, or `completed`. Only the Lead starts or updates a debate. Every update carries the debate id and expected revision and applies `pause`, `resume`, `advance`, or `complete`; pausing the protocol does not interrupt active turns.

## Projection and replay

`foldTeam()` replays one root Session into the roster, task board, current debate, and queued-minus-delivered mailbox that Team operations read. It selects records by `TeamId`, so events inherited by an ordinary fork retain the ancestor id and never enter the new root's state. Session event `seq` and `time` remain the ordering and timing record; Team snapshots do not duplicate them.

The `agentTeam` projection exposes durable member snapshots, non-deleted task snapshots, and the current debate. It excludes mailbox records, which stay internal to delivery and recovery. Roster and task reads add live status, owner name, readiness, and write-scope warnings without changing durable snapshots. The package [README](../../packages/subagent/agent-team/README.md) owns operation, authorization, recovery, limits, and Web controls.

## Composition map

| Plane | Owner | Responsibility |
|---|---|---|
| Host domain | [`packages/subagent/agent-team`](../../packages/subagent/agent-team/README.md) | Team identity, roster, mailbox, task DAG, debate state, recovery, projection, and browser Remote methods. |
| Model adapter | [`packages/subagent/tool-agent-team`](../../packages/subagent/tool-agent-team/README.md) | Team policy and 13 scoped tools; mounted only by the `agent-teams` preset. |
| Agent preset | [`apps/cli/config/agent-presets/agent-teams`](../../apps/cli/config/agent-presets/agent-teams/agent.cordis.yml) | Lead persona and model-visible Team composition for one Session. |
| Browser view | [`packages/client/ui-subagent`](../../packages/client/ui-subagent/README.md) | Roster, task, and debate display plus spawn, guidance, interruption, and debate controls. |
| Transport assembly | `@deepseek-ai/dsh-api-remotes` and Typert | Generated `agentTeams` Client Remote over the generic Session-aware Host gateway. |
| Durable carrier | Lead Session log and `agentTeam` projection | Source of truth for replay; the projection is the browser-safe read model. |

The Host composition mounts the domain service even for ordinary presets so recovery and projection have one process-wide owner. The `agent-teams` preset adds only the model adapter and collaboration policy, keeping Team schemas and prompt cost out of unrelated Sessions.

## Operation and data flow

Teammate creation flows from the Lead tool or browser Remote into `TeamService`, which first reserves a durable member name, asks the selected continuable provider for a direct child, persists the child inbox, and then commits the active roster edge. Peer delivery commits a mailbox record in the Lead log before target admission; target-side message identity prevents retry duplication. Task and debate mutations use their current revisions as compare-and-set guards.

Session replay feeds `foldTeam()` and then the `agentTeam` projection. The Web client reads the latest projection from Session history, subscribes to later projection frames, and invokes mutations through the generated Remote. Mailbox content never crosses that projection. Model tools call the same Host service with the exact live Agent as the authority credential, so browser and model operations share persistence and authorization rather than maintaining parallel Team state.

The [user guide](../user/guide/agent-teams.md) owns human operation. The [operating cookbook](../cookbook/operating-agent-teams.md) owns the Lead/teammate coordination procedure. This page owns the data vocabulary, component map, and generated service reference.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxagentteams--teamservice"></a>

### `ctx.agentTeams` — `TeamService`

Agent Teams service backed by the exact live Lead Session log.

```ts cordis-catalog
/**
 * Resolve one exact live Agent's Team role.
 * @param agent - exact live Agent used as the authority credential.
 * @returns its root, Team identity, role, and model-facing name.
 */
membership(agent: Agent): TeamMembership

/**
 * List the runtime-enriched roster visible to one Team member.
 * @param agent - exact live Team member.
 * @returns Lead and teammate rows in creation order.
 */
@Remote('members') listMembers(agent: Agent): TeamMemberView[]

/**
 * Create one teammate from browser-safe text fields.
 * @param agent - exact live Lead Agent resolved by the Remote gateway.
 * @param request - identity, initial prompt, context, and optional LLM route.
 * @param signal - caller cancellation before the durable creation edge.
 * @returns the active roster row.
 */
@Remote('spawn') async remoteSpawn( agent: Agent, request: SpawnTeamMemberRemoteRequest, signal: AbortSignal, ): Promise<SpawnTeammateResult>

/**
 * Create one named, continuable direct child of the Team Lead.
 * @param caller - exact live Lead Agent.
 * @param request - immutable name, description, prompt, context mode, provider, and cancellation.
 * @returns the active roster row.
 */
async spawnTeammate(caller: Agent, request: SpawnTeammateRequest): Promise<SpawnTeammateResult>

/**
 * Queue one durable peer message, then attempt immediate delivery.
 * @param caller - exact live sending Team member.
 * @param request - target name, content, scheduling mode, and pre-queue cancellation.
 * @returns durable message identity and immediate-delivery observation.
 */
async sendMessage(caller: Agent, request: SendTeamMessageRequest): Promise<SendTeamMessageResult>

/**
 * Send browser-authored guidance through the durable Team mailbox.
 * @param agent - exact live Team member resolved by the Remote gateway.
 * @param request - target, plain text, and quiet-or-wakeup delivery.
 * @param signal - caller cancellation before the durable queue edge.
 * @returns durable message identity and immediate delivery observation.
 */
@Remote('guide') async remoteGuide( agent: Agent, request: GuideTeamMemberRemoteRequest, signal: AbortSignal, ): Promise<SendTeamMessageResult>

/**
 * Create one unowned pending task in the Team Lead log.
 * @param caller - exact live Team member creating the task.
 * @param request - task text, blockers, and advisory write scopes.
 * @returns the revision-one task view.
 */
async createTask(caller: Agent, request: CreateTeamTaskRequest): Promise<TeamTaskView>

/**
 * Return one task, including a deleted tombstone.
 * @param caller - exact live Team member reading the task.
 * @param id - Team-local task identity.
 * @returns the latest task value and derived readiness diagnostics.
 */
getTask(caller: Agent, id: TeamTaskId): TeamTaskView

/**
 * List current non-deleted tasks in numeric creation order.
 * @param caller - exact live Team member reading the board.
 * @returns detached current task views.
 */
listTasks(caller: Agent): TeamTaskView[]

/**
 * Compare-and-set one authorized task transition.
 * @param caller - exact live Team member authorizing the mutation.
 * @param request - task identity, expected revision, action, and action fields.
 * @returns the committed next task revision.
 */
async updateTask(caller: Agent, request: UpdateTeamTaskRequest): Promise<TeamTaskView>

/**
 * Return the current structured debate visible to one Team member.
 * @param caller - exact live Team member reading the debate.
 * @returns the current debate, or undefined before one starts.
 */
getDebate(caller: Agent): TeamDebateSnapshot | undefined

/**
 * Create one active structured debate.
 * @param agent - exact live Lead Agent authorizing creation.
 * @param request - topic, participants, and round limit.
 * @returns the committed initial debate snapshot.
 */
@Remote('debateStart') async startDebate(agent: Agent, request: StartTeamDebateRequest): Promise<TeamDebateSnapshot>

/**
 * Apply one Lead-authorized compare-and-set debate transition.
 * @param agent - exact live Lead Agent authorizing the transition.
 * @param request - debate identity, expected revision, action, and optional note.
 * @returns the committed next debate snapshot.
 */
@Remote('debateUpdate') async updateDebate(agent: Agent, request: UpdateTeamDebateRequest): Promise<TeamDebateSnapshot>

/**
 * Wait for the next Team-domain or member-status change.
 * @param caller - exact live Team member waiting for activity.
 * @param timeoutMs - bounded wait duration from ten seconds through one hour.
 * @param signal - caller cancellation for the wait only.
 * @returns one observed change or a timeout result.
 */
async waitForChange(caller: Agent, timeoutMs: number, signal: AbortSignal): Promise<TeamWaitResult>

/**
 * Interrupt one live teammate turn without clearing its pending inbox.
 * @param agent - exact live Lead Agent.
 * @param targetName - durable teammate name.
 * @returns the target status sampled before cancellation.
 */
@Remote('interrupt') interrupt(agent: Agent, targetName: string): { previousStatus: 'running' | 'idle' | 'inactive' }

/**
 * Resolve a caller without throwing, used by scoped-tool installation and observers.
 * @param agent - candidate exact live Agent.
 * @returns Team membership, or undefined for non-Team subagents and stale identities.
 */
tryMembership(agent: Agent): TeamMembership | undefined
```

Types: [Agent](core.md)

Source: [`packages/subagent/agent-team/src/index.ts`](../../packages/subagent/agent-team/src/index.ts)
<!-- END GENERATED cordis-surface -->
