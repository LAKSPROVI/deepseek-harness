---
description: "Push-to-talk microphone entry for the Web composer that uploads one utterance and appends the transcript to the draft."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-voice-input

English | [中文](README.zh.md)

## Summary

Push-to-talk voice input for the Web composer. The plugin contributes one microphone entry (id `voice-input`, order 20) to the conversation composer's `conversation.input.left` tool row: the browser records one utterance with `MediaRecorder`, uploads it to the Host over the generated `voiceInput` Remote namespace, and appends the returned transcript to the session draft.

## Table of Contents

- [Overview](#overview)
- [How one utterance travels](#how-one-utterance-travels)
- [Presentation state and copy](#presentation-state-and-copy)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="overview"></a>
## Overview

This is a **presentation** package. It registers no tool, no prompt section, and no session event. Transcription itself belongs to [`@deepseek-ai/dsh-voice-input`](../../transcription/voice-input/README.md) and the transcription seam behind it; this package owns the recording gesture, the upload hop, and the failure copy.

The client plugin activates from stable faces (`slots`, `remote`, and `locale`) and installs its composer contribution only when `remote.voiceInput` appears. Generated Remote namespaces are mounted asynchronously by `api-remotes`; treating `remote.voiceInput` as a static plugin injection turns valid startup ordering into a failed-plugin screen. The child injection scope is also withdrawn with the namespace during HMR.

<a id="how-one-utterance-travels"></a>
## How one utterance travels

A pointer press starts recording and a release sends it; keyboard activation toggles instead, because a keyboard cannot express "still holding" — Enter or Space starts, the next press sends. Both gestures land on the same start/stop pair, so the control is fully operable without a pointer.

The RPC layer is JSON-only, so the recorded bytes ride as canonical base64 inside an ordinary request. The encoder loops in 0x8000-byte chunks: spreading an audio-sized buffer into `String.fromCharCode` exceeds the argument limit and throws. The media type is read from what `MediaRecorder` actually produced (container parameters such as `;codecs=opus` dropped) and matched against the five types the Host accepts — `audio/webm`, `audio/ogg`, `audio/wav`, `audio/mp4`, `audio/mpeg`. A browser-specific container outside that set is refused locally with its own message rather than uploaded for the Host to reject.

Every exit path stops the `MediaStream` tracks: a completed take, a refused format, a denied permission, a cancelled upload, and unmount, including an unmount that happens while the permission prompt is still open. A leaked track leaves the browser's recording indicator lit, which users read as the application listening after they stopped.

The transcript is appended, not assigned: `inputActions.setDraft` takes the complete next draft, so the component reads the live draft and joins the transcript to it with a single space when the draft is non-empty. A transcript that trims to empty leaves the draft untouched and announces that nothing was heard.

The answer arrives in two envelopes and the control reads both. The outer one is the carrier: a generated Remote method resolves to `RemoteResult<T>`, and the Remote face folds carrier failures into its error branch instead of rejecting, so nothing wraps the call to recover one. Its `code` is an open string and its message is operator-facing, so neither is switched on nor displayed — every outcome where the request did not complete reads as one line. The inner envelope is the Host's own result, whose seven failure codes are a closed union switched exhaustively and closed with `assertNever`. Only an assembly fault (arity, an unmounted method, a missing Context binder) still rejects; that path is caught so an abort mid-flight cannot surface as an unhandled rejection.

Cancellation is real: the in-flight call carries an `AbortSignal` the gateway honours, and the control also disowns the request so a late answer to a cancelled upload cannot write into the draft.

Audio bytes and their base64 encoding never reach the console, and no recording is retained after its call settles.

<a id="presentation-state-and-copy"></a>
## Presentation state and copy

Recording, uploading, and failure state are local component state — nothing here is shared across entries or survives a remount, so no store is declared. The control carries an accessible name that tracks its phase, `aria-pressed` while recording, `aria-busy` while uploading, and one polite live region that announces each phase change and outcome; failure text also renders visibly for sighted users, outside the accessibility tree so it is announced once.

All copy is localized in the `voiceInput` namespace (zh as the key-set source of truth, en checked complete against it). Each Host business failure code renders as its own line: `provider-unconfigured` tells the user the deployment holds no transcription credential and to configure one. The copy names no provider, because the transcription seam accepts any registered provider and Groq is only the shipped default. Operator-facing `detail` strings never reach the UI — they are diagnostics, not user copy, and an arbitrary-length provider message does not fit a one-row composer control.

<a id="model-experience"></a>
## Model Experience

None, as this package is presentation only and registers no tool, prompt fragment, or session event; the transcript lands in the composer draft as ordinary user text, and only the message a human then sends becomes model-visible, through the user-message path that already logs it.

#### KV Cache effect

Independent of every model request: this package contributes no token to any request, so it neither builds nor invalidates a reusable prefix. A transcript the human sends affects the prefix exactly as the same text typed by hand would.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **No language hint is sent** — the request's optional `language` field is left absent, so the provider detects the language. The browser half of a client plugin receives no cordis `config` (the boot manifest carries only id, url, rev, inject, immediately, and external), so a deployment-chosen language cannot be delivered here; the active UI locale is a display preference and not evidence of the language a user speaks.
- **A long take is refused only after it uploads** — the audio-byte ceiling belongs to the transcription seam, so this consumer adds no cap of its own and an oversized take is encoded and sent before the Host answers `audio-too-large`. A duplicate client-side bound would let the browser and a headless deployment diverge.
- **One entry, one recording** — the control refuses a second gesture while a recording or upload is in flight; there is no queue of pending takes.
- **A whole-composer takeover hides the control** — a pending interaction that replaces the InputBar (a question or plan review) takes the tool row and this entry down with it until it resolves.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

No runtime invariant companion is published because the recording lifecycle lives entirely in one browser component's local state and in MediaStream tracks released on every exit path; the audio bytes never become durable data, and the one relationship worth asserting (a stopped recording leaves no live track) is observable only from the browser, where component specs drive the recorder.
