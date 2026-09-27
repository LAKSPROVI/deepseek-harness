---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-09-26-team-debate-event

English | [中文](2026-09-26-team-debate-event.zh.md)

## Summary

Adds the durable team/debate Structured Deliberation event that records one compare-and-set transition per revision of a Team debate.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

```yaml persistence-change
schemaVersion: 1
id: 2026-09-26-team-debate-event
baseline: false
changes:
  - root: "event:team/debate"
    previous: null
    after: "84a7362512e706a545918cfa4af11a97ab9770b4addcbfad9f9e2908c54b465a"
    decision: same-version
```

<a id="compatibility"></a>
## Compatibility

A new root in the same Session format version. Existing logs contain no such event and stay valid; readers that predate it refuse a log carrying it, as required-on-read events do. The event is appended only by the experimental Agent Teams service when a Lead starts, pauses, resumes, advances, or completes a debate through team_debate_* tools, and its only consumer is the client-side agentTeam projection that renders the debate board.

<a id="verification"></a>
## Verification

pnpm exec vitest run packages/experimental/agent-team packages/experimental/tool-agent-team: the shared CAS debate test drives two full rounds (pause/resume/stale-revision rejection/advance through every phase/complete/history) and the Team suite passes.

<a id="dev-note"></a>
## Dev Note

None.
