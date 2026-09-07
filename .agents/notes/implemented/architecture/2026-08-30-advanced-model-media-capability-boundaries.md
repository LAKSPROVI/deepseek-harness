# Agent Note: Advanced model media capabilities require four complete layers

Status: implemented

English | [中文](2026-08-30-advanced-model-media-capability-boundaries.zh.md)

## Problem

The harness can durably store an opaque PDF, audio file, or video, and its provider-neutral content types include a `FileBlock`. Those facts can be mistaken for native model support. They prove that a user can attach, retain, replay, export, and download bytes; they do not prove that an adapter puts those bytes on a provider request or that the provider interprets them.

The same ambiguity exists on output. `ImageBlock` is role-neutral, the attachment store can retain generated image bytes, and the client can render an assistant image reference. The installed pi-ai package also exposes a separate image-generation API. None of those facts makes image output part of the current chat stream, and opaque file storage does not provide audio playback or an audio-output contract.

A truthful capability statement therefore has to separate durable storage, canonical model content, provider wire support, and product rendering. Collapsing them produces false-positive capability metadata, provider-side failures after durable admission, or outputs that cannot survive replay.

## Decision

A native media capability exists only when every layer needed for that direction is complete:

1. **Durable storage** admits bounded bytes, returns an immutable reference, and verifies identity and length on read.
2. **Canonical model content** names the modality in provider-neutral content and capability metadata, and every model-visible reference is reconstructable from the session log and immutable object store.
3. **Adapter wire support** converts that canonical block into an officially supported request or response form for an exact provider route without silently dropping bytes or relying on an untyped payload patch.
4. **Product rendering and output persistence** presents the durable reference safely; generated media is committed before the assistant block or message becomes visible.

Storage is not wire support, a canonical block is not wire support, and UI readiness is not provider support. Model metadata declares only the intersection implemented by the selected adapter and exact route.

### Current capability matrix

| Direction | Durable storage | Canonical model content | Current adapter wire | UI and replay |
| --- | --- | --- | --- | --- |
| Generic file or PDF input | Complete through opaque `FileAttachmentRef`; PDF is distinguished only by declared `application/pdf`. | Complete through `FileBlock` and input modality `file`; unsupported routes receive deterministic metadata text. | Unsupported. No production adapter serializes `FileBlock` bytes or a generic-file id. | Complete as an inert file card and forced download; no inline PDF interpretation. |
| Audio input | Bytes can be retained as an opaque generic file. | Absent: no `AudioBlock` or `audio` input modality. | Unsupported. | The generic file card can download the bytes; there is no native audio presentation contract. |
| Video input | Bytes can be retained as an opaque generic file. | Absent: no `VideoBlock` or `video` input modality. | Unsupported. | The generic file card can download the bytes; there is no native video presentation contract. |
| Image output | Complete through `ImageAttachmentRef` when a producer commits validated raster bytes. | `ImageBlock` is role-neutral and valid in assistant content, but the model catalog has no output-modality declaration. | Unsupported in the chat adapters: no production adapter retrieves and commits generated image bytes before emitting assistant content. | Assistant image folding and rendering accept a durable `ImageBlock`; this readiness does not certify a producer. |
| Audio output | Bytes could use opaque file storage. | Absent: no `AudioBlock` or output-modality declaration. | Unsupported. | No audio player or audio-specific replay contract exists. |

[Opaque generic file attachments](../feature/2026-08-29-opaque-generic-file-attachments.md) owns file admission, storage, metadata fallback, and safe download. [Web multimodal image input and durable attachments](../feature/2026-07-22-web-multimodal-image-input-and-durable-attachments.md) owns image normalization, `ImageBlock`, and persist-before-event ordering. This note owns the rule that neither foundation certifies a provider wire.

### pi-ai 0.82.1 is an upstream limit, not a capability to infer around

The installed `@earendil-works/pi-ai` 0.82.1 chat types restrict `Model.input` to `text | image`. A user message contains only `TextContent | ImageContent`; an assistant chat message contains only text, thinking, and tool calls. `dsh-llm-pi-ai` follows that API: it projects unsupported durable modalities before conversion, resolves images through the attachment service, and builds a pi-ai context containing text and images. A `FileBlock` therefore becomes deterministic metadata text rather than provider bytes.

pi-ai exposes `ImagesModel`, `ImagesContext`, and `AssistantImages` through a separate image-generation API whose outputs are text or image. The harness chat adapter calls `Models.streamSimple()` and translates its chat event stream; it does not mount that separate API as assistant chat output. Using the image API requires a separately owned consumer or an explicit chat-output integration that persists returned bytes before publishing them. Its mere presence in the dependency is not route capability.

The direct DeepSeek adapter's wire part named `type: 'file'` is also not generic-file support. It is produced only from an `ImageBlock` after the attachment service creates a bounded `RequestImageAttachment`; the Files API id is an image representation. Its serializer has no `FileBlock` branch, so the same path does not transport a PDF.

The existing pi-ai modality declaration remains truthful for its supported domain: [a pi-ai model declares its own input modalities](2026-08-12-pi-ai-route-default-input-modalities.md), and undeclared input remains text. Configuration cannot widen the installed pi-ai chat type or make the Harness converter carry a block it does not represent.

### Conditions for a future adapter

A provider adapter reports a new native media capability only when all of these statements are true:

- The provider's documented API and the adapter's typed request or response representation carry the modality. A model name, catalog boolean, HTTP success, generic payload hook, or opaque upload endpoint is not evidence that model inference consumed the bytes.
- The exact route and model publish the capability separately for input and output. Discovery that omits modality remains unknown or conservatively unsupported; it is not upgraded by inference from naming.
- Input serialization resolves the canonical durable reference, enforces provider-specific count, size, media, and time limits, and emits the exact documented wire form. Unsupported routes retain the shared deterministic fallback rather than dropping a block.
- Output handling bounds and validates provider bytes, commits them through the attachment service, and only then emits the completed assistant block. Provider URLs, base64, temporary paths, and file ids never become canonical session content.
- Session replay, fork, export, compaction, token accounting, and client rendering either preserve the new block or reject it explicitly. A generated output that exists only in a live stream is incomplete.
- Serializer tests inspect the exact request body, negative tests prove unsupported routes do not receive bytes, session persistence tests reconstruct the durable block, and a mounted keyless snapshot covers user-visible behavior. A real-provider test additionally proves hidden media content affects the response or that returned bytes decode as the declared output; status alone is insufficient.

A provider API that accepts arbitrary files by MIME can use the existing `FileBlock` for PDF without a `PdfBlock`. Audio and video gain dedicated canonical blocks only when a current adapter or consumer needs their semantics; retaining their bytes as `FileAttachmentRef` remains valid storage but does not by itself justify new model content types. Output capability metadata is separate from `inputModalities` because accepting an image and generating one are independent provider properties.

## Alternatives considered

**Treat every stored file as native model input.** Rejected because storage proves byte identity, not request serialization or provider interpretation. It would turn an implementation gap into false capability metadata and move rejection after durable admission.

**Patch provider payloads outside the typed adapter conversion.** Rejected because an untyped payload patch cannot repair the missing canonical content, replay, response event, and per-protocol conversion obligations. It would also claim common support while depending on provider-specific undocumented fields.

**Use `FileBlock` as the permanent canonical type for every audio and video API.** Retained as the opaque storage representation, but rejected as a universal model-content rule. Some providers accept arbitrary files, while others require audio- or video-specific parts, metadata, limits, and response events. The first real consumer determines whether `FileBlock` is sufficient or a dedicated block is required.

**Call preprocessing or generation tools native model modality support.** Rejected. A transcription, frame extraction, OCR, TTS, or image-generation tool can be a complete capability of its own, but the model receives that tool's result rather than native request media, and capability metadata must preserve the distinction.

**Expose pi-ai's separate image API as chat output automatically.** Rejected because it has a separate model registry, request operation, and terminal result rather than the chat event stream. It belongs behind an explicit consumer until a chat-output integration owns selection, cancellation, persistence, session events, and rendering together.

## Consequences

Users can attach and retain arbitrary files without the product pretending that the selected model reads them. A PDF reaches unsupported routes as stable metadata and remains available for a later file-capable route; audio and video remain downloadable opaque files. Current chat routes advertise no native PDF/file, audio, or video input and no image or audio output unless an exact adapter completes the corresponding row.

This conservatism leaves working provider features unavailable until their adapter is implemented and verified, but failures remain local and intelligible instead of appearing after model-visible state has been committed. It also keeps future work surgical: PDF can reuse `FileBlock`; image output can reuse `ImageBlock` and the attachment store; audio and video add canonical types only when an implemented wire requires them.

The matrix is intentionally about architectural completeness, not a permanent product ceiling. An upstream pi-ai release can remove a blocker only when its typed chat or media API is integrated through the same durable and user-visible layers; upgrading the package alone changes no Harness capability claim.
