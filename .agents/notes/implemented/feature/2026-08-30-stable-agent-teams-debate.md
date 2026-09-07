# Agent Note: Stable Agent Teams routes, debate, and Web controls

Status: implemented

English | [中文](2026-08-30-stable-agent-teams-debate.zh.md)

## Problem

Agent Teams began as private experimental packages while its durable roster, mailbox, task, and lifecycle rules stabilized. Release packages could not depend on that location, so the shipped base composition, generated Remote assembly, and Web client could not expose the service without violating the repository dependency direction.

A homogeneous child route was also insufficient for a Team whose participants use different LLM providers, models, and personas. Route choices that exist only on a live Agent cannot be inspected from the roster or reconstructed reliably after a cold resume.

Structured deliberation needs a durable current phase, round, participant set, and compare-and-set revision. Interrupting an Agent is not equivalent to pausing a debate, and model tools alone cannot supply explicit human controls or a reload-safe browser view.

## Decision

Agent Teams is stable product capability under `packages/subagent/agent-team` and `packages/subagent/tool-agent-team`, published as `@deepseek-ai/dsh-agent-team` and `@deepseek-ai/dsh-tool-agent-team`. The promotion updates imports, configuration rows, generated artifacts, and repository metadata atomically and provides no compatibility shim for the experimental names.

The Host service is mounted by the base composition, so durable Team state and browser projection are available without adding model-visible tools. The `agent-teams` Agent Preset, displayed as **Equipe de agentes**, alone mounts the Team tool package and its collaboration policy; ordinary presets retain the existing subagent tools and prompt cost.

A Team remains one Lead plus at most nine teammates. The Lead is the root Session, every teammate is one continuable direct child, and immutable roster names continue to reserve failed provisioning attempts rather than recycling identity.

## Per-member routes

Each durable teammate snapshot records its continuable provider separately from optional `llmProvider`, `model`, and `persona` selections. Teammate creation forwards the resolved LLM route through `agentOptions` and the persona through the continuable-child composition. The subagent descriptor preserves those values, and cold resume reconstructs the child from that descriptor rather than inheriting whatever route the Lead currently uses.

Omitted route fields retain explicit inheritance semantics: the child inherits the Lead route or mounted persona at creation, while an explicitly selected provider, model, or persona remains attached to that child across later Activations. Roster and projection views expose the durable selection without treating the continuable provider as an LLM provider.

## Structured debate

The Lead Session stores one current structured debate as whole `team/debate` snapshots. A debate carries a stable id, monotonic revision, topic, participant names, round, maximum rounds, status, current phase, initial multimodal evidence blocks, speech contribution records, and compact transition history. The ordered phases are `positions`, `critique`, `rebuttal`, `verification`, and `synthesis`. Debate contributions contain text, image, and file content blocks. Every participant assigned to the current phase must submit their contribution during the current round before `advance` or `complete` can be committed. Advancing from final synthesis either begins the next round or completes the debate at its round cap.

Create, speech contribution, and transition operations are Lead-authorized or participant-authorized accordingly. Every mutation supplies the expected revision and fails on stale state. `team_debate_contribute` enables both model teammates and human Leads to submit multimodal contributions. `pause` and `resume` change durable debate status without cancelling an Agent turn or modifying its inbox; `interrupt` remains the separate subagent operation for current-turn cancellation. Human controls invoke the same durable operations through the generated Remote, while 14 model tools remain scoped by the `agent-teams` preset.

## Projection and Web controls

The `agentTeam` Session projection is a browser-safe whole value containing members, tasks, and the current debate (including structured evidence and speech contributions). It deliberately excludes queued mailbox content because pending peer mail is delivery state, may contain content not yet admitted to a target Session, and is unnecessary for Team controls.

The Web conversation Team tab reads the initial projection from the history tail and later values from generic `session/projection` frames. Teammate creation loads the Lead Session's existing `session.models` directory, presents linked provider/model selectors, provides natural name normalization (deriving technical lower-kebab-case IDs in real time), and connects to a persistent template library backed by Host `settings` (`agent-team-templates`) for saving and reusing teammate configurations. Teammate prompts, operator guidance, debate evidence, and human debate contributions support multimodal draft attachments (images and generic files) that are serialized into base64 payload blocks on submission. The legacy Host API proxy authorizes file attachment downloads referenced by `team/debate` events without exposing non-message events.

The preset, tab, controls, phase and status labels, debate transcript, readiness indicators, help, accessibility text, and local failures use Brazilian Portuguese; protocol values, identifiers, user-authored content, and provider diagnostics remain unchanged. Mutations use the generated `agentTeams` Remote and current projected revisions; the Client plugin injects both the parent `remote` Service that its deferred Slot actions access and the `remote.agentTeams` namespace that gates activation. The legacy Host API proxy remains domain-agnostic, and no Team-specific HTTP, SSE, or WebSocket contract is added.

The generated Typert Remote is a built Host artifact consumed by the Client bundle. Assembled validation therefore generates and builds Host modules before building the Client and Web shell, then exercises the existing `dsh web` process rather than a replacement Vite server. Source-only tests do not establish that the running GUI and its generated Remote agree.

## Alternatives considered

**Keep Agent Teams under `packages/experimental/` and add a Host adapter.** Rejected because a release BFF or Web package still could not depend on the experimental domain, while duplicating its types in an adapter would create two authorities for the same durable state.

**Mount Team tools in every base session.** Rejected because the service and projection have no model-token cost, but tool schemas and policy do. An opt-in preset preserves ordinary request prefixes and prevents Team controls from shadowing unrelated subagent tools.

**Persist heterogeneous routes only in the subagent descriptor.** Rejected because roster and browser consumers need a durable inspectable selection, and provisioning recovery must compare the Team reservation with the child that materialized.

**Represent debate progress in mailbox messages or in-memory UI state.** Rejected because neither source provides one authoritative CAS revision across restart, HMR, model tools, and human controls.

**Expose mailbox content in the Team projection.** Rejected because delivery recovery, de-duplication, and target admission own that data; browser controls need roster, task, and debate state only.

**Add Team methods to the legacy API proxy.** Rejected because Session projections already provide the read path and Typert Remote provides generated typed mutations without teaching the carrier one more business domain.

## Testing

Package tests cover the ten-participant ceiling, immutable route fields, explicit and inherited LLM selections, persona forwarding, descriptor-backed cold resume, provisioning reconciliation, debate phase order, transition authorization, stale revisions, pause-versus-interrupt behavior, projection replay, fork isolation, and exclusion of mailbox events from the projection. JSONL and SQLite restart tests pin durable recovery.

Tool tests pin opt-in schemas and model-visible results. Real Loader composition tests prove the base service is present without Team tools and the `agent-teams` preset contributes them. Typert built-artifact and Client mount tests cover the generated Remote, Host API projection tests cover the generic carrier, and Web tests cover initial history projection, live updates, human controls, and reload during an active or paused debate.

## Consequences

Agent Teams becomes a supported release dependency and can participate directly in base, Remote, and Web composition. The service is present in ordinary sessions, but it adds no model-visible schema or policy until the Team preset is selected.

The Lead Session grows with whole member, task, and debate snapshots. This preserves independently inspectable recovery and simple last-wins projection at the cost of repeated debate history in later snapshots; configured participant, task, mailbox, and round limits bound active state rather than historical log growth.

A participant's provider, model, and persona are durable Team facts, so changing the Lead route does not retarget existing teammates. Debate pause is durable coordination state, not process suspension: running participants continue until separately interrupted, and inactive participants are not awakened merely by a phase transition.
