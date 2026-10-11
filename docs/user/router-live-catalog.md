---
description: "Keep a custom gateway's selectable models aligned with its authenticated availability catalog."
kind: "tutorial"
---

# Automatically refresh a router catalog

English | [中文](router-live-catalog.zh.md)

This guide connects an existing `9router` provider to a gateway that publishes strict `x_9r` availability evidence. It requires a running local Web Harness, its launch log, and a credential referenced through an environment variable. The provider keeps its configured base URL and either `api: anthropic-messages` or `api: openai-completions`. The synchronizer follows that protocol; it does not change it.

## Start synchronization

1. Set `ROUTER_API_KEY` in the synchronizer's environment. Keep its value outside command arguments and configuration examples.
2. Run the script with your installation paths and the provider's exact base URL:

```sh
node scripts/sync-router-live-models.mjs --home /path/to/home --app-url http://127.0.0.1:3080/ --catalog-url https://gateway.example/v1 --launch-log /path/to/launch.log --watch --interval-ms 30000
```

3. Inspect `home/sync-9router-models-state.json`. A confirmed cycle has `ok: true`, a current `synchronizedAt` and `publishedChatModels`; schema-2 eligibility follows each model's own evidence expiry. Compare the complete model IDs in the native model selector with the authenticated catalog's eligible projection.
4. Start this command with your operating system's login scheduler. Keep one watcher running. The same command without `--watch` requests an immediate cycle when that watcher is active.

## Use the selector

Open your local Web Harness, select the configured `9router` provider, and choose an exact model ID. Refresh the selector after synchronization. A missing model may have expired evidence, a negative upstream result, or an incompatible tool presentation; compare IDs and the sanitized status before changing configuration.

## Understand availability

The script requires fresh text, tools, and streaming evidence for the configured protocol. It excludes aliases, duplicates, malformed evidence, expired routes, and unproved image input. A schema-2 runtime snapshot stores each model's original `checked_at` and `expires_at`, bounded to ten minutes. Confirmed removal or negative evidence withdraws the model; older evidence cannot restore it. Availability can change between verification and a request.

Start the Web Harness with `DSH_HOME` set to the same home. The synchronizer publishes runtime snapshots without changing persistent Settings or reloading their components. The pi-ai adapter merges the snapshot into the native model directory and preserves exact-ID options and configured capacity limits. Other providers, credentials, histories, defaults, and session selections remain intact. Each model expires independently; file notifications and a 30-second fallback refresh the directory. Legacy snapshots retain their original 60-second confirmation limit.

The selectable directory also checks the deployment's tool presentation. Router `gh/gpt*` routes accept at most 128 native tool schemas; a larger tool set excludes them from the default selector without removing any configured MCP or native tool. The status badge counts models usable in that default context. A session that explicitly selects PTC can use a scoped catalog with one `run_code` schema. Every actual dispatch checks its complete projected tool set, so manual choices and prepared calls cannot bypass the limit. A tool-count rejection identifies the model, the 128-schema limit, and the request count.

## Recover synchronization

The status file reports sanitized failures, protocol, attempts, and `transport`. Treat it as private runtime data: it includes a credential fingerprint used to bind the snapshot to the actual dispatch credential. A changed URL, protocol, credential reference, or credential value requires matching evidence. A backend restart obtains a new local authentication cookie from its launch log.

Local authentication and Settings reads have a 30-second deadline; each external catalog request has eight seconds and one retry for transient failures. After two transient failures, `transport: degraded` retains only still-valid individual proofs without changing their expiry. Invalid responses and authentication failures withdraw choices. The watcher retries every 30 seconds measured from cycle start; `--app-timeout-ms` accepts a positive integer up to 30000 and never extends evidence.

Before dispatch, an expired known model can request one renewal and wait at most 20 seconds, with cancellation. Without fresh evidence, the call fails with `ROUTER_MODEL_UNAVAILABLE`. A completed tool result remains in session history and can be used on a later follow-up after recovery; renewal does not execute the tool again or silently select another model. Already transmitted streams keep their dispatch.

The [adapter reference](../../packages/llm/llm-pi-ai/README.md) describes custom routes, and the [decision record](../../.agents/notes/implemented/architecture/2026-10-11-router-runtime-evidence.md) explains the availability contract.
