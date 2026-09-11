# Agent Note: 9Router dynamic models synchronization UI and Remote methods

Status: implemented

English | [中文](2026-09-04-9router-models-sync-ui-panel.zh.md)

## Problem

The 9Router multi-provider router provides hundreds of models and dynamic routes whose availability changes over time. While scheduled synchronization updates `settings.yaml` periodically, users previously lacked visibility into synchronization recency, active model counts, stale diagnostics, or a way to trigger an immediate manual synchronization directly from the Settings Models GUI.

## Decision

We introduced a live synchronization telemetry and trigger subsystem across the LLM service Remotes and the settings models UI:

1. **Host-Side Telemetry and Execution Seam:**
   - `packages/llm/llm/src/router-sync.ts` reads the persistent synchronization state file (`sync-9router-models-state.json`), detects stale status (> 24 hours), reads execution failure logs, and executes immediate sync via `sync-9router-models.mjs`.
   - Extended `LlmRuntime` with `@Remote` methods `routerSyncStatus` and `triggerRouterSync`, exported through `@deepseek-ai/dsh-llm/remote` and assembled in `@deepseek-ai/dsh-api-remotes/client`.
   - Added schema validation and typed telemetry structures (`RouterSyncStatus`).

2. **Client-Side Presentation Component:**
   - Created `RouterSyncPanel` in `packages/client/ui-settings-models/src/client/RouterSyncPanel.tsx`.
   - Rendered operational, stale, and error badges, active chat model counts, last synchronized timestamp, telemetry chips (vision, reasoning, latency), and a manual "Sync now" action button.
   - Mounted the panel inside `ProviderEditor.tsx` conditionally when editing the `9router` provider via `operations.getRouterSyncStatus` and `operations.triggerRouterSync`.
   - Styled with design system semantic tokens in `ModelsSection.module.css` and localized with `en` and `zh` dictionaries in `locales.ts`.

## Alternatives considered

- **Automatic continuous polling inside the web client:** Rejected to prevent unnecessary RPC traffic; status is read on load and refreshed immediately upon user trigger.
- **Generic discovery button alone:** Rejected because 9Router requires custom route filtering and metadata projection into settings rather than generic endpoint listing.

## Consequences

Users can inspect 9Router synchronization health directly in the UI and trigger immediate model list refreshes without leaving the harness or interacting with the OS task scheduler.

## Verification

Unit tests in `packages/llm/llm/tests/router-sync.spec.ts` verify status reading, staleness detection, and error extraction. Component tests in `packages/client/ui-settings-models/tests/router-sync-panel.client.spec.tsx` verify badge rendering, button state transitions, and error states. Repository typecheck, lint, and GUI test suites pass cleanly.
