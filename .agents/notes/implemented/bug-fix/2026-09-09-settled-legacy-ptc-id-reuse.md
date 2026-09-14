# Agent Note: Settled legacy PTC identifier reuse

Status: implemented

English | [中文](2026-09-09-settled-legacy-ptc-id-reuse.zh.md)

## Problem

Released V0 histories can reuse a `tool/code-dispatch` `subCallId` after its earlier dispatch settled. The original relationship validator retained every completed start forever and therefore treated a later, complete pair as a duplicate. That turns an intact historical conversation into a migration refusal even though the two executions do not overlap.

## Decision

The V0-to-V1 relationship validator retains a PTC start only until its matching `tool/code-dispatch` arrives. It then removes that active start while retaining the child-to-root ancestry record. A later start may reuse the identifier only under that same root; a concurrent duplicate still fails, a dispatch without an active start still fails, and a changed root still fails.

## Alternatives considered

**Keep every completed start.** Rejected because the durable V0 representation reuses identifiers after completion, so permanent retention mistakes a completed lifecycle for an active one.

**Forget the child root together with the completed start.** Rejected because later nested PTC ancestry still needs the root mapping to reject a changed root or an unrelated parent.

**Accept every repeated start.** Rejected because two unresolved starts with one identifier cannot be paired unambiguously with a later dispatch.

## Consequences

Completed historical PTC pairs can recur without rewriting the source artifact. Relationship coverage keeps rejection of concurrent duplicates and proves reuse after settlement under the original root. The migration continues to reject mismatched start/dispatch payloads, missing starts, changed roots, and invalid parent ancestry.
