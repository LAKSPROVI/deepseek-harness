# Agent Note: Router runtime evidence owns availability

Status: implemented

English | [中文](2026-10-11-router-runtime-evidence.zh.md)

## Problem

Publishing a live catalog through persistent Settings couples availability to component reloads. A cycle-wide lease can withdraw fresh models when a local query is delayed, including after a completed tool call.

## Decision

The optional synchronizer publishes a schema-2 runtime snapshot separately from persistent Settings. Each exact model ID retains its original checked time and expiry, bounded to ten minutes. The native directory receives file notifications and a 30-second fallback; dispatch independently verifies evidence and the projected tools.

Two transient network, timeout, or server-error attempts retain only unexpired proofs without extending them. Authoritative removal, negative evidence, authentication failure, or malformed evidence withdraws choices. Per-ID checked and revoked watermarks survive an empty snapshot and prevent older responses from restoring revoked models.

Evidence is scoped to the URL, protocol, credential reference, and actual credential value. Prepared calls retain that binding. Exact-ID options and configured capacity limits survive directory merging. Expired known models can request one renewal with cancellation and a maximum 20-second wait; completed tool results remain in history without repeating tools or silently switching models.

This partially supersedes the publication and cycle-lease policy in the [earlier decision](../bug-fix/2026-10-07-router-live-catalog.md). Its scoped configuration reads and zero-model route contract remain current. Legacy snapshots retain their 60-second confirmation limit.

## Alternatives considered

**Reload persistent Settings every cycle.** Configuration inheritance and component reloads add work unrelated to availability and can interrupt the consumer.

**Keep an old list indefinitely.** A transport failure does not renew upstream evidence; expiry and authoritative withdrawal remain mandatory.

**Switch models after a tool completes.** Silent switching changes the requested execution and risks repeating external actions.

## Consequences

Availability is independent of configured model metadata and does not guarantee future provider uptime. The default directory applies the actual tool presentation: router `gh/gpt*` routes accept at most 128 native schemas. A larger presentation excludes those choices without dropping configured tools. [Usage](../../../../docs/user/router-live-catalog.md) describes synchronization and recovery.
