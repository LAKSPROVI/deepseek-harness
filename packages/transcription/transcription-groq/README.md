---
description: "Groq Whisper provider for the transcription seam, with per-call credential resolution."
kind: "package-reference"
---

# @deepseek-ai/dsh-transcription-groq

English | [中文](README.zh.md)

## Summary

A [Groq](https://groq.com)-backed `TranscriptionProvider` for the harness [transcription capability seam](../transcription/README.md) (`ctx.transcription`). It calls Groq's **OpenAI-compatible transcriptions API** (`POST {baseURL}/audio/transcriptions`, `multipart/form-data`) with a Whisper model, and maps the `verbose_json` body Groq returns into the seam's normalized `TranscriptionResult`.

## Table of Contents

- [Overview](#overview)
- [Config](#config)
- [The request](#the-request)
- [Mapping](#mapping)
- [Credentials and settings per call](#credentials-and-settings-per-call)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="overview"></a>
## Overview

This is an **implementation** package: it registers a provider into `ctx.transcription`, resolves its credential for each transcription through the optional `ctx.credentials` seam, and does not register a model-facing tool. It is a function/namespace plugin (`inject: ['transcription']`). The multipart wire format and the native `fetch` client are provider-private details — they do **not** make this provider depend on `ctx.llm`.

A mounted credentials service is authoritative; without one, the launching process environment is the whole credential plane. The reference is resolved for each transcription, so a key stored or rotated after boot reaches the next call without a restart.

<a id="config"></a>
## Config

| Key | Default | Meaning |
|---|---|---|
| `apiKey` | omitted | Literal Groq API key. Prefer `apiKeyEnv` so no secret enters configuration; a non-empty literal wins over the resolver. |
| `apiKeyEnv` | `GROQ_API_KEY` | Credential reference resolved for each transcription through `ctx.credentials`, or from the launch environment when that seam is absent. A missing value fails the call as `TRANSCRIPTION_CREDENTIAL_MISSING`, whose message names this reference. |
| `baseURL` | `https://api.groq.com/openai/v1` | OpenAI-compatible endpoint base; `/audio/transcriptions` is appended. Falls back to `$GROQ_BASE_URL` from the launch environment. Groq serves its OpenAI-compatible surface under `/openai/v1`, not `/v1`, so a bare host yields 404 for every request. An unparseable value makes the provider unavailable. |
| `model` | `whisper-large-v3-turbo` | Groq transcription model name. `whisper-large-v3-turbo` is the cost/latency choice; the non-turbo `whisper-large-v3` trades throughput for marginal accuracy. An empty value makes the provider unavailable. |
| `defaultLanguage` | omitted | Language hint sent when a request carries none, e.g. `pt`. A request's own `language` wins. Omitted leaves detection to Groq, which costs accuracy on short utterances. |

```yaml
- id: transcription-groq
  name: '@deepseek-ai/dsh-transcription-groq'
  config:
    apiKeyEnv: GROQ_API_KEY
    model: whisper-large-v3
```

The entry above is the base layer of the `transcription-groq` Settings section: a user layer over it reaches the NEXT transcription, because the provider projects the section per call rather than capturing it at registration. The seam's provider selection therefore never flickers when an endpoint or model changes. `apiKey` carries `role('secret')`, so it never rides a `describe()` response in any layer.

<a id="the-request"></a>
## The request

Each transcription posts one multipart body: the `file` part carries the request's audio as `utterance.<ext>` typed with the request's format (`webm`, `ogg`, `wav`, `mp4`, and `mp3` for `audio/mpeg`), alongside `model`, `response_format=verbose_json`, and `language` when a hint exists. Headers carry the bearer key, `accept: application/json`, and the harness user agent. HTTP redirects are rejected before the `Location` target is contacted and surface as `TRANSCRIPTION_PROVIDER_ERROR`.

`available()` is a local check with no network call: a literal key or a credential resolver exists, `baseURL` parses, and `model` is non-empty.

<a id="mapping"></a>
## Mapping

`text` ← `text`, and `language` ← `language` when Groq reports a non-empty one. A response body without a `text` member is unprocessable rather than an empty transcript — silence returns an empty string, so a missing member means the wire format changed — and becomes `TRANSCRIPTION_PROVIDER_ERROR`.

A non-2xx response becomes `TRANSCRIPTION_PROVIDER_ERROR` carrying Groq's own detail from `error.message`, a string `error`, or a top-level `message`; a non-JSON or detail-free error body keeps `Groq API error (HTTP <status>)`. A 429 rate limit uses that same code so callers route uniformly, and the message carries the distinction. Transport failures, a failed credential resolution, and an unprocessable success body take the same code; a missing credential is `TRANSCRIPTION_CREDENTIAL_MISSING`, and caller cancellation — including an abort during credential resolution or response-body parsing — is `TRANSCRIPTION_ABORTED`.

<a id="credentials-and-settings-per-call"></a>
## Credentials and settings per call

One transcription snapshots its options once at entry, so a settings write landing inside the awaited credential resolution cannot send a key resolved from the old section to the endpoint named by the new one. The provider retains no key between calls.

<a id="model-experience"></a>
## Model Experience

None, as the provider returns the transcript through `ctx.transcription` to its caller and registers no prompt, tool schema, or session event.

#### KV Cache effect

Independent of every conversation request: the Groq transcription call is a separate HTTP request that contributes no tokens to a model request, so it neither builds nor invalidates a reusable prefix.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **No local or offline provider exists in the repo** — a deployment without network access to Groq has no transcription backend at all, so `ctx.transcription` resolves to `TRANSCRIPTION_PROVIDER_UNAVAILABLE`, and every utterance leaves the host.
- **Dynamic credential availability resolves inside the operation** — the synchronous `available()` contract can establish that a resolver exists but cannot query an asynchronous credential store. A selected keyless provider therefore fails the transcription with `TRANSCRIPTION_CREDENTIAL_MISSING`. Caller cancellation races this preflight locally, but cannot force an arbitrary credential backend itself to stop work.
- **`verbose_json` detail beyond `text` and `language` is dropped** — segments and timestamps have no home in `TranscriptionResult`, so requesting the verbose body buys only the reported language.
- **Groq's own upload limit is not modeled** — the seam's `maxAudioBytes` is a local ceiling; a payload under it that Groq rejects fails after dispatch as `TRANSCRIPTION_PROVIDER_ERROR` with Groq's message.
- **A transcription attempt leaves no durable record** — this provider appends no session event, so a failed or cancelled Groq call is not reconstructable from session data.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
