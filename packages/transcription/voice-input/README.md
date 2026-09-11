---
description: "Host end of browser voice input: decode one base64 upload, transcribe it through the seam, and answer a transcript or a stable failure."
kind: "package-reference"
---

# @deepseek-ai/dsh-voice-input

English | [中文](README.zh.md)

## Summary

The **`VoiceInputService`** (`ctx.voiceInput`) is the Host end of one browser feature: it accepts one base64 audio upload, decodes it, transcribes it through the [transcription capability seam](../transcription/README.md), and answers a transcript or a stable business failure.

## Table of Contents

- [Overview](#overview)
- [Remote API (`ctx.remote.voiceInput`)](#remote-api-ctx-remote-voiceinput)
- [The upload](#the-upload)
- [Failures](#failures)
- [Policy ownership](#policy-ownership)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="overview"></a>
## Overview

This package owns the Consumer role of that capability:

| Package | Role |
|---|---|
| [`@deepseek-ai/dsh-transcription`](../transcription/README.md) | Service Definition: the service, the provider registry, selection policy, the payload ceiling, request/result vocabulary, the `TranscriptionError` taxonomy |
| [`@deepseek-ai/dsh-transcription-groq`](../transcription-groq/README.md) | Provider: Groq's OpenAI-compatible Whisper transcriptions API |
| `@deepseek-ai/dsh-voice-input` (this) | Consumer: the `voiceInput` Remote namespace, base64 decoding, and the browser-facing failure codes |

Audio is transient: the decoded bytes live for the duration of one call, reach no session event and no storage, and are not retained after the answer.

<a id="remote-api-ctx-remote-voiceinput"></a>
## Remote API (`ctx.remote.voiceInput`)

| Member | Semantics |
|---|---|
| `transcribe(request, signal?)` | Decode one upload and transcribe it through `ctx.transcription`. Returns `{ ok: true, value }` with the transcript, or `{ ok: false, error }` carrying one failure code. Rejects when the failure is not a `TranscriptionError`. |

`TypertRemoteService` publishes the method under the namespace `voiceInput`, so a browser caller reaches it as `ctx.remote.voiceInput.transcribe(request)`. The trailing optional `AbortSignal` is the method's cancellation parameter: the Typert gateway supplies the carrier's signal for a cancellation-aware method and forwards it to `ctx.transcription.transcribe`, so a caller that drops the request stops the provider call.

An expected failure is a value in the returned union; an infrastructure error is rethrown unchanged, so a bug in a provider surfaces as a rejection rather than as a business code the browser would render as a user-facing message.

<a id="the-upload"></a>
## The upload

| Field | Meaning |
|---|---|
| `mediaType` | Container format the recorder declared, from the seam's closed `TranscriptionAudioFormat` union: `audio/webm`, `audio/ogg`, `audio/wav`, `audio/mp4`, `audio/mpeg`. Forwarded to the seam unchanged. |
| `data` | Canonical base64 encoding of the audio bytes: full quartets with at most two trailing padding characters. |
| `language` | Optional hint, e.g. `pt`. Absent or empty is sent as no hint at all, leaving detection to the provider. |

`data` is tested against the canonical base64 pattern before decoding because `Buffer.from(data, 'base64')` silently skips every character outside the alphabet: a corrupted upload would otherwise decode to plausible-looking audio that the provider rejects with an opaque message. A payload that fails the pattern never reaches the seam.

The success value carries `text` and, when the provider reported one, `language`. Both come from the seam's `TranscriptionResult` unchanged; `text` is an empty string for silence. See [`src/types.ts`](src/types.ts) for the full request, value, and failure declarations.

<a id="failures"></a>
## Failures

| `error.code` | Meaning |
|---|---|
| `audio-undecodable` | `data` is not canonical base64. Decided here, before any provider is dispatched. |
| `audio-empty` | The decoded payload carries no audio byte, reported by the seam as `TRANSCRIPTION_AUDIO_EMPTY`. |
| `audio-too-large` | The decoded payload exceeds the seam's `maxAudioBytes` ceiling. Carries `actualBytes`, the decoded length this package measured. |
| `provider-unavailable` | The seam resolved no usable provider: unavailable, configured-missing, configured-unavailable, or ambiguous selection. `detail` names which step failed. |
| `provider-unconfigured` | A provider is registered but holds no credential, reported by the seam as `TRANSCRIPTION_CREDENTIAL_MISSING`. `detail` names the missing credential reference. |
| `provider-failed` | The provider was reached and refused or failed the transcription. `detail` forwards the provider's own message. Every `TranscriptionError` code this package does not recognize maps here, because the seam's codes are merge-extensible. |
| `aborted` | The transcription was cancelled before a transcript existed, reported by the seam as `TRANSCRIPTION_ABORTED`. |

<a id="policy-ownership"></a>
## Policy ownership

This package holds no transcription policy: the payload ceiling, provider selection, and transcript trimming belong to `ctx.transcription`, so a headless deployment calling the seam directly enforces identical rules. `audio-too-large` is the seam's ceiling failure projected onto the wire, with the measured byte length added so a caller can report the size it actually sent.

What this package does own: the base64 encoding check, the empty-hint normalization, the mapping from `TranscriptionError` codes to browser-facing codes, and the boundary between an expected failure and a rethrown one.

<a id="model-experience"></a>
## Model Experience

None, as the service answers its caller and registers no prompt, tool schema, or session event; only the transcript a human sends from the composer becomes model-visible, through the ordinary user-message path that already logs it.

#### KV Cache effect

Independent of every model request: no audio byte and no transcript token enters a request from this package, so it neither builds nor invalidates a reusable prefix.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Audio travels base64-expanded** — the Remote wire is JSON, so one upload costs about 4/3 of the recorded byte length and is fully buffered in the request. There is no binary or multipart path, and no chunked upload.
- **No streaming or partial transcript** — one complete utterance per call, matching the seam's single operation. A long recording produces no feedback until it finishes, and there is no progress or partial-text signal to render.
- **The ceiling is enforced on decoded bytes** — a request whose base64 text is far larger than `maxAudioBytes` is decoded before the seam rejects it, so an oversized upload is transported and decoded in full before it fails.
- **`detail` carries operator-facing text to the browser** — `provider-unavailable`, `provider-unconfigured`, and `provider-failed` forward the seam's or the provider's own message, including a credential reference name. A deployment exposes the Remote gateway only through its trusted or separately authenticated boundary.
- **A call leaves no durable record** — this package appends no session event, so a failed, cancelled, or discarded transcription is not reconstructable from session data, and a consumer that makes a transcript model-visible owns logging it.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
