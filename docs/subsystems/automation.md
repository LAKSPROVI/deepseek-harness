# Task automation

English | [中文](automation.zh.md)

The Automation subsystem owns durable scheduled tasks that run outside any live conversation turn: a file-backed store, a recurrence scheduler, an execution worker, a crash-recovery reaper, and a Server-Sent Events stream that keeps the Web panel current. One Host-owned engine (`ctx.automation`) owns the store and publishes the `automations` Typert Remote namespace, so every surface reads the same task records. The [package README](../../packages/automation/automation/README.md) owns recurrence grammar, worker semantics, persistence layout, and notification behavior; the [implemented Agent Note](../../.agents/notes/implemented/feature/2026-09-10-automation-remote-panel.md) records why the standalone engine was folded into the Host.

## Durable records

A task carries a stable id, an owner, a display name, an action descriptor, an optional recurrence, and a lifecycle state (`ACTIVE`, `PAUSED`, `COMPLETED`, `ERROR`, `ARCHIVED`). Every execution appends a `TaskRun` record with its logs; the reaper sweeps runs left in `RUNNING` by a Host crash and marks them `TIMED_OUT` or `FAILED` so a restart never inherits a phantom lock. Ownership is enforced at the seam: a task id that exists but belongs to another owner surfaces as `automation/not-found`, never as a partial read.

## Remote and Chat surfaces

The `automations` Remote namespace exposes `list`, `trigger`, `pause`, and `resume`; `pause` and `resume` return the projected `AutomationTaskView` and `trigger` returns an `AutomationTriggerReceipt`, so the browser panel in [`packages/experimental/client-ui-automation`](../../packages/experimental/client-ui-automation/README.md) re-renders without a second read. Creating and deleting tasks is not exposed by the Cordis service: `AutomationApiRouter` and `AutomationSseStreamer` are library exports an embedder mounts on its own HTTP server, and no Chat tool exists yet. A task added through either path lands in the same store and appears in the panel on its next reload.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxautomation--automationservice"></a>

### `ctx.automation` — `AutomationService`

One Host-owned engine that keeps its store, scheduler, and controls together.

```ts cordis-catalog
/**
 * List the deployment owner's persisted tasks without modifying the store.
 *
 * @returns Persisted automation tasks projected for the browser client.
 */
@Remote('list') async list(): Promise<readonly { readonly id: string readonly title: string readonly description?: string readonly scheduleType: 'ONCE' | 'INTERVAL' | 'CRON' | 'RRULE' readonly status: 'ACTIVE' | 'PAUSED' | 'COMPLETED' | 'ERROR' | 'ARCHIVED' readonly nextRunAt: string | null readonly lastRunAt: string | null readonly totalRunsCompleted: number readonly maxRuns: number | null readonly createdAt: string readonly updatedAt: string }[]>

/**
 * Queue one owned task immediately while leaving its recurrence unchanged.
 *
 * @param taskId Persisted automation task identifier.
 * @returns Identifier of the queued automation run.
 */
@Remote('trigger') async trigger(taskId: string): Promise<{ readonly runId: string }>

/**
 * Pause one owned task.
 *
 * @param taskId Persisted automation task identifier.
 * @returns Updated task projected for the browser client.
 */
@Remote('pause') async pause(taskId: string): Promise<{ readonly id: string readonly title: string readonly description?: string readonly scheduleType: 'ONCE' | 'INTERVAL' | 'CRON' | 'RRULE' readonly status: 'ACTIVE' | 'PAUSED' | 'COMPLETED' | 'ERROR' | 'ARCHIVED' readonly nextRunAt: string | null readonly lastRunAt: string | null readonly totalRunsCompleted: number readonly maxRuns: number | null readonly createdAt: string readonly updatedAt: string }>

/**
 * Resume one owned task and calculate its next run.
 *
 * @param taskId Persisted automation task identifier.
 * @returns Updated task projected for the browser client.
 */
@Remote('resume') async resume(taskId: string): Promise<{ readonly id: string readonly title: string readonly description?: string readonly scheduleType: 'ONCE' | 'INTERVAL' | 'CRON' | 'RRULE' readonly status: 'ACTIVE' | 'PAUSED' | 'COMPLETED' | 'ERROR' | 'ARCHIVED' readonly nextRunAt: string | null readonly lastRunAt: string | null readonly totalRunsCompleted: number readonly maxRuns: number | null readonly createdAt: string readonly updatedAt: string }>

/**
 * Existing Chat-tool entrypoint for a manual run.
 *
 * @param taskId Persisted automation task identifier.
 * @returns Receipt identifying the queued automation run.
 */
async triggerNow(taskId: string): Promise<AutomationTriggerReceipt>

/**
 * Existing Chat-tool entrypoint for a resumed schedule.
 *
 * @param taskId Persisted automation task identifier.
 * @returns Updated automation task view.
 */
async resumeTask(taskId: string): Promise<AutomationTaskView>
```

Source: [`packages/automation/automation/src/service.ts`](../../packages/automation/automation/src/service.ts)
<!-- END GENERATED cordis-surface -->
