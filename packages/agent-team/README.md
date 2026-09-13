---
description: "Package map for Agent Teams: the durable team domain and its model-facing tools."
kind: "package-group"
---

# agent-team/ — named teammates with a shared task board

English | [中文](README.zh.md)

## Summary

The Agent Teams family lets one Session own a roster of named teammates that exchange durable messages and coordinate through a shared task board. The domain package owns the durable records and publishes `ctx.agentTeams`; the tool package exposes the team-scoped tools a preset mounts. Both were promoted from `experimental/` once the shipped Web bundle started depending on them: a release member cannot depend on a private prototype.

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

-----

<a id="packages"></a>
## Packages

| Package | Role | ctx key |
|---|---|---|
| [`agent-team/`](agent-team/README.md) | Roster, durable messages, shared task board, and the Cordis service | `ctx.agentTeams` |
| [`tool-agent-team/`](tool-agent-team/README.md) | Nine team-scoped tools that let the model create, message, and coordinate teammates | registers on `ctx.tools`, consumes `ctx.agentTeams` |

The browser projection lives in [`client/ui-agent-team`](../client/ui-agent-team/README.md); the source-checkout profile layers remain in [`experimental/agent-team-profile`](../experimental/agent-team-profile/README.md) and [`experimental/agent-team-web-profile`](../experimental/agent-team-web-profile/README.md).

<a id="related-documentation"></a>
## Related documentation

The [Agent Teams subsystem reference](../../docs/subsystems/agent-team.md) owns the durable Team types and the `ctx.agentTeams` service API.

<a id="dev-note"></a>
## Dev Note

None.
