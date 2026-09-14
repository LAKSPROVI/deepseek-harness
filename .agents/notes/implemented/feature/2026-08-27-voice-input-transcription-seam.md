# Agent Note: Voice input as a transcription capability seam

Status: implemented

English | [中文](2026-08-27-voice-input-transcription-seam.zh.md)

## Problem

The harness accepts typed text only. Dictating a task is faster than typing one, and speech is the input people already use for long, unstructured instructions — exactly the requests that arrive as a wall of typing today.

Speech-to-text also cannot be added the way a UI affordance is added. The transcription credential belongs to the deployment, not to a browser tab; audio is bulk binary while the harness RPC wire carries JSON; and the recorded voice of a human is the most sensitive payload the product has ever moved. A microphone button wired straight to a vendor endpoint would put the key in the browser, tie the product to one vendor, and leave a headless deployment with no transcription at all.

## Decision

Transcription is a capability seam with all three roles, and the browser is one Consumer of it rather than the owner of the operation.

| Package | Role | Registers |
|---|---|---|
| `dsh-transcription` | Service Definition | `ctx.transcription` |
| `dsh-transcription-groq` | Service Provider | a provider on `ctx.transcription` |
| `dsh-voice-input` | Consumer (Host) | the `voiceInput` Typert Remote namespace |
| `dsh-client-ui-voice-input` | Consumer (browser) | an entry in `conversation.input.left` |

### The seam owns every transcription policy

`ctx.transcription` owns provider registration, runtime provider selection, the audio-byte ceiling, and transcript trimming. A Consumer adds only what its own transport forces on it. This is what lets a headless deployment and the browser reach identical behavior: neither one can widen a bound the other enforces, because neither one holds the bound.

The ceiling is a validated `maxAudioBytes` config field, defaulting to the 25 MiB the Groq endpoint accepts. Bounds are checked against the decoded byte length before any provider dispatch, so an oversized upload never reaches the network.

### Audio runs on the Host and stays transient

The provider credential lives on the Host, so the transcription request is issued there. The browser captures one utterance and uploads it; the Host answers with text.

Audio bytes exist for the duration of one call and become durable data nowhere: no session event, no log line, no cache, no spill file, no diagnostic that echoes the payload. Only the transcript crosses into the session, and only when the human sends the composer draft it was written into — which the ordinary user-message path already logs. This is what keeps the feature inside the model-visible-implies-logged rule without a new session event: the transcript is not model-visible until it is an ordinary typed message, and at that point the existing event carries it.

`packages/transcription/AGENTS.md` states the transience rule and the redirect rule for the group, because both are properties a future package in this family can silently break.

### Audio travels base64 over the existing RPC

The Typert RPC wire is JSON-only: one plain-object `args` field per call, with no binary channel. Audio therefore travels base64-encoded inside the ordinary request, mirroring how image attachments already reach the Host. The cost is the 4/3 expansion, which the 300 MiB default request-body budget absorbs at the configured ceiling.

The browser encodes in 0x8000-byte chunks. Spreading an audio-sized buffer into `String.fromCharCode` exceeds the argument limit and throws, so the chunked loop is required rather than defensive. The Host validates the upload against a canonical base64 pattern before decoding, because `Buffer.from` silently skips characters outside the alphabet — a corrupted upload would otherwise decode into plausible-looking audio and fail deep inside the provider with an opaque message.

### Failures are values, faults are exceptions

`voiceInput/transcribe` answers a closed business union: `audio-empty`, `audio-undecodable`, `audio-too-large`, `provider-unavailable`, `provider-unconfigured`, `provider-failed`, `aborted`. Every one of those is an outcome the user can act on, so each is a value with its own copy in the browser. An infrastructure fault is rethrown instead, because it is a defect rather than an outcome.

The browser reads two envelopes: the carrier `RemoteResult` the generated Remote face wraps every call in, then the business union inside it. Carrier failures are folded into that envelope rather than rejecting, so the caller never wraps the call to recover a transport error. The carrier's own failure code is an open string and operator-facing; the user reads one connection line for every transport outcome instead.

### The provider refuses redirects

The Groq request sets `redirect: 'error'`. A credential-bearing request that follows a redirect hands the audio to whatever origin the response names, and the audio here is a recording of a person. Node's `fetch` strips `authorization` across origins but forwards the body, so the payload is what leaks; the regression test proves the redirect target is never contacted for all five redirect statuses.

## Alternatives considered

**Transcribe in the browser with the Web Speech API.** It needs no key, no upload, and no Host work. It is also unavailable or silently vendor-routed depending on the browser, produces markedly worse text for accented and technical speech, and gives a headless deployment nothing. The seam keeps one transcription path for every client shape.

**Send the audio straight from the browser to the vendor.** This removes the base64 hop and the Host round trip. It also puts the transcription credential in a browser tab, where any page script and any extension can read it, and makes the vendor a hard dependency of the browser bundle. The credential stays on the Host.

**Add a binary RPC channel for audio.** A dedicated upload path avoids the 4/3 expansion. It also introduces a second transport with its own framing, trust fence, and body-limit rules for one feature, when the JSON path already carries image attachments at this size. The expansion is affordable; a second wire is not.

**Log the audio, or store it as an attachment.** This would give replay and let a user re-listen. It also makes the most sensitive payload in the product durable, which no current requirement asks for and no retention policy covers. Only the transcript persists.

**Insert the transcript as a sent message.** Speaking would then be a complete turn. It also removes the human's chance to correct a mistranscription, and would make transcription output model-visible without an ordinary user gesture. The transcript lands in the draft, and the human sends it.

**Put the ceiling and provider choice in the browser Consumer.** The browser could refuse an oversized recording before uploading and report a friendlier error. It would then own a bound the Host also enforces, and the two would drift. The seam holds the bound; the browser reports what the Host decided.

## Consequences

The harness gains speech input on the web GUI, and a headless or ACP deployment gains the same transcription operation through `ctx.transcription` with no browser involved. A second provider is a new package that registers on the seam, with no change to either Consumer.

The 4/3 base64 expansion is the standing cost: a deployment that raises `maxAudioBytes` must confirm its request-body budget still covers the expanded upload, or the request is refused before it reaches the seam.

There is no streaming transcription. One call carries one complete utterance, so a long recording produces no partial text and no feedback until it finishes. Interim results would require a streaming Remote operation the RPC layer does not have.

The spoken language is not declared. The seam accepts a language hint and the browser sends none, because the UI locale is not evidence of what the speaker is speaking; the provider auto-detects instead.

ACP stays audio-free: it refuses audio prompt content and advertises `promptCapabilities.audio: false`. The feature is web-only by construction, not by omission.
