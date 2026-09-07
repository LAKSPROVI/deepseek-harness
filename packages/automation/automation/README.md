# @deepseek-ai/dsh-automation

Enterprise-grade task automation engine, complex recurrence scheduler, concurrent execution supervisor, crash recovery daemon, real-time Server-Sent Events (SSE) notification stream, and Cordis Web GUI dynamic integration.

---

## 1. Architecture Overview

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

---

## 2. Core Capabilities

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

---

## 3. DeepSeek Harness Dynamic Cordis Integration

The module includes dynamic Cordis extensions that seamlessly mount into the Web GUI:

1. **Dedicated View Tab (`conversation.view`):**
   - Registered at the top navigation bar alongside `Chat`, `Trajectory`, and `Agent Team`.
   - Leaves the composer and chat conversation area 100% clean and unobstructed.
2. **Native Dark Design Tokens:**
   - Adheres strictly to DSH theme variables: `--dsw-alias-bg-base`, `--dsw-alias-bg-layer-1`, `--dsw-alias-bg-layer-2`, `--dsw-alias-border-l1`, `--dsw-alias-border-l2`, `--dsw-alias-label-primary`, `--dsw-alias-label-secondary`, etc.
3. **Conversational Agent Tools:**
   - `automation_create_task`: Allows the model to parse natural language requests (text or voice) and schedule tasks automatically.
   - `automation_list_tasks`: Inspects scheduled routines directly from chat.
   - `automation_trigger_task`: Triggers on-demand execution from conversational commands.
   - `automation_delete_task`: Removes routines via chat.

---

## 4. Model Experience

- **Context Overhead:** Minimal. Tool schemas declare strict parameter boundaries with zero redundant tokens.
- **Prompt Visibility:** Scheduled tasks and run outcomes are serialized into lossless JSON records when queried.
- **KV-Cache Friendly:** Stable tool signatures avoid cache thrashing.

---

## 5. Verification & Tests

Run the full automated test suite (15 tests across 4 test suites):

```bash
npx vitest run packages/automation/automation/tests
```

Suites included:
- `tests/recurrence.spec.ts`: Unit tests for cron expressions, intervals, and max-run calculations.
- `tests/automation.spec.ts`: End-to-end task execution, scheduler cycles, and notification delivery.
- `tests/advanced.spec.ts`: Timeout guards, overlap skip policies, and stale task reaper recovery.
- `tests/persistence_api.spec.ts`: Atomic disk persistence, REST API router handlers, and SSE streaming.
