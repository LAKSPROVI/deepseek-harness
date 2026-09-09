# Agent Note: Idempotent same-mode sandbox requests

Status: implemented

English | [中文](2026-09-08-idempotent-sandbox-mode-requests.zh.md)

## Problem

Tool schemas are registry-global while the effective sandbox mode is session-specific. A session already using `danger-full-access` therefore still exposes `sandbox_permissions: "danger-full-access"`. Some providers populate every optional tool argument despite instructions to omit redundant fields. The strict-wider validator rejected that same-mode request before execution, so a harmless provider serialization choice could trap the agent in repeated tool failures even though no permission change was requested.

## Decision

`approveEscalation` treats a schema-valid requested mode equal to the call's effective mode as an idempotent no-op. It returns the effective mode without consulting the approval service, and the tool executes once under the policy already in force. The exception applies only to the closed `ESCALATION_TARGETS` vocabulary; a narrower target, `read-only` as a requested target, or any unknown value still fails before execution. Strictly wider requests retain the existing approval flow and one-call grant.

This normalization revises the non-widening case in [the original sandbox decision](../feature/2026-07-06-sandbox.md) and remains in the shared sandbox Service Definition so bash, PowerShell, and in-process filesystem consumers cannot diverge. It changes no session state, records no approval event, and grants no capability the call did not already possess.

## Alternatives considered

**Keep rejecting every non-widening request.** Rejected because a provider may serialize optional schema fields even when its reasoning and the schema mark them optional. Repeating an error cannot teach that provider to omit a field it deterministically emits, and equality crosses no security boundary.

**Hide escalation fields when the composition default is `danger-full-access`.** Rejected because the effective mode may be overridden per session. A static schema derived from the default would remove the escalation lever from a narrower session in the same composition.

**Ignore all non-widening targets.** Rejected because a narrower or unknown target is not a redundant representation of current authority. Keeping those requests fail-closed preserves the executable validation boundary.

## Consequences

Provider-generated `sandbox_permissions` equal to the active mode no longer blocks a command or produces an approval prompt. Unit coverage pins both schema-valid equal modes, tool-family tests prove execution uses the unchanged mode without approval, and narrower or invalid targets remain rejected. The model may still emit unnecessary arguments, which remain visible in the durable tool call for diagnosis.
