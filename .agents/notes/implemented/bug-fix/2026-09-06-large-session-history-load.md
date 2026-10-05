# Agent Note: Large-session history load

Status: implemented

English | [中文](2026-09-06-large-session-history-load.zh.md)

## Problem

Opening a very large session in the web client blocked for minutes. The largest session in one operator's archive (a 31 MB compressed event log) took a measured 76 seconds — 162 seconds under machine load — to serve one history page of `PAGE_MESSAGES` (50) messages, because the Host computes a render view for every tool event on the page at pagination time. The original fix (September 6, preserved on the pre-integration `claude/brave-germain-d1f107` branch under the old apiproxy client) paired an 180-second extended unary deadline with an 8-message first page; both were lost when the 0.1.7 upstream integration replaced that client wholesale, and this note went with them. The 2026-10-01 robustness audit found the regression re-opened in `packages/api/session-controller`: the open path again requested the full 50-message window.

## Decision

`doOpen` for a top-level session (`this.address === undefined`) opens with `FIRST_PAGE_MESSAGES` (8): `FIRST_PAGE_OPTIONS`, the ordinary history options with the `turnWindow` minimum lowered, so the recent exchanges render in seconds. `loadOlder()` still pulls `PAGE_MESSAGES` (50) on scroll, `loadThrough()` keeps its 200-message pages, and subagent openings keep the full page — a less hot path whose exact request shape several tests pin. Turn alignment is unchanged: every window still crosses at least two `turn/start` events under the 500-message cap, and the stream's reconnect replay reuses the open request, so a top-level session reconnects on the small window too. The extended-deadline half of the original fix has no equivalent in the 0.1.7 carrier, which applies no per-method timeout at all; that gap is tracked as separate open work (a carrier-level RPC deadline policy) rather than silently dropped again.

## Verification

`session.client.spec.ts` pins the top-level open's follow request at `minMessages: 8` (including a dedicated small-first-page test) and `loadOlder`'s page at 50; the subagent opening pins stay at 50. The three request-shaping specs (`session.client.spec.ts`, `manager.client.spec.ts`, `transport.client.spec.ts`) pass together.

## Alternatives considered

- **Re-port the old extended deadline instead of the page size** — rejected: the page size attacks the cost itself rather than tolerating it; a timeout change in the new carrier is separate work with a different blast radius.
- **Shrink `PAGE_MESSAGES` for every page** — rejected: it would add a `loadOlder` round-trip for ordinary sessions with no upside; a first-page-only knob keeps normal paging untouched.
- **Shrink the first page for subagents too** — rejected: the subagent open path is colder and several tests pin its exact request shape; the win is on the top-level session list where the large sessions live.
- **Compute tool-event views lazily on the Host instead of at pagination time** — deferred: the correct long-term fix for the underlying cost, but a structural change to how the Host and the shared client fold divide the work, out of scope for a load-time regression.

## Consequences

A very large session opens showing its recent exchanges in seconds instead of blocking on the whole tail page. A top-level session now always costs one extra `loadOlder` to see message 9 and older. The underlying per-page view-computation cost and the cold full-decode of a large log are unchanged — a pathological session can still take a long first page on a cold Host, and the lazy-view plus frame-indexed-read work is the deeper remedy if that appears. The re-sync lesson is now recorded here: incident fixes must be re-verified one by one against the surviving architecture, because a wholesale client replacement silently re-opens every fix it carried.
