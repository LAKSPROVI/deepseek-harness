# Agent Note: Large-session history load

Status: implemented

English | [中文](2026-09-06-large-session-history-load.zh.md)

## Problem

Opening a very large session in the web client either hung for over a minute or failed with `Failed to load history: signal timed out (internal)`. The largest session in one operator's archive (a 31 MB compressed event log) took a measured 76 seconds — 162 seconds under machine load — to serve a single `session.history` page of `PAGE_MESSAGES` (50) messages, because the host computes a render view for every tool event on the page at pagination time. The browser carrier (`AbstractApiClient` in `packages/host/apiproxy/src/fetch/client.ts`) applies a fixed 30-second `AbortSignal.timeout` to bounded unary calls, and `session.history` used the default policy. `doOpen` in `packages/client/runtime/src/client/sessions/session.ts` retries once on that timeout, also at 30 seconds, so a session whose page takes longer than ~30 seconds could never open.

## Decision

Two changes, both in the client-facing path:

- A third `UnaryTimeoutPolicy`, `'extended'` (`EXTENDED_TIMEOUT_MS = 180_000`), is applied to `session.history` and `subagent.history` only. Every other unary call keeps the 30-second health deadline. These two are user-initiated reads with connection-level cancellation, so a generous ceiling is safe while still bounding a genuinely hung host.
- `doOpen` for a top-level session (`this.address === undefined`) requests `FIRST_PAGE_MESSAGES` (8) instead of `PAGE_MESSAGES` (50). `session.history` cost is roughly linear in the message count of the page, so the recent exchanges render in seconds; `loadOlder` still pulls `PAGE_MESSAGES` on scroll. Subagent opens keep the full page — a less hot path, and several tests pin the exact `subagent.history` request.

## Verification

`session.client.spec.ts` and `manager.client.spec.ts` pass (112 tests): the regular-session assertions check history-call count and `beforeSeq`, never the first page's `maxMessages`, and the subagent assertions still see `maxMessages: 50`. Measured against the running backend, an 8-message first page for the 31 MB session returns well inside the 180-second ceiling with the recent turns visible.

## Alternatives considered

- **Remove the deadline for history reads (`'caller-signal-only'`)** — rejected: a genuinely hung host would leave the open spinner forever with no feedback; a large but finite ceiling preserves a failure signal.
- **Shrink `PAGE_MESSAGES` for every page** — rejected: it would add a `loadOlder` round-trip for ordinary sessions with no upside, and a first-page-only knob keeps normal paging untouched.
- **Shrink the first page for subagents too** — rejected here: the subagent open path is colder and `session.client.spec.ts` / `manager.client.spec.ts` assert its exact `maxMessages`; the win is on the top-level session list where the large sessions live.
- **Compute tool-event views lazily on the host instead of at pagination time** — deferred: the correct long-term fix for the underlying cost, but a structural change to how the host and the shared client fold divide the work, out of scope for a load-time regression.

## Consequences

A very large session opens showing its 8 most recent messages in seconds instead of blocking on the whole tail page, and no session errors on a slow history read below 180 seconds. A top-level session now always costs one extra `loadOlder` to see message 9 and older. The underlying per-page view-computation cost is unchanged; a session pathological enough to exceed 180 seconds for 8 messages would still fail, and the lazy-view work above is the remedy if that appears.
