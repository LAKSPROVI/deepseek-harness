---
description: "CUSTOM_PROMPT executor for the automation engine: a due task opens one Workspace Session and sends its prompt."
kind: "package-reference"
---

# @deepseek-ai/dsh-automation-prompt-action

English | [中文](README.zh.md)

## Summary

The executor the automation engine ships with. It registers one handler on `ctx.automation.worker` (key `CUSTOM_PROMPT` by default); when a task with that action is due or triggered, the handler creates an ordinary root Session in the task's workspace, mounts the configured agent preset, applies the permission preset, titles the Session after the task, and sends the task's prompt. The run is recorded successful once the prompt is admitted — the same fire-and-forget transaction the webhook runtime performs — and the Session then lives its normal life under `ctx.agents`.

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

Compose the row on the host plane after `@deepseek-ai/dsh-automation`; the Web bundle does this in [`cordis.patch.yml`](../../bundle/web-app/cordis.patch.yml). The row injects the engine and the Session-creation seams (`agents`, `agentDefaultModel`, `agentPresets`, `permissionPresets`, `sessionTitle`, `workspaceRegistry`).

### Config

| Key | Default | Meaning |
|---|---|---|
| `actionType` | `CUSTOM_PROMPT` | Handler key tasks reference as `actionType`. |
| `agentPreset` | roster default | Preset every run mounts unless the task payload names one. |
| `permissionPreset` | deployment default | Permission preset every run's Session gets unless the task payload names one. |

### Task payload

A task with this action carries `actionPayload.prompt` and an absolute `actionPayload.workspacePath`; optional `title`, `agentPreset`, and `permissionPreset` override the defaults per task. [`@deepseek-ai/dsh-tool-automation`](../tool-automation/README.md) assembles exactly this payload from conversation. A payload that fails validation fails the run before any Session exists.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

`openPromptSession` mirrors `createWebhookSession`: resolve the permission preset and the agent preset, take the current default model, create the Workspace, create the Agent with the preset mounted in `setup`, attach the Session, set the permission preset, rename, then `followup` a user message whose `source` is `{ kind: 'automation', taskId, runId, form: 'notice', summary }` — the `MessageSourceMap` merge lives in this package. A failure after attachment detaches and disposes before rethrowing, so the engine records the run failed with the real cause and no half-built Session remains. `apply` wraps the registration in `ctx.effect`, so disposing the plugin fiber removes the handler.

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Payload validation, Session transaction, handler registration |
| [`tests/prompt-action.spec.ts`](tests/prompt-action.spec.ts) | Call order, overrides, rollback, worker registration lifecycle |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Automation engine](../automation/README.md) — the worker this handler registers on and the run it reports to.
- [Automation tools](../tool-automation/README.md) — how a task with this action is created from conversation.
- [Webhook runtime](../../webhook/webhook/README.md) — the Session-creation transaction this package mirrors.

-----

<a id="model-experience"></a>
## Model Experience

### Session prompt

#### What the model sees

The new Session's first user turn is the task's `prompt`, verbatim, with a notice-form source summarizing `automation task "<title>" run <runId>`. Everything else the model sees comes from the mounted preset, not from this package.

#### Token effect

The prompt's own tokens, once, at the start of the new Session.

#### KV Cache effect

None beyond an ordinary first user message; the preset's prefix is unchanged.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Success means admitted, not finished** — the run is `SUCCESS` when the prompt is accepted; the Session's outcome is not reported back to the task or its notifications.
- **One Session per run** — there is no reuse of an existing Session and no continuation of the previous run's Session.
- **Default model only** — every Session starts on `agentDefaultModel.currentSelection()`; the task's `model`/`modelProvider` fields are not consulted yet.
- **No per-task timeout on the Session** — the engine's `timeoutSeconds` bounds the handler, which returns right after admission, so it never bounds the Session.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
