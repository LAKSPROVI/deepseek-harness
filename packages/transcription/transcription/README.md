---
description: "Define the transcription capability seam: provider registry, selection policy, payload ceiling, and the shared error taxonomy."
kind: "package-reference"
---

# @deepseek-ai/dsh-transcription

English | [中文](README.zh.md)

## Summary

The **`TranscriptionRuntime`** (`ctx.transcription`) defines WHAT speech-to-text the harness has — turn one complete recorded utterance into text — over multiple providers, without binding callers to one vendor's API shape.

## Table of Contents

- [Overview](#overview)
- [Service API (`ctx.transcription`)](#service-api-ctx-transcription)
- [Config](#config)
- [Selection](#selection)
- [Vocabulary](#vocabulary)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="overview"></a>
## Overview

This package owns the Service Definition role of the transcription capability. It carries one operation on one seam, with potentially multiple providers:

| Package | Role |
|---|---|
| `@deepseek-ai/dsh-transcription` (this) | Service Definition: the service, the provider registry, selection policy, the payload ceiling, request/result vocabulary, the `TranscriptionError` taxonomy |
| [`@deepseek-ai/dsh-transcription-groq`](../transcription-groq/README.md) | Provider: Groq's OpenAI-compatible Whisper transcriptions API |

Audio is transient here: the seam hands the encoded bytes to the selected provider and returns text. It appends no session event, so a payload never becomes durable session data.

<a id="service-api-ctx-transcription"></a>
## Service API (`ctx.transcription`)

| Member | Semantics |
|---|---|
| `registerProvider(provider)` | Register a speech-to-text backend. Throws `TranscriptionError` `TRANSCRIPTION_DUPLICATE_PROVIDER` on a duplicate id. Returns a disposer. Disposed with the calling fiber. |
| `transcribe(request, signal?)` | Enforce the payload ceiling, resolve the provider, and transcribe one utterance through it. Returns the transcript with surrounding whitespace trimmed. Throws `TranscriptionError` when the capability cannot run. |

`transcribe()` rejects an empty payload as `TRANSCRIPTION_AUDIO_EMPTY` and a payload above `maxAudioBytes` as `TRANSCRIPTION_AUDIO_TOO_LARGE`, both before any provider is dispatched: only this caller-facing entry point knows the complete payload. A provider's own failure propagates unchanged, so provider-specific codes reach the caller as thrown.

Providers register a **capability**, not a tool. This package registers no model-facing name, description, prompt text, or JSON schema.

<a id="config"></a>
## Config

| Key | Default | Meaning |
|---|---|---|
| `provider` | omitted | Explicit provider id that wins selection. Omitted, a single registered usable provider auto-selects. |
| `maxAudioBytes` | `26214400` (25 MiB) | Positive-integer ceiling on one request's audio bytes, enforced before dispatch. The `DEFAULT_MAX_AUDIO_BYTES` constant is the smallest documented per-request upload limit among the speech APIs this seam targets; a deployment fronting a different backend sets this key rather than relying on it. |

<a id="selection"></a>
## Selection

Selection never depends on registration, config, or HMR order. The capability has an explicit provider id (config `provider`), or auto-selects when exactly one usable provider is registered. `transcribe()` resolves the provider at execution time, after the payload checks:

| Situation | Execution |
|---|---|
| configured id registered and `available()` | runs that provider |
| configured id not registered | `TRANSCRIPTION_PROVIDER_CONFIGURED_MISSING` |
| configured id registered but unavailable | `TRANSCRIPTION_PROVIDER_CONFIGURED_UNAVAILABLE` |
| no id, exactly one registered usable provider | runs it |
| no id, no usable provider | `TRANSCRIPTION_PROVIDER_UNAVAILABLE` |
| no id, multiple usable providers | `TRANSCRIPTION_PROVIDER_AMBIGUOUS` |

The failure branches throw `TranscriptionError`, whose structured code (plus message detail — the missing id, the ambiguous candidate set) is what callers route on. A provider's `available()` is a cheap local check (credential presence, parseable config) that feeds this execution-time resolution and **must not make network calls**.

<a id="vocabulary"></a>
## Vocabulary

`TranscriptionRequest` (`audio`, `format`, `language?`) → `TranscriptionResult` (`text`, `language?`); cancellation is a direct optional `AbortSignal` argument to `transcribe()`. `audio` is the complete encoded payload rather than a stream, because bounding it requires knowing its full size, and `language` is a BCP-47 or ISO-639-1 hint whose absence asks the provider to detect. `text` is an empty string when the audio carried no speech, and the result's `language` is present only when the provider reports what it detected or honored — the seam never echoes the request hint back, so a caller can distinguish detection from assumption. `TranscriptionAudioFormat` is a CLOSED union (`audio/webm` | `audio/ogg` | `audio/wav` | `audio/mp4` | `audio/mpeg`) owned here: providers `switch` to exhaustiveness, so adding a format breaks their compilation until each declares real support. See `src/types.ts` for the full contracts and the `TranscriptionError` code taxonomy.

<a id="model-experience"></a>
## Model Experience

None, as the seam returns the transcript to its caller and registers no prompt, tool schema, or session event of its own.

#### KV Cache effect

Independent of every model request: no audio byte and no transcript token enters a request from this package, so it neither builds nor invalidates a reusable prefix.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **No streaming or partial transcript** — the seam transcribes one complete utterance per call, and `TranscriptionRequest.audio` is the whole encoded payload because the pre-dispatch ceiling needs its full size. Live captioning would need a second operation with its own result and cancellation semantics.
- **No provider-availability query** — availability is observed only by calling `transcribe()` and routing the thrown `TranscriptionError` codes; the no-provider failure is the generic `TRANSCRIPTION_PROVIDER_UNAVAILABLE` with no per-provider reason enumeration, and there is no provider-change event.
- **A transcription leaves no durable record** — audio and transcripts stay out of the session log, so a call cannot be reconstructed from durable session data; a consumer that makes a transcript model-visible owns logging it.
- **`TranscriptionResult` carries only `text` and `language`** — no segments, word timestamps, confidence, or speaker labels, so a provider that returns them has nowhere to put them.
- **`TranscriptionRequest` carries only one language hint** — provider-neutral controls (vocabulary or prompt bias, timestamp granularity, diarization) are deferred until more than one provider can honor them honestly.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
