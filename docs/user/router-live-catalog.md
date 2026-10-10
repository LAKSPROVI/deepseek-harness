---
description: "Keep a custom Anthropic gateway's selectable models aligned with its authenticated availability catalog."
kind: "tutorial"
---

# Automatically refresh a router catalog

English | [中文](router-live-catalog.zh.md)

This guide connects an existing `9router` provider to a gateway that publishes strict `x_9r` availability evidence. It requires a running local Web Harness, its launch log, and a credential referenced through an environment variable. The provider keeps `api: anthropic-messages` and its configured base URL.

## Start synchronization

1. Set `ROUTER_API_KEY` in the synchronizer's environment. Keep its value outside command arguments and configuration examples.
2. Run the script with your installation paths and the provider's exact base URL:

```sh
node scripts/sync-router-live-models.mjs --home /path/to/home --app-url http://127.0.0.1:3080/ --catalog-url https://gateway.example/v1 --launch-log /path/to/launch.log --watch --interval-ms 30000
```

3. Inspect `home/sync-9router-models-state.json`. A confirmed cycle has `ok: true`, a current `synchronizedAt`, `validUntil`, and `publishedChatModels`. Compare the complete model IDs in Harness Settings with the authenticated catalog's eligible projection.
4. Start this command with your operating system's login scheduler. Keep one watcher running. The same command without `--watch` requests an immediate cycle when that watcher is active.

## Understand availability

The script requires fresh text, tool-call, Anthropic tool-call, and Anthropic streaming proofs. It excludes automatic routing aliases, expired evidence, malformed listings, duplicate IDs, and unproved image input. A valid empty result or a failed catalog request withdraws the provider's selectable models; a later successful cycle restores them. Refresh normally occurs every 30 seconds; the gateway evidence itself has a maximum ten-minute lifetime. Availability can change between verification and a request.

Start the Web Harness with `DSH_HOME` set to the same home. The script enrolls that home in native availability enforcement: the runtime withdraws expired choices and refuses new dispatches even if synchronization stops. The local confirmation lasts at most 60 seconds, with a 30-second notification fallback if native file watching fails. Changes go through revision-checked Settings operations and update the native model directory. The script changes only `providers.9router.models`, makes a verified profile backup first, and retains model options by exact ID across withdrawal and return. Other providers, credentials, histories, and an existing session's selected model remain intact. A selected model that disappears becomes unavailable; the script does not silently switch that session to another model.

The selectable directory also checks the deployment's tool presentation. Router `gh/gpt*` routes accept at most 128 native tool schemas; a larger tool set excludes them from the default selector without removing any configured MCP or native tool. The status badge counts models usable in that default context. A session that explicitly selects PTC can use a scoped catalog with one `run_code` schema. Every actual dispatch checks its complete projected tool set, so manual choices and prepared calls cannot bypass the limit. A tool-count rejection identifies the model, the 128-schema limit, and the request count.

## Recover synchronization

The status file reports sanitized error codes. `app_unavailable` means the local Harness cannot accept an update; it is retried by the watcher. A protocol or endpoint mismatch stops writes to that provider. Restore a profile only from its verified backup under `home/backups/router-live-catalog`, using the same Settings workflow. A backend restart requires a new launch token; the synchronizer exchanges it for a local session cookie automatically.

Local authentication and Settings requests have a 30-second deadline; the external catalog keeps its eight-second deadline. Use `--app-timeout-ms` to choose a positive integer of at most 30000 milliseconds. A slower app can still fail confirmation; this setting does not extend model proof expiry or the 60-second local lease.

After discovering the provider entry, the synchronizer requests only that namespace on subsequent reads. It still fetches current revisions and model evidence each cycle. A removed entry triggers full discovery; older runtimes that refuse the optional filter use full reads. Timeouts still withdraw confirmation.

The [adapter reference](../../packages/llm/llm-pi-ai/README.md) describes custom routes, and the [decision record](../../.agents/notes/implemented/bug-fix/2026-10-07-router-live-catalog.md) explains the availability contract.
