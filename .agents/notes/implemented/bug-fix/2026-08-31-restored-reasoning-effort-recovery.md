# Agent Note: Recovery of a restored reasoning effort

Status: implemented

English | [中文](2026-08-31-restored-reasoning-effort-recovery.zh.md)

## Problem

A Web session restores its model selection from the latest durable `request/header`. Adapter settings, discovery results, or an application build can later change the exact model's advertised reasoning levels. The restored effort then remains part of the next request even when the current adapter no longer accepts it, so LLM validation rejects the turn before provider I/O. The model selector may expose no effort controls for the new metadata, leaving the session unable to clear the invalid value through the same-route selection gesture.

## Decision

The Host resolves exact-model metadata before returning `session.models` and before admitting `session.prompt`. When the selected effort is absent from the current model's advertised levels, the live selection uses the current `defaultEffort`; if the model advertises no default, the selection omits the effort and preserves provider-default behavior. The next model request records that normalized selection in its ordinary `request/header`, without rewriting earlier events.

Failure to resolve exact-model metadata does not alter provider, model, or effort. The existing unavailable-route response therefore retains the user's selected identity and remains the recovery path for a removed or temporarily unavailable adapter.

Exact-model resolution is asynchronous. If another selection is accepted while stale-effort recovery is pending, the newer complete selection remains authoritative and the delayed recovery never overwrites it.

## Alternatives considered

- **Require the user to select the same model again.** The selector treats an unchanged provider/model pair as a no-op, and current metadata may remove the effort menu entirely, so the gesture cannot reliably clear the invalid value.
- **Rewrite the latest `request/header`.** Session history is append-only and the header records the request that actually ran. Mutating it would corrupt replay evidence to repair live configuration state.
- **Clamp the effort in the LLM runtime.** The runtime correctly rejects unsupported explicit values. Silent clamping there would hide caller defects from every entry point and leave the Web directory reporting a selection different from the dispatched request.

## Consequences

Prompt admission performs exact-model resolution when a restored or selected effort is present. This repeats metadata work that final call preparation also performs, but prevents an invalid live selection from entering the turn and keeps the directory, prompt admission, and dispatched request consistent.

Normalization is process-local until the next request appends its header. A restart before any new turn may derive the old value again, but the same admission check repairs it without failing the turn. Unavailable models remain untouched instead of being replaced with an invented route.

## Testing

`packages/host/apiproxy/tests/api-proxy-models.spec.ts` covers a logged `off` restored against a model with no reasoning levels and a logged unsupported level restored against a model with a different current default. The latter enters through `session.prompt` and verifies the selection captured by `agent/request`.
