# Agent Note: Router availability controls selectable models

Status: implemented

English | [中文](2026-10-07-router-live-catalog.zh.md)

## Problem

An operational router synchronizer can retain unusable choices when it reads a delayed monitor, writes an already imported legacy settings file, or refuses an empty listing. The pi-ai adapter also rejects a custom route with zero models, preventing withdrawal during a complete outage.

## Decision

The optional [synchronizer](../../../../scripts/sync-router-live-models.mjs) reads the authenticated strict catalog and requires fresh semantic Anthropic text, tools, and streaming proofs. It updates only the existing provider's model list through revision-checked Settings RPC, backing up the active patch and retaining per-model options by exact ID. An empty or unconfirmed catalog withdraws all selectable choices. A hand-declared route with an explicit protocol and endpoint can have zero models; installed catalog providers retain their existing defaults.

The watcher polls every 30 seconds by default and handles manual refresh requests through the same owner. The status reader uses the current cycle's validity deadline and sanitized failure, so a historical log cannot override a recovered state. The enrolled runtime also filters its native catalog and refuses unconfirmed model resolution or dispatch. State-file changes and an expiration timer notify the existing native model directory even when the watcher stops, without modifying session selections or an in-flight stream.

## Alternatives considered

**Keep the previous list on failure.** This presents unconfirmed models as available throughout an outage and defeats the requested availability contract.

**Write the legacy settings document.** The current Settings service imports that document into a profile patch; subsequent writes need not reach the active consumer. RPC supplies revision checks and native change events.

**Copy an OpenAI client catalog.** Anthropic tools and streaming require separate proofs. Generic success and capability claims cannot establish this client protocol.

## Consequences

A temporary catalog failure can leave no selectable models until recovery. Existing session selections remain visible as unavailable rather than being rerouted. Refresh has a bounded polling delay and does not guarantee future provider uptime. A stopped local backend cannot receive changes until it returns. [Usage](../../../../docs/user/router-live-catalog.md) and the CLI transport, live-configuration, and status-reader regressions define the supported flow.
