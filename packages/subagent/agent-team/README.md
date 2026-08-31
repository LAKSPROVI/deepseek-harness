# @deepseek-ai/dsh-agent-team

English | [中文](README.zh.md)

Stable implicit-root Agent Teams domain. `ctx.agentTeams` owns a flat Lead/teammate roster, a durable peer mailbox, a shared task DAG, and a structured debate in the Lead Session log. The [Agent Teams Agent Note](../../../.agents/notes/implemented/feature/2026-08-05-agent-teams.md) owns the coordination and isolation decisions; the [Team subsystem catalog](../../../docs/subsystems/agent-team.md) records the literal durable forms and service API.

## Config

```yaml
- id: agent-team
  name: '@deepseek-ai/dsh-agent-team'
  config:
    maxMembers: 9
    freshProvider: spawn
    forkProvider: fork
    maxTasks: 256
    maxDebateRounds: 8
    maxPendingMessagesPerMember: 64
    maxMessageBytes: 65536
    disposalTimeoutMs: 5000
```

Every numeric limit must be a positive safe integer. `maxMembers` defaults to and cannot exceed nine teammates, so the Lead plus teammates never exceeds ten agents; it counts every name ever provisioned, including failed members, because names are never reusable. `freshProvider` and `forkProvider` select the continuable-subagent transports for fresh and fork contexts. `maxTasks` counts non-deleted tasks, and `maxDebateRounds` defaults to eight. The mailbox limit is per target; the byte limit covers the complete framed delivery, including its stable id and sender name. `disposalTimeoutMs` bounds admitted creation, mailbox dispatch, and Team-owned Activation settlement so plugin reload and process shutdown fail visibly instead of waiting forever.

The service requires Agent, Session, Session persistence, and continuable-subagent services. A composition without durable Session storage does not activate it.

## Team identity and roster

Every ordinary runtime root is the implicit Lead of a Team whose `TeamId` equals its `SessionId`; creating a Team is therefore state-free until the first member, message, task, or debate record. A teammate is a named, continuable direct child recorded in that root's Session. Names are lowercase kebab-case, at most 64 characters, and immutable for the Team lifetime. Session ids remain the persistence and authorization identities.

`spawnTeammate()` first appends and flushes a provisioning member, then asks the configured spawn or fork provider to create the reserved child id. A provider failure appends a durable failed member. Successful inbox admission is flushed in the child Session before the active edge commits. On root recovery, a provisioning record becomes active only when the independently persisted child has matching direct-parent and continuable descriptors plus its initial user message, either still pending in the durable inbox or already recorded in history; otherwise it becomes failed. If recovery wins a same-process provisioning race, the creator accepts the matching terminal state or reports `TEAM_PROVISIONING_CONFLICT` and drains a child that recovery already marked failed. Disposal closes admission, aborts and awaits admitted creation and mailbox-dispatch transactions, then asks the continuation owner to release the roster's exact live direct children and their descendants. Non-Team continuable children of the Lead remain untouched. Cleanup failures make disposal fail visibly. This closes crashes and reload races between root provisioning and its terminal member edge without reusing a name or retaining an orphan Activation.

Fresh children have no parent-history seed. Fork children capture the Lead's completed-turn prefix once; the in-flight delegation turn is excluded. Each teammate snapshot persists its optional `llmProvider`, `model`, and child-only `persona`; the continuation owner restores the same selection and persona on cold resume. Inherited Team records carry the old root's `TeamId` and are ignored when an ordinary fork becomes an independent runtime root. Provider-owned subagents outside the roster do not become nested Team Leads.

The roster reports durable provisioning/failed phases and live `running`/`idle` status. An active but non-resident teammate is `inactive`; later waking delivery cold-resumes it through the continuation owner.

## Durable mailbox

`sendMessage()` validates peer membership, appends `team/message/queued`, and flushes before attempting delivery. The result always identifies that durable message; `queued` means immediate delivery was deferred and is not an instruction to resend. Quiet delivery injects, flushes, and acknowledges context immediately when the target is live, but never activates an inactive target; an inactive target's quiet message remains queued. Wakeup delivery becomes the target's next FIFO turn and cold-resumes it when needed.

The target message begins with `Team message <id> from <name>:` and retains the same id and sender in `TeamMessageSource`. Once the target Session durably holds that identity either in its pending inbox or recorded user-message history, the Lead log appends `team/message/delivered`. Immediate admissions are serialized per target in durable queue order, and recovery dispatches queued-minus-delivered records in the same order. Delivery folds both live and persisted inbox/history state before retrying, so a crash between inbox acceptance and model claim does not duplicate the message. A successful Lead-log flush wakes current `waitForChange()` callers, which then re-list authoritative state.

The guarantee is process-local retry plus target-Session de-duplication, not cross-process exactly-once delivery. This release has no shared mailbox transaction across processes and no mailbox timeline UI.

## Shared task board

Tasks are complete versioned snapshots. Every mutation carries `expectedRevision`; stale callers receive `TEAM_TASK_STALE_REVISION` instead of overwriting a newer value. Any member can create, read, or claim a ready unowned task. The owner or Lead can edit, release, complete, reopen, or delete it; only the Lead can assign another member. Numeric `task-<n>` ids require a safe-integer suffix; creation reports `TEAM_TASK_LIMIT` instead of reusing the final safe id.

Dependencies must name current non-deleted tasks and form a complete DAG with no self or duplicate edge. A pending task is ready only after every blocker completes. Deleting a task that still has a non-deleted dependent is rejected. Deleted tasks remain tombstones for replay and id stability but do not consume `maxTasks` or appear in `listTasks()`.

`writeScopes` are normalized workspace-relative prefixes. Views warn when they overlap an in-progress task, but they never block claim or authorize filesystem writes. They are coordination hints, not locks.

## Structured debate and Web projection

A structured debate is one durable snapshot with compare-and-set revision, participant names, round, phase, status, and transition history. Its phases advance through `positions`, `critique`, `rebuttal`, `verification`, and `synthesis`. Only the Lead can start or update a debate; updates require its id and expected revision and apply `pause`, `resume`, `advance`, or `complete`. Status is `active`, `paused`, or `completed`. Pausing blocks protocol advancement but does not interrupt turns already running.

The `agentTeam` Session projection exposes durable member snapshots, non-deleted task snapshots, and the current debate for browser consumers. It deliberately excludes queued mailbox content. The `ui-subagent` Web view combines that projection with live roster status and provides roster, read-only task, and debate displays plus spawn, guidance, interrupt, and debate controls.

`waitForChange()` waits for one roster, task, mailbox, debate, or live-status edge that occurs after registration, for 10 seconds through one hour; it reports only whether the wait timed out and does not replay a change that already happened. Runtime disposal releases current waits and makes later waits return immediately without a timeout. Callers re-read authoritative state after wakeup or timeout. Cancellation preserves an Error reason or reports a non-Error reason through `TEAM_WAIT_ABORTED` with structural inspection instead of object coercion. `interrupt()` is Lead-only and delegates to the continuable-subagent interrupt path, which cancels only a live teammate's current turn with `keepInbox`; it neither releases task ownership nor deletes durable mail.

The separate `./invariant` companion replays each candidate Team event against its committed Session prefix. Replay validates every current-version Team payload before it enters folded state, then rejects invalid member transitions, reused names, out-of-range numeric task ids, discontinuous task revisions, invalid task dependencies, duplicate queue/ack records, and acknowledgements with the wrong target before append. Session event `seq` and `time` own ordering and timing instead of duplicated snapshot timestamps.

## Model Experience

### Peer messages

#### What the model sees

Each delivered peer message is a user-role message. A short first text block names its stable message id and sender; the sender's original content blocks follow unchanged. Roster, task, debate, and mailbox records themselves are log-only and never enter derived model history.

#### Token effect

Each peer delivery adds the sender prefix plus message content to the target history. Roster, task, and debate mutations add no model tokens; their model-facing representation belongs to `@deepseek-ai/dsh-tool-agent-team` results.

#### KV Cache effect

Peer messages append after the target's reusable history prefix. Cold resume reuses the persisted conversation before appending a previously undelivered item.

## Known Limitations and Deferred Work

- **One process and one shared checkout** — members share cwd and observe edits immediately; this package provides no worktree, remote member, merge, or filesystem lock.
- **Advisory write scopes** — Bash, formatters, code generators, and direct external writers can bypass filesystem version checks; Leads must coordinate ownership and review the final diff.
- **Flat immutable roster** — only the Lead creates direct teammates; there is no nested Team, rename, deletion, or name reuse.
- **No automatic ownership release** — idle, interruption, process exit, and failed work do not release a task owner.
- **Mailbox is not cross-process exactly-once** — concurrent harness processes over one Team are unsupported.
