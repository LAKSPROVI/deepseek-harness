# Agent Note: Browser-local session status overlays and the fixed Recentes section

Status: implemented

English | [中文](2026-09-25-workspace-session-status-overlays.zh.md)

## Problem

The upstream 0.1.6 workspace redesign replaced the fork's per-session triage with a unified `SessionStatuses` map holding live Host facts (running, pending interaction, completion-unread). It dropped the user-asserted layer entirely: there was no way to mark a session as Finalizado or Concluir Depois, no unread-by-decision state, and the fixed Recent / In Progress section above the workspace tree disappeared with the old derivation.

## Decision

The browser view store keeps one persisted map, `customSessionStatuses: Record<string, CustomSessionStatus | undefined>`, holding every user-selected status (`ongoing`, `warning`, `unread`, `later`, `completed`, `finalized`, `idle`). A single `setSessionStatus` action writes it; the session list derivation carries the value onto each `SessionNode.customStatus` through an optional overlay parameter on `sessionNode`, `deriveFlat`, and `deriveGroups`, so live Host facts stay the exclusive source of running and completion state.

`deriveRecentAndInProgress` derives the fixed top section from the unified status map plus the overlay: it excludes sessions the user marked completed, finalized, or idle, includes every session that is running, has running subagents, awaits an interaction, has an unread completion, or carries the later or warning overlay, and caps the section at six rows in recency order. Each row renders with the owning Workspace title as a badge. Row status presentation orders pending interaction first, then the warning overlay, then running, then subagents, then the finalized, later, and unread overlay dots; `data-state` attributes mark the overlay dots so tests and assistive tooling can address them. The row menu sets any status directly through `setSessionStatus`; the tree, flat list, and recent rows share one handler.

## Alternatives considered

**Persist three maps (completed, unread, custom) as the fork did.** The fork's storage split the same fact across three records and needed cross-map bookkeeping on every write. One map derives the rest by value comparison.

**Derive completed state from `completionUnread`.** That flag belongs to the Host: it reports an observed stop that was not viewed. A user asserting Finalizado is a decision about the session, not an observation about a turn, and overloading the flag would make replay disagree with the browser.

**Keep the section client-only.** Persisting in the view store keeps the section identical across reloads without a new session event, matching how ordering and expansion already persist.

## Consequences

The overlay rides existing derivation seams: no new session event, no new persistence format, and no host-plane change. Reading it is optional everywhere, so a composition that never sets a status behaves exactly as upstream. The `customSessionStatuses` field rehydrates through the store's persisted blob; a pre-overlay `dsh.workspace.view.v5` state fills it as an empty map on first write. Rows the user marks completed or finalized stay in their groups and leave the fixed section; the recent section recomputes on the state echo alone. The browser test pins the section's rendering contract: header label, workspace badge, one-click open, and the ongoing dot on the active row.

## Testing

The workspace-browser client spec covers the fixed section end to end: mounting with a running session and an idle sibling renders the section above the tree, shows the Workspace badge in both the section row and the group header, exposes `data-state="ongoing"` on the running row, and opens the session on one click. The full workspace suite (218 tests) and the host and client typecheck pass with the overlay wired through the tree, flat list, and recent rows.
