---
description: "Task automation engine: recurrence scheduler, execution worker, crash-recovery reaper, atomic file store, SSE stream, and Web GUI integration."
kind: "package-reference"
---

# @deepseek-ai/dsh-automation

English | [中文](README.zh.md)

## Summary

Enterprise-grade task automation engine, complex recurrence scheduler, concurrent execution supervisor, crash recovery daemon, real-time Server-Sent Events (SSE) notification stream, and Cordis Web GUI dynamic integration.

-----

## Table of Contents

- [Architecture Overview](#architecture-overview)
- [Core Capabilities](#core-capabilities)
- [DeepSeek Harness Cordis integration](#deepseek-harness-dynamic-cordis-integration)
- [Verification & Tests](#verification-tests)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="architecture-overview"></a>
## Architecture Overview

`@deepseek-ai/dsh-automation` provides a robust, zero-dependency task scheduling and execution pipeline designed for mission-critical routines:

```
                  ┌────────────────────────────────────────────────────────┐
                  │                 User / Chat / Web GUI                  │
                  └───────────┬────────────────────────────────┬───────────┘
                              │                                │
                [Natural Language via Tools]        [REST API / Web UI]
                              │                                │
                              ▼                                ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                           Automation Engine                              │
│                                                                          │
│  ┌──────────────────────┐   ┌───────────────────┐   ┌─────────────────┐  │
│  │   RecurrenceEngine   │   │  AutomationStore  │   │ StaleTaskReaper │  │
│  │ (SimpleCron / RRULE) │   │ (Atomic Disk/Mem) │   │ (Crash Recovery)│  │
│  └──────────┬───────────┘   └─────────┬─────────┘   └────────┬────────┘  │
│             │                         │                      │           │
│             └────────────────┐        │        ┌─────────────┘           │
│                              ▼        ▼        ▼                         │
│                     ┌─────────────────────────────────┐                  │
│                     │       AutomationScheduler       │                  │
│                     │    (Atomic polling & locking)   │                  │
│                     └────────────────┬────────────────┘                  │
│                                      │                                   │
│                                      ▼                                   │
│                     ┌─────────────────────────────────┐                  │
│                     │           TaskWorker            │                  │
│                     │  (Run isolation, timeout guard) │                  │
│                     └────────────────┬────────────────┘                  │
│                                      │                                   │
│                                      ▼                                   │
│                     ┌─────────────────────────────────┐                  │
│                     │       NotificationService       │                  │
│                     │    (Pub/Sub, Run context, SSE)  │                  │
│                     └────────────────┬────────────────┘                  │
└──────────────────────────────────────┼───────────────────────────────────┘
                                       │
                                       ▼
                       [Real-Time SSE Stream & Web UI]
```

-----

<a id="core-capabilities"></a>
## Core Capabilities

### 2.1 Scheduling & Recurrence Engine (`src/recurrence.ts`, `src/cron.ts`)
- **`ONCE`**: Single-shot execution at a specific future ISO-8601 timestamp.
- **`INTERVAL`**: Periodic execution every $N$ seconds (e.g., `3600` for 1 hour, `300` for 5 minutes).
- **`CRON`**: Pure UTC zero-dependency 5-part cron parser (`SimpleCron`) supporting standard ranges, lists, intervals, and wildcards (`min hour dom month dow`).
- **`RRULE`**: Recurrence rules with full IANA timezone translation (`America/Sao_Paulo`, `UTC`, etc.).
- **Termination Bounds**: Finite runs via `maxRuns` or expiration via `endAt`. Indefinite recurring schedules when omitted.

### 2.2 Execution Supervisor & Resilience (`src/worker.ts`, `src/reaper.ts`)
- **Execution Lifecycle**: Discrete `TaskRun` entities tracking `QUEUED` $\to$ `RUNNING` $\to$ `SUCCESS` / `FAILED` / `TIMED_OUT`.
- **Overlap Protection**: Configurable overlap policies (`SKIP` to prevent overlapping runs, `ALLOW`, or `QUEUE`).
- **Timeout Guard**: Per-task execution timeout enforcing cancellation and failure logging if a routine hangs.
- **Structured Execution Logs**: In-memory and persisted ring buffers capturing log levels (`info`, `warn`, `error`) with ISO timestamps.
- **Crash Recovery Daemon (`StaleTaskReaper`)**: Periodically sweeps tasks left in `RUNNING` state due to host crashes, releases locks, marks runs as `TIMED_OUT`/`FAILED`, and alerts the user.

### 2.3 Persistence Layer (`src/persistence.ts`, `src/store.ts`)
- **Atomic File Store (`FileAutomationStore`)**:
  - Thread-safe write-queue lock (`writeLock`).
  - Safe staging via temporary file creation (`.tmp`) followed by atomic filesystem rename (`fs.rename`).
  - Zero risk of JSON file corruption during unexpected power loss or process kill.

### 2.4 Notifications & Real-Time Transport (`src/notifier.ts`, `src/sse.ts`, `src/api.ts`)
- **Task-Run Context**: Every notification carries `taskId`, `runId`, timestamp, read status, and structured metadata.
- **SSE Streamer (`AutomationSseStreamer`)**: Native Server-Sent Events transport broadcasting instant run events and alerts to active browser clients.
- **REST API Router (`AutomationApiRouter`)**:
  - `GET /tasks`: List all tasks with status and recurrence details.
  - `POST /tasks`: Create/schedule a new task.
  - `DELETE /tasks/:id`: Delete an existing task.
  - `POST /tasks/:id/trigger`: Immediately trigger on-demand execution.
  - `POST /tasks/:id/pause` / `POST /tasks/:id/resume`: Pause or resume schedules.
  - `GET /tasks/:id/runs`: View historical execution runs and logs.
  - `GET /notifications`: Retrieve unread/all notifications.
  - `POST /notifications/read-all`: Mark all notifications as read.
  - `GET /sse`: Connect browser client to live event stream.

-----

<a id="deepseek-harness-dynamic-cordis-integration"></a>
## DeepSeek Harness Cordis integration

`AutomationService` (`ctx.automation`, [`src/service.ts`](src/service.ts)) is the Cordis entry the Web profile loads. It composes the store, notifier, worker, scheduler, and reaper from the `storePath` in its config (a relative or `~` path resolves under the Harness home, `DSH_HOME`, never under the process cwd), starts scheduling and stale-run recovery as one effect when `enabled` is true, and publishes the `automations` Typert Remote namespace with four methods: `list`, `trigger`, `pause`, and `resume`. Ownership is fixed at boot (`userId`, default `host`); the browser never supplies an identity, and a task that exists but belongs to another owner answers `automation/not-found`.

[`@deepseek-ai/dsh-experimental-client-ui-automation`](../../experimental/client-ui-automation/README.md) mounts that namespace and renders the list and controls as a conversation-header action. `AutomationApiRouter` and `AutomationSseStreamer` remain library exports: the Cordis service mounts neither on `ctx.webServer`, so an embedder that wants the REST routes or the live stream wires them to its own HTTP server.

-----

<a id="verification-tests"></a>
## Verification & Tests

Run the package test suites:

```bash
npx vitest run packages/automation/automation/tests
```

Suites included:
- `tests/recurrence.spec.ts`: Unit tests for cron expressions, intervals, and max-run calculations.
- `tests/automation.spec.ts`: End-to-end task execution, scheduler cycles, and notification delivery.
- `tests/advanced.spec.ts`: Timeout guards, overlap skip policies, and stale task reaper recovery.
- `tests/persistence_api.spec.ts`: Atomic disk persistence, REST API router handlers, and SSE streaming.
- `tests/remote-service.spec.ts`: The Cordis service, its `automations` Remote namespace, and ownership failures.

<a id="model-experience"></a>
## Model Experience

None, as the engine registers no tool, prompt section, or session event; a run's output reaches a model only through an action handler the deployment registers.

#### KV Cache effect

Independent of every model request: no task record or run log enters a request from this package, so it neither builds nor invalidates a reusable prefix.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **No create or delete Remote method** — the `automations` namespace exposes only `list`, `trigger`, `pause`, and `resume`; a task enters the store through `AutomationApiRouter` mounted by an embedder or through the store API directly.
- **No Chat tools** — the engine registers nothing model-facing; conversational scheduling is deferred until a tool package owns the schema and the result rendering.
- **REST router and SSE stream are not mounted by the Cordis service** — they are library exports; the Web profile exposes only the Remote namespace.
- **The Web profile registers no action handlers** — `TaskWorker.registerHandler` is the seam; a triggered run whose `actionType` has no handler is recorded as failed.
- **One configured owner** — `AutomationController` serves the Host-configured `userId` only; multi-user isolation is not implemented.
- **`RRULE` support is the subset the engine parses** — it is not a complete RFC 5545 parser; an unsupported rule fails next-run calculation instead of silently approximating.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
