---
description: "Model-facing automation_* tools that create, list, trigger, pause, resume, and delete persistent tasks through ctx.automation."
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-automation

English | [中文](README.zh.md)

## Summary

Six tools that let an agent manage the deployment owner's persistent tasks: `automation_create_task`, `automation_list_tasks`, `automation_trigger_task`, `automation_pause_task`, `automation_resume_task`, and `automation_delete_task`. Every write goes through the engine's owner check, so a task another owner holds is reported absent rather than touched. A created task defaults to the `CUSTOM_PROMPT` action, whose executor ([`@deepseek-ai/dsh-automation-prompt-action`](../automation-prompt-action/README.md)) opens a Session in the task's workspace and sends the prompt when the task is due.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Add one row to an agent preset; the Web bundle's `automation` preset ([`presets/automation`](../../bundle/web-app/presets/automation/agent.cordis.yml)) is the shipped example. The row injects `tools` and `automation`, so the host composition must carry the engine (`@deepseek-ai/dsh-automation`) before any preset naming this package mounts. There are no configuration fields.

### Create a task from conversation

`automation_create_task` takes a title, a `schedule_type` (`ONCE`, `INTERVAL`, `CRON`, `RRULE`) with its `schedule_expr`, and for the default `CUSTOM_PROMPT` action a `prompt`. The workspace defaults to the calling Session's directory; `workspace_path` overrides it. `max_runs` bounds the schedule and `timezone` applies to `RRULE`. Another `action_type` is accepted only as a key; whether a handler exists for it is the deployment's concern, and a run without one is recorded failed.

### Inspect and control

`automation_list_tasks` returns the owner's tasks as `AutomationTaskView` records. `automation_trigger_task` queues one immediate run and returns its id; the run proceeds in the background. `automation_pause_task` and `automation_resume_task` flip the schedule, and `automation_delete_task` removes the task with its run history.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

`apply` registers the six definitions on `ctx.tools` with `defineTool`; the registry disposes them with the plugin fiber. Creation writes through `ctx.automation.store.createTask` with `userId` fixed to `ctx.automation.owner`, then reads the view back through `taskView` so the model sees exactly what the panel shows. The control tools call the engine's `triggerNow`, `pauseTask`, `resumeTask`, and `deleteTask`; an `AutomationTaskNotFoundError` is rewritten into one line that points the model at `automation_list_tasks`.

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Tool definitions, payload assembly, owner-failure rewrite |
| [`tests/tool-automation.spec.ts`](tests/tool-automation.spec.ts) | Registration, creation defaults, control flow, foreign-owner refusal |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Automation engine](../automation/README.md) — store, scheduler, worker, reaper, and the `automations` Remote namespace.
- [Prompt action](../automation-prompt-action/README.md) — the executor behind `CUSTOM_PROMPT`.
- [Task automation subsystem](../../../docs/subsystems/automation.md) — durable records and the Remote surface.

-----

<a id="model-experience"></a>
## Model Experience

### Tool schema

#### What the model sees

The model sees the six generated [`automation_*` schemas](../../../docs/tool-catalog.md#deepseek-aidsh-tool-automation): `automation_create_task` with its title, schedule, prompt, workspace, and action fields, and the five control tools each taking one task `id`.

#### Token effect

Fixed schema cost on every request where the preset carrying the tools is mounted.

#### KV Cache effect

Prefix-stable while the definitions and visibility are unchanged. Plugin lifecycle or scoped restrictions may invalidate reuse from these schemas.

### Tool-call history and result

#### What the model sees

The model's arguments remain in the assistant tool-call. The next step sees the task view as pretty-printed JSON (`id`, `title`, `scheduleType`, `status`, `nextRunAt`, `lastRunAt`, `totalRunsCompleted`, `maxRuns`, timestamps), the list `{"tasks":[…]}`, one line `Run queued: <runId>` for a trigger, or `Deleted task <id>` for a deletion. A refused control call is one error line that names `automation_list_tasks`.

#### Token effect

Roughly 60 retained tokens per task view; the list scales with the owner's task count.

#### KV Cache effect

Append-only; newly visible content follows the reusable request prefix and does not invalidate existing KV-cache entries.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **No edit tool** — changing a schedule or prompt means delete and create; the engine's `updateTask` is not exposed to the model.
- **No run history** — the tools show the task view only; run logs and notifications stay Host-side and reach the panel, not the model.
- **One owner** — the tools act for `ctx.automation.owner`; there is no per-Session ownership.
- **Trigger is fire-and-forget** — `automation_trigger_task` returns the run id before the run finishes; the model learns the outcome only by listing later.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

No runtime invariant companion is published because the tools are thin request adapters over `ctx.automation`: every observable fact belongs to the engine's store, and the tool specs cover the argument mapping.
