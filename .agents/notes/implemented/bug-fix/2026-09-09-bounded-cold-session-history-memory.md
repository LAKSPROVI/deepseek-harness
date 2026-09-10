# Agent Note: Bounded cold-session history memory

Status: implemented

English | [中文](2026-09-09-bounded-cold-session-history-memory.zh.md)

## Problem

A cold history observation restores and retains the complete decoded Session log even when the client requests only a tail page. The count-based cache can therefore retain several large logs whose combined resident memory exceeds the Node.js heap limit, terminating the Web backend and making an intact session catalog appear unavailable.

## Decision

The [session-query configuration](../../../../packages/session-query/session-query/src/config.ts) retains one unpinned prepared cold observation by default. Explicit `preparedSessionCacheSize` values remain supported for deployments that have measured capacity, and active leases remain pinned until their owner disposes them.

The [Session client](../../../../packages/api/session-controller/src/client/sessions/session.ts) requests eight messages for an ordinary Session's opening snapshot. Later paging keeps the 50-message page size, and direct subagent transcripts keep 50 messages on open.

The cache policy bounds retained complete logs between ordinary history opens; the smaller opening snapshot separately bounds the records projected and transferred for the first visible page. Neither rule changes persistence or writes to stored histories.

## Alternatives considered

**Raise the Node.js heap limit.** Rejected because it delays termination while allowing retained cold logs to grow with machine memory, and it makes correctness depend on launcher-specific process flags.

**Estimate a byte-weighted cache from persistence revisions.** Rejected because the persistence revision does not expose a portable decoded resident-memory cost, and compressed file bytes do not bound the restored object graph. A count of one provides a predictable default without publishing a misleading byte guarantee.

**Disable prepared-observation reuse.** Rejected because reopening the current cold Session would decode and restore the same complete log again. One entry preserves the common reuse path while evicting an earlier unpinned history.

## Consequences

Sequential navigation across large cold histories retains at most one unpinned complete restored log under the default configuration, which trades cross-session cache hits for bounded accumulation. A new cold open can temporarily coexist with the previous entry while it is decoded, and concurrent active leases can exceed the configured count until their owners dispose them. Operators who raise `preparedSessionCacheSize` accept the corresponding whole-log memory cost.

Ordinary conversations display their recent tail from a smaller first response and load older messages through the existing paging path. The stored session format, event order, and history contents remain unchanged.
