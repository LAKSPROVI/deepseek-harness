# Runbook: model capability changes for agents

English | [中文](model-capability-agent-runbook.zh.md)

Use this reference when an agent adds, changes, diagnoses, or deploys model capability metadata. It maps each decision to its owning package and defines the evidence needed before the Harness may claim a modality or reasoning level. For adapter construction, follow the [LLM adapter guide](adding-an-llm-adapter.md); this runbook covers the cross-package path after an adapter can resolve exact-model metadata.

## Ownership map

| Question | Owner | Authoritative evidence |
|---|---|---|
| What capability fields and tri-state meanings exist? | [`@deepseek-ai/dsh-llm`](../../packages/llm/llm/README.md) | Provider-neutral types plus `resolveModelInfo()`, `resolveCallConfig()`, and `prepareCall()` |
| Which exact route supports a level or input modality? | The registered adapter, such as [`dsh-llm-pi-ai`](../../packages/llm/llm-pi-ai/README.md) | Exact-model resolver and request serialization for the same adapter generation |
| Which discovered gateway claims are trusted? | The adapter's discovery implementation | Validated discovery output; for 9Router media, only a `proved` probe promotes a modality |
| Which model selection is live and durable? | [`dsh-host-apiproxy`](../../packages/host/apiproxy/README.md) | Process selection, then latest logged `request/header`, then the shared Agent default |
| What does the browser display or block? | [`dsh-client-ui-model-selection`](../../packages/client/ui-model-selection/README.md) | Host-returned `current`, `currentModel`, `routable`, and known modality metadata |
| Why must native media cross several layers? | [Advanced media capability decision](../../.agents/notes/implemented/architecture/2026-08-30-advanced-model-media-capability-boundaries.md) | Durable storage, canonical model content, adapter wire support, and product rendering/replay |
| How is an obsolete restored effort repaired? | [Restored effort recovery decision](../../.agents/notes/implemented/bug-fix/2026-08-31-restored-reasoning-effort-recovery.md) | Exact-model resolution before model-directory response and prompt admission |

Catalog membership is advisory. It neither authorizes a route nor proves a capability. Provider/model/effort ids, not presentation labels, are the persisted identity.

## 1. State the capability without inference

Classify every claim before changing code:

- **Reasoning:** list only adapter-supported effort ids. A configured `defaultEffort` applies only when the caller omitted an effort. An explicit unsupported id fails before provider I/O; the LLM runtime never clamps it.
- **Input modality:** preserve three states. An absent `inputModalities` field means unknown; an explicit list without a modality means known unsupported; a list containing it means known supported. Do not turn unknown into text-only.
- **Native media:** storage, a canonical content block, UI rendering, an SDK feature, or a successful HTTP response does not independently prove provider interpretation. Advertise only the intersection completed for the exact route and direction.
- **Agent features:** tools, native search, and other agent integrations are not model modalities. Keep them on their owning service or Agent surface.

When capability information comes from discovery, define what constitutes proof. A provider claim, model name, HTTP 200, accepted-but-unproved probe, malformed result, or agent-feature field remains unknown unless the adapter's documented proof rule says otherwise.

## 2. Implement the adapter-owned fact

Keep provider wire vocabulary inside the adapter:

1. Return exact provider/model identity from `resolveModel()` with optional context, output default, reasoning, and input modalities.
2. Publish ordered opaque effort ids and map each id to its provider wire value during request serialization. An id such as `off` may map to a different wire spelling.
3. Set `defaultEffort` only when the route has an authoritative default. User selection and route configuration take precedence over an installed fallback.
4. Reject unsupported explicit values before network I/O. Never silently drop a requested modality or effort.
5. Tie resolution and dispatch to the same prepared adapter generation so HMR or settings changes cannot combine metadata from one route with another route's transport.

Discovery candidates remain configuration-time data. Adoption surfaces may present them, but only registered exact-model resolution becomes live request metadata.

## 3. Preserve session truth at the Host

The Host is the final admission authority for every caller. It must not rely on the browser having performed the same check.

A restored selection can outlive the metadata that originally accepted it. Before returning `session.models` and before admitting `session.prompt`, resolve the exact model. If its selected effort is no longer advertised, replace only that effort with the current `defaultEffort`, or omit it when the model has no default. Keep provider and model unchanged. If exact-model resolution fails, keep the full selection so the unavailable-route path reports the identity the user must repair.

Do not rewrite an earlier `request/header`: it records the request that actually ran. The normalized selection becomes durable when a later admitted request appends its ordinary header. If another selection wins while asynchronous recovery is pending, the newer complete selection remains authoritative.

## 4. Project known facts in the browser

The browser consumes Host facts; it does not derive capability from a catalog row or model name.

- Show effort controls only from `currentModel.reasoning.efforts`.
- Preserve the exact effort id on the wire while allowing a presentation label to differ.
- Block image submission only when an image is pending and `inputModalities` is a known list that omits `image`.
- Keep unknown modality metadata permissive. The Host still performs final admission.
- Run the known-negative preflight before encoding, upload, or RPC, and preserve the draft and attachments after refusal.
- Keep model selection and attachment removal available while blocked so the user can recover.

Selecting the already selected model may be a no-op and is not a recovery mechanism for obsolete state. Recovery belongs at Host admission.

## 5. Diagnose a live mismatch

Collect facts in this order before editing or restarting:

1. **Session:** current provider/model, persisted effort, and whether it came from the latest `request/header`.
2. **Exact metadata:** `currentModel`, advertised efforts/default, input modalities, `routable`, and provider-local catalog failures.
3. **Adapter:** registered provider owner, exact resolver result, discovery proof state, and request mapping.
4. **Artifacts:** Git SHA, clean/dirty state, built Host adapter/API hashes, Web asset revision, process command, worktree, profile, and `DSH_HOME`.
5. **Transport:** confirm whether refusal occurred before provider I/O. `UNSUPPORTED_REASONING_EFFORT` is local validation; provider HTTP/SSE evidence proves the request crossed that point.

A Web shell can be current while the Host bundle is stale. Matching static assets or HTTP 200 does not prove runtime coherence. Build and launch Host and Client from one SHA, then verify behavior through the live API or DOM rather than through filenames alone.

## 6. Verify the complete path

Use the narrowest tests that fail for each changed responsibility, then validate the assembled application:

| Changed responsibility | Minimum evidence |
|---|---|
| Capability validation/defaulting | LLM runtime or adapter unit tests for accepted, omitted, zero/off, and unsupported values |
| Discovery promotion | Fixtures for proved, unproved, failed, malformed, and absent evidence |
| Restored selection recovery | Host API tests for directory response, prompt admission, no historical rewrite, and concurrent newer selection |
| Browser selector/admission | Component tests for exact effort rows, known-negative blocking, draft/attachment preservation, and recovery |
| Published runtime | Complete affected build plus a live smoke against the existing deployment URL |
| Provider identity | One real response that records requested, routed, served, and provider identities from the current round |

For a GUI smoke, select the target route explicitly unless the test owns the deployment default. Assert ids and accessible labels separately. A persisted explicit effort may legitimately override the adapter default; test the default in a blank selection and precedence in a restored one.

## 7. Deploy without mixing artifact generations

1. Confirm the target branch, SHA, worktree, profile, home, URL, and listener PID.
2. Build the complete affected Host and Client surfaces from that SHA.
3. Record hashes for the Host capability owner and adapter, not only the Web shell.
4. Stop only the verified listener and restart with the same profile, `DSH_HOME`, URL, and port.
5. Require HTTP readiness, injected boot data, expected SHA, clean source tree, and live capability behavior.
6. Re-run the restored-selection, effort-menu, known-negative modality, and recovery smokes.
7. Preserve rollback artifacts and never infer success from a process start alone.

A deployment is complete only when source, built artifacts, live Host metadata, browser projection, and provider evidence describe the same capability state.
