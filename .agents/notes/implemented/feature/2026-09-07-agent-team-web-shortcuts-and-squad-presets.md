# Agent Note: Agent Teams quick guidance, task Kanban, debate export, and squad presets

Status: implemented

English | [中文](2026-09-07-agent-team-web-shortcuts-and-squad-presets.zh.md)

## Problem

Sending guidance to one teammate required manually switching to the **Orientar integrante** tab and picking the target from a dropdown, even when the operator is already looking at that teammate's roster card. Creating a task had no dedicated form, and a flat task list gave no per-status overview once a Team accumulated more than a handful of tasks. A debate's synthesis and transcript were readable only inside the Web view, with no way to carry them into another document or message.

Recruiting a fixed multi-agent shape — the same three or four teammate roles with their prompts, providers, and personas — required one `spawn_teammate` call per member and repeated cross-session copy-pasting of the same configuration. Cleaning up a Team of several finished or stalled teammates required one `interrupt_agent` call per name.

## Decision

The Web view (`ui-subagent`'s `AgentTeamView`) adds three controls: each teammate card in **Integrantes** carries a **💬 Orientar** shortcut that switches to the guidance tab pre-focused on that member; the **Tarefas** sidebar gains a task-creation form (subject, description, optional write scopes) and a List/Kanban toggle that groups tasks into pending/in-progress/completed columns; and **Debate** gains a one-click Markdown export that copies the debate synthesis, author-attributed contribution transcript, and phase transition history to the clipboard.

`tool-agent-team` adds two model-facing batch tools. `team_squad_spawn` instantiates every member of a saved squad preset in one call, looping `ctx.agentTeams.spawnTeammate()` per member with that member's stored name, description, prompt, context, provider, model, and persona. `team_squad_save`/`team_squad_list`/`team_squad_delete` manage squad presets (`SavedTeamSquad`: id, title, description, one to nine `SavedSquadMember` entries) the same way `team_template_save`/`list`/`delete` already manage single-teammate templates: both live under the Host `settings` service's `agent-team-templates` namespace, validated by the same `TeamTemplateSettingsSchema`, capped independently (`MAX_TEAM_TEMPLATE_COUNT` = 50 templates, `MAX_TEAM_SQUAD_COUNT` = 20 squads). `team_roster_dismiss` interrupts every active teammate, or only the named ones, in one call, tolerating names that are already inactive.

`agent-team` owns the `SavedTeamSquad`/`SavedSquadMember` types and the settings-schema validation that both the template and squad tools reuse; the package itself never reads or writes settings — `tool-agent-team` is the sole settings caller.

## Alternatives considered

**Sequential `spawn_teammate` calls instead of `team_squad_spawn`.** Rejected: a saved preset exists precisely to avoid repeating a known-good multi-member configuration turn after turn; a single batch tool call matches that intent and keeps the operation atomic from the model's perspective (a mid-loop failure still leaves already-spawned members intact, matching `spawn_teammate`'s own no-rollback failure mode).

**A separate settings namespace for squads.** Rejected: squads and templates share validation shape (duplicate-id rejection, paired provider/model requirement) and a shared namespace avoids a second settings key, a second schema, and a second migration path for what is structurally the same reusable-configuration feature at a different cardinality.

**Shipping squad and dismiss Web UI controls now.** Deferred: both ship as model-only tools first; the Web UI already exposes an equivalent one-at-a-time flow (`spawn_teammate`/`interrupt_agent` per member) so no capability is lost, and the dedicated batch UI is deferred to when a driving user request justifies its design. Recorded in both packages' READMEs under Known Limitations and Deferred Work.

## Consequences

`tool-agent-team` registers 22 tools per Team member scope, up from 14; the fixed per-request policy and schema cost documented in that package's Model Experience section grows accordingly. Squad presets share the same 50-template/20-squad cap accounting and settings namespace as teammate templates, so the two features cannot silently starve one another's independent caps.

The Web view's three new controls add no new model-visible schema or Session event: guidance focus, the Kanban toggle, and the Markdown export are pure client-side presentation over data the projection already carries, verified by the existing `agent-team`, `tool-agent-team`, and `ui-subagent` test suites (133 tests) without a new snapshot fixture.
