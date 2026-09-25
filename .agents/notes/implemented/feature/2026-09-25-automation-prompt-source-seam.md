# Agent Note: Automation prompt messages cross the opaque MessageSource seam

Status: implemented

English | [中文](2026-09-25-automation-prompt-source-seam.zh.md)

## Problem

`automation-prompt-action` opens a Session for a due task and sends the initial prompt as a `user/message` whose `source` names the automation run (`kind: 'automation'` with `taskId` and `runId`). The 0.1.6 persistence type history classifies adding this member to `MessageSourceMap` as a persisted union-variant change: a Session format version bump, which requires a migration edge, stage implementations, and snapshot successors. The runtime automation engine works today without the typing; the format bump is a release-shaped project of its own.

## Decision

The package keeps its local `AutomationMessageSource` interface documenting the exact provenance object and emits it through the opaque `MessageSource` seam: `satisfies AutomationMessageSource as unknown as MessageSource`. The registration of the `automation` member on `MessageSourceMap` is deferred until the adjacent V3-to-V4 format edge ships; the double cast makes the deferral explicit and compiled rather than an unchecked payload. Prose standardization replaces the word "provenance" with "the message `source` and the Session title fallback" in the JSDoc, keeping the term vocabulary concrete.

## Alternatives considered

**Register the member now.** That path is mechanically correct but drags the full format-version procedure - identity edge, per-artifact stages, validators, snapshot successors, both SDK recordings - into a task whose product value is the automation engine itself.

**Use the generic `plugin` member of `MessageSourceMap`.** The `plugin` member carries `{ kind: 'plugin'; plugin: string } & ContextFormed`, which would drop the structured `taskId` and `runId` fields into a summary string and lose the machine-readable run identity that recovery tooling reads.

**Remove the source object entirely.** The provenance is the audit trail connecting a Session to the task run that created it; deleting it orphans the Session.

## Consequences

The persisted bytes are identical to the pre-seam implementation: nothing on the wire or in logs changes. TypeScript still checks the object against the local interface through `satisfies`, so field drift fails the build. When the V3-to-V4 edge lands, replacing the cast with the real `MessageSourceMap` registration is a one-line change plus the event-schema update the bump already requires. The persistence type history stays green against the recorded V3 state, and the compiler has no hole: the `as unknown` step is visible at exactly one call site.

## Testing

The focused automation suites pass unchanged (the prompt-action spec asserts the emitted source object), and `pnpm run verify-persistence-changes` plus `pnpm run verify-persistence-formats` are green against the recorded history, proving the tree introduces no unacknowledged persistence-type change.
