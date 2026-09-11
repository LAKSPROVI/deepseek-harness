---
description: "Package map for the durable task automation engine and its Web panel."
kind: "package-group"
---

# automation/ — durable scheduled tasks

English | [中文](README.zh.md)

## Summary

The Automation family runs scheduled tasks outside any live conversation turn: a file-backed store, a recurrence scheduler, an execution worker, a crash-recovery reaper, and a notification stream. One Host service owns all of it and publishes the `automations` Remote namespace the Web panel consumes.

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

-----

<a id="packages"></a>
## Packages

| Package | Role | ctx key |
|---|---|---|
| [`automation/`](automation/README.md) | Store, recurrence, worker, reaper, notifications, REST/SSE library exports, and the Cordis service | `ctx.automation` |

The browser panel lives in [`experimental/client-ui-automation`](../experimental/client-ui-automation/README.md) and consumes `ctx.remote.automations`.

<a id="related-documentation"></a>
## Related documentation

The [Task automation subsystem reference](../../docs/subsystems/automation.md) owns the durable records and the Remote surface.

<a id="dev-note"></a>
## Dev Note

None.
