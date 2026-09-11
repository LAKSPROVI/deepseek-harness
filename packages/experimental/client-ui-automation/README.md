---
description: "Use and debug the experimental Web automation panel that lists Host automations and triggers, pauses, or resumes them."
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-client-ui-automation

English | [中文](README.zh.md)

## Summary

This private browser package adds an automation action to the Web conversation header. Opening it lists the Host-owned automation tasks and offers the three safe controls the Host exposes: trigger now, pause, and resume. It reads and mutates state only through the generated `automations` Remote namespace of [`@deepseek-ai/dsh-automation`](../../automation/automation/README.md); it never reads the Host filesystem or `store.json`, and it creates, deletes, migrates, or caches no task.

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

Load the Host automation engine first, then this package in the Web Client bundle; the source-checkout Web profile lists both in [`cordis.patch.yml`](../../bundle/web-app/cordis.patch.yml). The Client export mounts the `/client` entry; the root Host export is inert and the package has no user configuration fields.

### Read and control the list

The header button toggles the panel and reloads the list on every open. Each row shows the task title, schedule type, status, and next run. `Trigger` asks the Host for one immediate run and shows the returned run id; `Pause` and `Resume` flip the task status. Every accepted action reloads the authoritative list, so the panel never shows a locally guessed state. A rejected action — including `automation/not-found` for a task that belongs to another owner — is shown as one error line and leaves the list untouched.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

[`src/client/mount.ts`](src/client/mount.ts) mounts the generated Remote contribution from `@deepseek-ai/dsh-automation/remote`, then registers one `conversation.session.header.actions` slot (id `automation`, order 30) inside a child scope injected with `remote.automations`. Each Remote call unwraps the `RemoteResult` envelope and throws its error branch, so the component deals with one failure shape. Disposing the plugin fiber removes the slot and unmounts the namespace; a failure while registering the slot unmounts the namespace before rethrowing.

| File | Role |
|---|---|
| [`src/client/mount.ts`](src/client/mount.ts) | Remote mount, child scope, and slot registration |
| [`src/client/AutomationAction.tsx`](src/client/AutomationAction.tsx) | Panel state: list, refresh, one-line error |
| [`src/client/types.ts`](src/client/types.ts) | The props contract and the task view shape the panel renders |
| [`src/index.ts`](src/index.ts) | Inert Host entry |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Automation engine](../../automation/automation/README.md) — the store, scheduler, worker, reaper, and the `automations` Remote namespace.
- [Task automation subsystem](../../../docs/subsystems/automation.md) — the durable records and the Remote surface.
- [Experimental packages](../README.md) — incubation status and release exclusion.

-----

<a id="model-experience"></a>
## Model Experience

None, as this browser panel registers no tool, prompt section, or session event.

#### KV Cache effect

No direct effect; the Host engine and any deployment-registered action handler own every later model-visible use.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **No create or delete** — the Host exposes neither over Remote, so the panel cannot add or remove a task.
- **Reload on demand only** — the panel refreshes on open and after each action; it subscribes to no live event stream, so a scheduled run that finishes while the panel is open is visible only after the next reload.
- **No run history** — the panel shows the task view only; run logs and notifications stay Host-side.
- **English copy only** — the panel registers no locale dictionary yet.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** the panel owns one slot registration and one mounted namespace; every displayed state comes from the last successful `list()`.
