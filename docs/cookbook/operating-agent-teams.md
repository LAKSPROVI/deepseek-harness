# Cookbook: operating Agent Teams

English | [中文](operating-agent-teams.zh.md)

Use this procedure when an agent or maintainer coordinates a task through the `agent-teams` preset, displayed as **Equipe de agentes**. The [user guide](../user/guide/agent-teams.md) owns Web UI operation; the [subsystem reference](../subsystems/agent-team.md) owns durable forms and APIs.

The browser presents Brazilian Portuguese controls while model tools and domain values remain stable:

| Web control | Model/domain operation |
|---|---|
| **Criar integrante** | `spawn_teammate` / `spawnTeammate()` |
| **Orientar integrante → Apenas deixar na fila** | `send_message` / quiet delivery |
| **Orientar integrante → Acordar e orientar** | `followup_task` / wakeup delivery |
| **Interromper tarefa** | `interrupt_agent` / `interrupt()` |
| **Iniciar debate** | `team_debate_start` / `startDebate()` |
| **Pausar protocolo**, **Retomar protocolo**, **Avançar fase**, **Concluir debate** | `team_debate_update` with `pause`, `resume`, `advance`, or `complete` |

## 1. Decide whether to form a Team

Form a Team only when the user explicitly asks for Agent Teams or teammates. Prefer one agent for tightly coupled work that cannot be partitioned. Use a Team when roles, evidence sources, model routes, or review responsibilities can be separated.

Before spawning, state the shared objective, the deliverable, and the stop condition. Keep the Lead responsible for decomposition, ownership, conflict resolution, verification, and the final answer.

## 2. Design the roster

Give each teammate an immutable lower-kebab-case name, one responsibility, and one output. Use `fresh` when the role needs only its prompt; use `fork` when it needs the Lead's completed history. When diversity is part of the assignment, choose a configured provider and one of its advertised models in **Criar integrante**, then add a persona when the role needs one. **Herdar provider e modelo da líder** inherits the Lead route once at creation; explicit selections remain attached to the teammate and do not track later Lead changes.

A useful roster assigns different failure modes:

- implementer — produces the change;
- reviewer — checks contracts, edge cases, and regressions;
- verifier — runs independent tests or validates external evidence;
- synthesizer — compares conclusions without editing the same files.

Do not create duplicate generalists merely to increase vote count. Provider diversity is useful only when roles and evidence requirements also differ.

## 3. Partition files and evidence

Create Team tasks before concurrent writes. Give each in-progress task an owner and workspace-relative advisory write scopes. Treat scope overlap warnings as a reason to repartition, not as filesystem enforcement.

One file has one writer at a time. Assign read-only review freely, but serialize formatters, generators, lockfiles, shared configuration, and broad refactors. The Lead checks `git diff`, unexpected files, generated output, and final integration before reporting completion.

## 4. Communicate without duplicate work

Use quiet delivery for information that can wait. Use waking delivery only when the target must execute another turn. A `queued` receipt means the message is durable; never retry it. Re-list the roster, task board, or debate after a wait, timeout, or wakeup because waits report a later edge rather than replaying changes that happened before registration.

Interrupt only a current turn that must stop. Interruption keeps the inbox and task ownership. Release or reassign the task separately, and pause a debate separately.

## 5. Run the debate as an evidence protocol

Start with a falsifiable topic and two through ten active member names. The Lead owns transitions. For each phase:

1. `positions` — collect independent positions before cross-contamination.
2. `critique` — require each critic to name a claim, risk, or missing test.
3. `rebuttal` — require direct responses to critiques, not restated positions.
4. `verification` — run checks, inspect primary sources, and mark unresolved claims.
5. `synthesis` — record supported conclusions, remaining disagreement, uncertainty, and follow-up work.

Advance only when the phase artifact exists. A consensus count is not verification. Pause for human review without assuming running turns stopped; interrupt those turns explicitly when required. On a stale revision, read the current debate and decide again against that state.

## 6. Handle provider and lifecycle failures

Preserve provider failures as evidence. A durable member with a quota, authentication, or transport failure still proves which route and persona were selected, but it does not count as a successful independent answer. Use another name and a working route for replacement work because roster names are never reused.

An `inactive` member is resumable, not deleted. Wake it with a concrete next objective. After process restart, open the same Lead Session and inspect the roster before creating anything. Never infer absence from a blank new session or another session in the same workspace.

## 7. Finish the Team task

Before the Lead answers:

1. wait for every required member or record its concrete failure;
2. re-list tasks and release or complete ownership explicitly;
3. inspect the final workspace diff and run the relevant validation;
4. read the current debate revision and transition history;
5. distinguish verified facts, model judgments, unresolved claims, and provider limitations;
6. tell the user what completed, what evidence passed, and what remains blocked.

Stopping work does not delete Team history. The durable session remains the audit record for roster identity, messages, tasks, debate transitions, and provider outcomes.

## Maintainer map

- Host domain and persistence: [`packages/subagent/agent-team`](../../packages/subagent/agent-team/README.md)
- Model policy and tools: [`packages/subagent/tool-agent-team`](../../packages/subagent/tool-agent-team/README.md)
- Browser controls: [`packages/client/ui-subagent`](../../packages/client/ui-subagent/README.md)
- Opt-in preset: [`apps/cli/config/agent-presets/agent-teams`](../../apps/cli/config/agent-presets/agent-teams/agent.cordis.yml)
- Durable types and generated Cordis API: [Agent Teams subsystem](../subsystems/agent-team.md)
- Shipped rationale and alternatives: [Agent Teams Agent Note](../../.agents/notes/implemented/feature/2026-08-30-stable-agent-teams-debate.md)
