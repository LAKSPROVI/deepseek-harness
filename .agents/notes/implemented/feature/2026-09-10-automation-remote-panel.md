# Agent Note: Persistent automation Remote panel

Status: implemented

English | [中文](2026-09-10-automation-remote-panel.zh.md)

## Problem

The persistent automation engine owns `store.json` on the Host, while the browser cannot read Host services or files directly. Chat tools can control the engine, but users cannot inspect scheduled work or invoke the same controls from the native interface.

## Decision

`@deepseek-ai/dsh-automation` provides one Host-owned `automation` service and an `automations` Typert Remote namespace. The generated Client contribution exposes list, trigger, pause, and resume methods. The private `client-ui-automation` package mounts that contribution and registers one conversation-header panel. The panel reloads Host state after each action and sends only task identifiers; owner selection stays in Host configuration.

The service opens the existing configured store path without data migration. Listing is read-only. Trigger, pause, and resume use the engine's existing store, worker, scheduler, and reaper instance; a profile must replace the prior user-space engine row rather than run a second store owner.

## Alternatives considered

**A browser REST endpoint.** Rejected because it duplicates the Typert transport and bypasses the generated Remote authorization and codec path.

**Reading `store.json` in the browser.** Rejected because the browser cannot safely access Host files and would create a stale second state source.

## Consequences

The generated Remote returns owner-scoped JSON task views. The native panel lists tasks and invokes the existing trigger, pause, and resume controls. Listing does not write the store. The Web profile mounts one Host engine and one Client panel contribution.

The personal Web composition also retains the Agent Teams Host service and browser panel beside the automation panel. Conversation history, workspace status controls, notes, branding, and voice input remain separate Client contributions and continue to use the canonical session store.

## Risks

The package must not be composed beside the user-space Host engine, because independent in-memory stores could overwrite each other's writes. Deployment disables that duplicate row while preserving its files for rollback.
