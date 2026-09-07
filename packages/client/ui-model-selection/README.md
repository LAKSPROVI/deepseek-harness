# @deepseek-ai/dsh-client-ui-model-selection

English | [中文](README.zh.md)

Model selection plugin, browser half: TWO entries over ONE per-session directory owned by `ModelDirectoryResolver` (`ctx.modelDirectories`). For ordinary sessions, the `/model` popupSelect contribution (registered through `ctx.commandUi`) and the composer's named `conversation.input.model` seat both load the session's advisory directory through `session.models` and submit through `session.selectModel` via the same `ModelDirectory` instance. The compact composer trigger opens a two-level Model/Effort menu: the model pane features an integrated instant search input and highlights frequently used models at the top, while keeping models provider-grouped; the selected exact model supplies its adapter-owned effort names, descriptions, and default. `/model` applies the selected model's default effort, and the composer can then choose any advertised effort. Model usage frequency is safely tracked in browser storage so top-used models stay easily accessible across sessions.

The Host-reported provider/model/reasoning `ModelSelection` is the single selection fact. `session.models.currentModel` carries exact metadata for that route independently of advisory group membership, while the trigger still echoes a model only when the exact provider/model pair remains advertised: an absent row leaves the routable selection and capability metadata intact, prompts `Select model`, synthesizes no stale row, and shows no Effort row until the user picks an advertised model. Successful selection replaces both `current` and the echoed `currentModel` immediately. Directory loads and selections share a generation counter so an older response never overwrites a newer one; a connection reset drops every resident projection and repulls the Host-restored selection before display. Provider-local metadata failures list inline while usable groups stay selectable, and selection failures retain the prior selection and directory.

This plugin raises composer blocks through `ctx.conversation.blocks` for two definite conditions: `session.models.routable === false`, or a draft containing an image while `currentModel.inputModalities` is a known list that omits `image`. Unknown route or modality metadata never blocks, and catalog membership never decides capability. The resolver subscribes to both the directory and input stores, so removing the last image or selecting an image-capable model clears the image block immediately; the model seat and attachment removal stay available while blocked. A synchronous prompt preflight repeats the same known-negative check before attachment encoding, upload, or RPC, preserving the draft and attachments if submission is attempted. The Host remains authoritative for every caller.

Directories are per-session, resolved lazily through `ctx.modelDirectories.directoryFor(sessionId)`, and disposed with the session scope. Addressed subagent sessions expose neither entry, and their directory rejects loads, selections, and reconnect refreshes, because ordinary Agent-bound model RPCs would activate persisted child history outside the direct-parent continuation path.

Every resident directory refetches directly on forwarded `llm/adapters-updated` and `settings/document-updated` owner events. Provider topology, provider catalogs, and the default selection therefore converge without the Host or client runtime deriving a separate model-change alias.

The `/client` exports are the plugin body (`apply`/`inject`), `ModelDirectoryResolver`, `ModelDirectory` with its state fields, and the seat's injected face type.

## Model Experience

Indirectly, through the `session.selectModel` RPC available to ordinary sessions, both entries submit the complete `ModelSelection` that the Host snapshots at the next prompt-assembly boundary, so the following request uses the selected provider, model, and effort while a running step keeps its assembled selection; the selection becomes durable only when the existing request header records a request that consumes it, and menu interaction adds no prompt content.

#### KV Cache effect

Switching the route can reduce or invalidate provider-side cache reuse for subsequent requests; the prompt prefix itself is untouched.

## Known Limitations and Deferred Work

- **No create-time or addressed-subagent selection** — both entries require an existing ordinary session's Agent; there is no draft-phase model choice to fold into session creation, and subagent continuation deliberately exposes no independent model-selection contract.
- **Directory names are presentation-only** — selection and persistence use provider/model/effort ids; a provider whose catalog or exact-model metadata lookup fails lists as an unselectable failure row until reload.
- **No arbitrary effort input** — the composer offers only the exact model's adapter-advertised levels; an adapter without reasoning metadata leaves the Effort row absent.
