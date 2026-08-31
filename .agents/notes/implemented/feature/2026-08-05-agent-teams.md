# Agent Note: Durable Agent Teams over continuable children

Status: implemented

English | [中文](2026-08-05-agent-teams.zh.md)

## Problem

The subagent seam supplies fresh/fork providers, durable child Sessions, FIFO follow-ups, and cold-resumable Activations. Its direct-parent controls do not provide peer communication, a stable named roster, or shared task ownership. A coordinator can create several workers, but workers cannot address one another, durable follow-up intent lives only in target inboxes, and no common compare-and-set board prevents stale assignment updates.

All same-process Agents also share one checkout. Filesystem edit tools can reject an observed stale version, but Bash, formatters, generators, and external writers bypass that fence. Treating a teammate name or task owner as a file lock would hide rather than solve this concurrency boundary.

The model-visible Team tools remain opt-in so the default tool catalog and simple-task behavior do not change. An explicitly requested Team must survive child Activation settlement and mailbox delivery races long enough for the Lead to aggregate the result before process teardown.

## Decision

Every ordinary runtime root is the implicit Lead of a Team identified by that root's `SessionId`. The Team has no creation event: its Lead pseudo-row exists by identity, while durable state begins with the first member, message, or task event. A roster is flat and contains at most the configured number of immutable lowercase-kebab-case names. Each teammate is a continuable direct child with a reserved Session id; only the Lead creates or interrupts teammates. Ordinary provider-owned subagents outside the roster are not Team members, and an ordinary fork is a new root whose inherited Team records are excluded by their ancestor `TeamId`.

The implementation is split into `packages/subagent/agent-team` (`@deepseek-ai/dsh-agent-team`), which owns `ctx.agentTeams` and durable semantics, and `packages/subagent/tool-agent-team` (`@deepseek-ai/dsh-tool-agent-team`), which owns scoped schemas and model guidance. Every Team tool declares its complete result schema and renders that value as compact JSON, so the compiler checks each `execute` against what the model is promised and no result spends tokens on indentation. The base composition mounts the Host service, while the opt-in `agent-teams` preset mounts the model-visible tools and may disable legacy continuable controls with the same names. The explicit delegation policy permits Team creation only when the user asks for Agent Teams or teammates. The [stable routes, debate, and Web controls decision](2026-08-30-stable-agent-teams-debate.md) owns package promotion, heterogeneous routes, debate state, projection, and human controls.

The Lead must wait for required work before its final answer. Process teardown remains the final lifecycle owner and drains continuation Activations; a Team task owner is durable state and is not automatically released by idle, interruption, or process exit.

## Provisioning and recovery

Creation first appends and flushes a `team/member` provisioning snapshot in the Lead Session, then starts the reserved continuable child through the selected fresh or fork provider. The snapshot records the continuable provider separately from optional `llmProvider`, `model`, and `persona` selections; creation forwards the LLM route through child `agentOptions` and the persona through the child composition. Failure before initial inbox acceptance appends a failed snapshot. Success flushes the child's accepted inbox item before appending active. Recovery recognizes that initial message while it is still pending or after it enters user-message history. Names are reserved by the first provisioning record and never reused, including after failure. Disposal closes admission, aborts and awaits admitted creation and mailbox-dispatch transactions, then stops every live child recorded by the roster; a failed child remains cleanup-owned until its Activation exits, and cleanup rejection fails disposal.

A root recovery reconciles an unterminated provisioning record against the child's independently persisted Session. Matching direct-parent and continuable descriptors, including the selected LLM provider, model, and persona, plus a recorded initial user message prove successful admission and produce active; absence, corruption, mismatched provider, route, persona, or lineage, or a missing admitted message produces failed. The same descriptor reconstructs explicit per-member selections on cold resume instead of inheriting the Lead's current route. The creator re-reads the terminal phase under the same Lead-log serializer; if recovery marked failed while creation succeeded, it drains the child and reports a provisioning conflict instead of retaining an orphan. This avoids reconstructing an initial prompt that was never retained in the Team log and contains plugin-reload races.

Fresh children have no inherited conversation. Fork children capture the Lead's completed-turn prefix once and retain it as their own durable seed. The current delegation turn remains excluded, matching the existing fork provider contract.

## Mailbox and task transactions

Peer communication is a Lead-log mailbox. `team/message/queued` is appended and flushed before delivery. The target message carries the stable message id and sender identity in both durable source metadata and a short model-visible prefix. A target receipt is acknowledged with `team/message/delivered` only after its pending inbox item or recorded user message is flushed. Immediate admission is serialized per target in queued-log order, recovery retries queued-minus-delivered in the same order, and delivery folds live or persisted target inbox/history state before cold resume. Every current-version Team payload is runtime-validated before entering replay state. The Team runtime tracks dispatch and asynchronous acknowledgement work from synchronous admission until settlement; disposal closes admission and awaits both before removing the service. Current waiters wake only after the owning Team event flush succeeds.

Quiet `send_message` injects, flushes, and acknowledges immediately for a live target without waking it; an inactive target remains queued until another event materializes that teammate. Waking `followup_task` becomes the target's next FIFO turn and may cold-resume it. Success means the message is already durable even when immediate delivery is deferred. The mechanism provides process-local retry and target-Session de-duplication, not a cross-process exactly-once claim.

Shared tasks are complete snapshots with Team-local ids and monotonic revisions. Every mutation carries `expectedRevision`. Any member creates, reads, or claims a ready unowned task; the owner or Lead edits and transitions it, while only the Lead assigns another member. Numeric task ids remain within the safe-integer allocation range, and exhaustion fails without reusing an id. Dependencies must name non-deleted tasks and form a complete DAG. Deleted tasks are retained tombstones. `writeScopes` are normalized path prefixes that produce overlap diagnostics but never block claim or authorize a write.

`wait_agent` blocks on one roster, mailbox, task, or live-status edge registered after the call starts instead of encouraging model polling. It does not replay an earlier edge, so callers re-read authoritative state after wakeup or timeout. Lead-only interruption cancels the current turn with inbox preservation and does not alter mailbox or task ownership.

## Structured debate and projection

A Team may retain one current structured debate as whole `team/debate` snapshots with a stable id and compare-and-set revision. The Lead controls pause, resume, phase advance, and completion across `positions`, `critique`, `rebuttal`, `verification`, and `synthesis`; pause is durable coordination state and remains distinct from inbox-preserving interruption. The `agentTeam` Session projection folds members, tasks, and debate state while excluding mailbox content, and the conversation UI reads that projection and invokes human controls through the generated `agentTeams` Remote. The [stable routes, debate, and Web controls decision](2026-08-30-stable-agent-teams-debate.md) owns these extension decisions.

## Shared checkout boundary

All members use the same cwd and observe writes immediately. The policy tells members to partition tasks, record advisory write scopes, order dependent work, and let the Lead inspect the final diff and run tests. A filesystem stale-version rejection requires rereading and rebasing the intended change. No equivalent guarantee is claimed for Bash, formatters, code generation, or direct external writes.

Worktree isolation is not a harness runtime behavior. A deployment or prompt may arrange separate worktrees, but the Team domain does not infer branches, merge changes, or silently change cwd. This preserves the existing same-world subagent and sandbox contracts.

## Alternatives considered

**Extend direct-child subagent tools with peer ids.** Rejected because parent/child authority and Team peer membership are different domains. Adding peer access to the continuation seam would weaken its exact-parent authorization and still leave roster and tasks without a persistence owner.

**Store mail in each target Session before delivery.** Rejected because an inactive target is intentionally not materialized for quiet mail. The always-live Lead Session is the transaction home; target recording is the acknowledgement and de-duplication boundary.

**Treat task ownership or write scopes as locks.** Rejected because external writers bypass them, crashed owners remain durable, and path-prefix overlap cannot prove semantic independence. False mutual exclusion is more dangerous than an explicit warning.

**Create isolated worktrees automatically.** Rejected because worktree creation, branch naming, merge policy, ignored files, build artifacts, and cleanup are deployment choices. It also changes the same-world behavior existing subagents and sandboxes expose.

**Enable Teams in the default catalog.** Rejected because scoped Team controls would shadow same-named legacy globals and unsolicited delegation would add latency and token cost to simple tasks. Explicit composition keeps model-visible ownership unambiguous without changing shipped requests.

**Use an in-memory board and mailbox.** Rejected because child settlement, HMR, and process interruption would lose accepted coordination state and make retries ambiguous.

**Return Team tool results as untyped JSON.** Rejected because an undeclared result type lets `execute` drift from the value the model is promised without a compiler error, and it invites indentation that costs tokens on every roster, task, and receipt. Each Team tool therefore declares its complete result schema and one shared helper renders it compactly.

## Testing

Package tests cover identity, name and authority checks, the Lead-plus-nine ceiling, continuable-provider selection, explicit and inherited LLM provider/model/persona routing, descriptor-backed cold resume, reserved-id persistence collisions, child-before-Lead flush ordering, durable provisioning failure and pending-inbox JSONL/SQLite reconciliation, concurrent target-local ordering, pending/history de-duplication, mailbox limits, post-flush notification, bounded disposal with in-flight creation and dispatch cancellation, failed-member cleanup, task CAS and DAG validation, debate phase order, debate CAS and pause-versus-interrupt behavior, projection replay and mailbox exclusion, write-scope warnings, wait cancellation/timeout, ordinary-fork isolation, legacy-control shadowing, compact declared-schema result rendering, generated Remote mounting, and scoped registration HMR at per-file 100% coverage. A keyless headless Loader snapshot assembles the real Team plugins and records heterogeneous teammate creation, peer mail, dependent tasks, structured debate, waiting, and Lead aggregation; Host API and Web tests pin generic projection delivery and human controls.

## Consequences

The Lead Session grows with whole task/member snapshots and mailbox acknowledgements. This favors independently inspectable recovery over compact deltas; configured task and pending-mail bounds cap active state, while deleted and delivered history remains append-only until broader Session retention applies.

An active roster member can be non-resident, so `inactive` is not failure and a wakeup can incur cold-resume latency. A quiet message for an inactive target can remain pending indefinitely until the target is otherwise materialized. A failed member permanently consumes its name and member slot, making provisioning failures visible instead of silently recycling identity.

Coordination reduces likely checkout conflicts but cannot eliminate writes outside filesystem compare-and-set tools. The final diff and tests remain the Lead's integration boundary.
