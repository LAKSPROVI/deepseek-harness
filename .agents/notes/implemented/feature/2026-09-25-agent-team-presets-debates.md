# Agent Note: Agent Teams reusable presets and structured debates

Status: implemented

English | [中文](2026-09-25-agent-team-presets-debates.zh.md)

## Problem

The Team Lead can create a teammate only by writing its complete specification inline at spawn time. Recurring multi-member compositions are retyped every session, tearing down a full roster costs one interrupt call per teammate, and a team that needs adversarial review has no structured, auditable deliberation artifact - the debate collapses into untracked chat messages.

## Decision

Two mechanisms extend the Team domain, both riding the existing journal and tool seams.

**Reusable presets.** `templates.ts` owns schemastery-validated settings under the `agent-team-templates` namespace: at most fifty teammate templates and twenty squad presets of one to nine members, with a cross-field check that routes provider and model together. `team_template_save`, `team_template_list`, and `team_template_delete` manage templates; `team_squad_save`, `team_squad_list`, `team_squad_delete`, and `team_squad_spawn` manage squads and instantiate a whole squad in one batch. `spawn_teammate` accepts an optional `template_id` and fills every missing field from the saved template, keeping explicit arguments authoritative. `team_roster_dismiss` batch-interrupts all active teammates or a named subset. The tools read the namespace through `ctx.get` at call time, so a composition without the settings service keeps every Team tool installed and only the preset tools fail, with a clear error naming the missing service.

**Structured debates.** `TeamDebateBoard` owns at most one current debate per Team through the Team journal: whole-value `team/debate` events with compare-and-set revisions, five ordered phases (positions, critique, rebuttal, verification, synthesis) over up to `maxDebateRounds` rounds, and an append-only transition history. Only the Lead starts or transitions a debate; participants must be two through ten live member names. `team_debate_start`, `team_debate_get`, and `team_debate_update` expose the protocol to the model, and `TeamDebateMutationResult` carries Team rejections as business results across the Remote seam, matching the task board's error contract.

## Alternatives considered

**Per-request squad composition only.** Without persisted presets every session retypes prompts and loses the curated roster's provenance. Settings persistence makes a reviewed composition reusable across teams.

**Debates as tasks on the shared DAG.** Task claim and collaboration semantics do not capture a phase protocol or compare-and-set round transitions; a debate is a protocol with a history, not a work item, and reusing task revisions would conflate the two CAS domains.

**A separate debate service.** The journal already owns transaction serialization, append-and-flush, and the whole-value projection pattern; `TeamTaskBoard` is the precedent. A second seam would duplicate the transaction tail per Team.

## Consequences

A deployment must register the `agent-team-templates` namespace for the preset tools to operate; the registration is an effect, so disposing the registrant removes it. `maxDebateRounds` defaults to eight and caps the `max_rounds` argument. The projection validates debate revision contiguity and reports a failure through the projection state, never inventing transitions. Contributions during a debate flow through `send_message`: a per-participant compare-and-set contribution record was designed and deliberately omitted, keeping the durable surface to the protocol transitions. The new `team/debate` event required `isTeamEvent`, `MutableTeamEventType`, the zod event schema, and the persisted-state entry schema to grow together, and the Remote signatures classify their types on the `agent-team` subsystem page.

## Testing

The focused suites cover both mechanisms end to end: template and squad save/list/delete cycles against a registered settings namespace, `spawn_teammate` template expansion with explicit-argument overrides, batch dismissal, name normalization, and the full two-round debate protocol - Lead authority rejection, duplicate-start rejection, pause, resume, stale-revision rejection, nine phase advances, completion from synthesis, and history length equal to the revision count. `pnpm exec vitest run packages/experimental/agent-team packages/experimental/tool-agent-team` passes 96/96; `tsc -b tsconfig.host.json` and `tsc -b tsconfig.client.json` are clean; the generated tool, config, and Cordis catalogs regenerate in this change with their bilingual counterparts recorded.
