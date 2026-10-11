# Agent Note: Scoped configuration supports router availability

Status: implemented

English | [中文](2026-10-07-router-live-catalog.zh.md)

## Problem

Filtering Settings descriptors after inherited configuration composition still processes unrelated components. A custom route that rejects zero models cannot represent complete withdrawal.

## Decision

Scoped reads pass the namespace into ConfigEditor before inherited-layer composition and detached-value cloning. Full reads still enumerate all unique entries; missing IDs return no rows. A hand-declared route with an explicit protocol and endpoint can have zero models; installed catalog providers retain their defaults.

The [runtime evidence decision](../architecture/2026-10-11-router-runtime-evidence.md) supersedes this note's earlier Settings-publication and cycle-wide lease policy. Availability now uses a separate snapshot, with individual expiry and bounded retention of valid evidence during transient failures. The synchronizer follows the existing route protocol; configuration edits retain revision checks.

## Alternatives considered

**Filter only the final descriptors.** This leaves unrelated inheritance and cloning work in the read path.

**Write an imported legacy settings document.** Later writes need not reach the active profile consumer. Configuration changes require the current Settings service.

## Consequences

Real-profile regressions verify matching inheritance, secret redaction, missing IDs, and composition counts. These tests establish the scoped read contract, not live renewal latency or upstream tool behavior. [Usage](../../../../docs/user/router-live-catalog.md) documents the current availability flow.
