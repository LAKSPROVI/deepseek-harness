# @deepseek-ai/dsh-tool-agent-team

English | [中文](README.zh.md)

Scoped model-facing adapter for [`ctx.agentTeams`](../agent-team/README.md). It installs the Agent Teams policy and collaboration tools in each implicit Lead and durable teammate scope. Scoped Team definitions shadow same-named legacy global continuable-subagent controls, so a composition that mounts both must disable the legacy definitions. The [operating cookbook](../../../docs/cookbook/operating-agent-teams.md) defines how Leads and teammates use these tools without duplicate work or unsupported correctness claims.

## Config

```yaml
- id: tool-agent-team
  name: '@deepseek-ai/dsh-tool-agent-team'
  config:
    freshProvider: spawn
    forkProvider: fork
```

`freshProvider` and `forkProvider` select registered continuable-subagent providers. The fixed model policy creates teammates only when the user explicitly asks for Agent Teams or teammates.

## Tools and authority

The generated [tool catalog](../../../docs/tool-catalog.md) owns exact schemas. The adapter registers 13 tools: teammate creation; quiet and waking peer delivery; roster listing, waiting, and Lead-only interruption; structured-debate start/get/compare-and-set update; and task create/list/get/compare-and-set update.

Every tool requires the exact calling `Agent`. `spawn_teammate`, `interrupt_agent`, `team_debate_start`, and `team_debate_update` enforce Lead authority inside `ctx.agentTeams`, not only in their descriptions. `team_debate_update` carries the debate id and expected revision for compare-and-set pause, resume, advance, or complete transitions; pausing the protocol does not interrupt active model turns. All members can communicate with any peer, read the debate, and use the task board. Task mutations retain the domain's owner/Lead and revision checks.

`send_message` succeeds once mail is durable and never wakes an inactive target. `followup_task` also makes the message the target's next turn and can cold-resume it. A `queued` result is accepted durable work and must not be retried. Task readiness does not start an owner. Before arming its 10,000-through-3,600,000-millisecond edge wait, `wait_agent` checks for another member that is running or provisioning; without one it returns `noProgress` immediately with instructions to re-list and use `followup_task`. Otherwise it waits for one post-call Team edge, defaulting to 30,000 milliseconds, and callers re-list after wakeup or timeout because earlier changes are not replayed.

The plugin listens to Agent publication and installs its registrations through that Agent's scope. Fresh creation and cold resume therefore receive the same tool/prompt set before the first model request. Agent disposal and plugin HMR remove every scoped registration; reloading the plugin installs one fresh set in each still-live member without changing its continuation Activation.

The Web UI lives in `ui-subagent`, not this model adapter. It presents the projected roster, read-only task board, and debate timeline, with controls for spawn, guidance, interruption, and Lead-authorized debate transitions.

## Model Experience

### Team policy and tools

#### What the model sees

One stable policy section states the exact Team role/name/id, explicit-delegation requirement, shared-cwd behavior, filesystem stale-version recovery, Bash/formatter/codegen risk, task/write-scope coordination, quiet versus waking delivery, no-retry mailbox rule, debate protocol, and the Lead's duty to wait before answering. The 13 Team schemas, including `team_debate_start`, `team_debate_get`, and `team_debate_update`, appear only in Team member scopes.

#### Token effect

Fixed policy and 13-schema cost on every Team member request. Tool calls add compact JSON roster, task, debate, wait, or receipt results. Peer content is retained by the Team domain in the target's history.

#### KV Cache effect

Prefix-stable while the Team plugin generation, configuration, member role/name, and schemas remain unchanged. The per-member identity line differs across Agents. Tool results and peer messages append after the reusable request prefix.

## Known Limitations and Deferred Work

- **Prompt policy is coordination, not confinement** — it cannot stop Bash or external processes from writing overlapping files.
- **No autonomous team creation** — ordinary tasks do not trigger delegation unless the user explicitly requests it.
- **No mailbox timeline** — the Web UI presents roster, tasks, and debate state but does not expose queued peer-message content.
