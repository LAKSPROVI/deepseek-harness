# Agent Note: Opaque generic file attachments

Status: implemented

English | [中文](2026-08-29-opaque-generic-file-attachments.zh.md)

## Problem

The attachment capability accepted raster images and nothing else. The composer refused any file whose type was not PNG, JPEG, WebP, or GIF; the store decoded, reoriented, and normalized every admitted byte as a raster; the model content vocabulary carried one `ImageBlock`; and the command envelope declared `input.images`. A user who wanted to hand the agent the artifact a task is actually about — a CSV, a build log, a zip, a `.docx`, a firmware blob — had no route at all, and no durable representation existed for one.

Widening that path is not a matter of relaxing a media-type list. The bytes a user attaches are arbitrary and untrusted, and every convenience the harness might offer over them is a way to execute the uploader's intent instead of the user's. A name that looks like a path is not a path. An HTML or SVG payload rendered in the GUI runs script in the product's own origin, against a page that holds the session. An archive that is unpacked is a zip-slip waiting for a traversal entry. A declared MIME type is a claim by whoever produced the upload, not evidence about the bytes.

The routing problem is equally load-bearing. Most currently registered model routes accept text and images only, and a third-party route that does accept files does so on its own terms. Dropping a file the user explicitly attached, silently, is exactly the failure the image work already ruled out: the user's intent changes without the user or the model being told.

## Decision

Generic files are admitted as immutable opaque bytes. The harness stores them, addresses them, authorizes them, and hands them to routes that declare they accept files. It does not interpret them.

### Durable vocabulary

The attachment seam gains a file half beside the image half, and the model content vocabulary gains one block for it.

| Type | Home | Role |
| --- | --- | --- |
| `FileAttachmentRef` | [`packages/attachment/attachment/src/types.ts`](../../../../packages/attachment/attachment/src/types.ts) | Durable reference: content-addressed `attachmentId`, normalized `mediaType`, exact `bytes`, optional sanitized display `name`. |
| `EncodedFileAttachment` | [`packages/attachment/attachment/src/types.ts`](../../../../packages/attachment/attachment/src/types.ts) | The wire form: canonical base64 `data`, optional declared `mediaType`, optional `name`. |
| `FileBlock` | [`packages/llm/llm/src/types.ts`](../../../../packages/llm/llm/src/types.ts) | Role-neutral `ContentBlockMap` member `file`, carrying only a `FileAttachmentRef`. |
| `ModelModality` `file` | [`packages/llm/llm/src/types.ts`](../../../../packages/llm/llm/src/types.ts) | The declaration a route makes when it accepts file input natively. |

A `FileAttachmentRef` never carries a filesystem path, a bearer URL, or bytes. The session log therefore holds references only, exactly as it does for images, and the durable session event plus the immutable object remain jointly sufficient to reconstruct what a model saw.

The bytes live under the same content-addressed store as images, below `$DSH_HOME/attachments/v1/objects/<prefix>/<sha256>`, with the same owner-only permissions, the same prepare-then-atomically-publish commit, and the same digest-and-length verification on every read. Files take the store's opaque path: no decode, no reorientation, no normalized master, no derived request version. The identity of a file is its exact original bytes.

### The Host owns validation

Admission is authoritative on the Host and nowhere else. Served Web streams generic-file bytes into `AttachmentStore.saveFileStream`, then prompt and command submission authorize the returned `UploadedFileAttachment` receipt for the exact session and validate the complete reference batch. Compatibility carriers use `admitEncodedFiles`, which rejects non-canonical base64 before decoding and delegates to `saveFiles`. Both paths publish only durable references; rejected admission appends no session message.

A declared media type is normalized, never trusted as evidence: an absent, empty, or malformed value becomes `application/octet-stream`. A supplied name is reduced to a sanitized display basename with control characters removed; storage never resolves it, joins it, or reads it as a location. Reads verify the recorded digest and exact byte length, so a corrupted or substituted object fails loud instead of reaching a model or a browser.

Caller-correctable file failures are their own closed set — `TOO_MANY_FILES`, `FILES_TOO_LARGE`, `FILE_TOO_LARGE`, `INVALID_FILE_BASE64` — distinguishable from storage faults through `isFileAdmissionError`, so a composer can name the limit a user hit while an I/O fault stays an operator concern. A deployment whose attachment provider supports images only leaves `fileLimits` undefined, and every file operation on it answers `FILE_ATTACHMENTS_UNSUPPORTED` rather than half-accepting.

### What the harness will not do with the bytes

These are negative guarantees of the feature, not incidental omissions:

- No name is interpreted as a path, and no path is derived from user-supplied metadata.
- No admitted file is executed, spawned, or handed to an interpreter.
- No archive is unpacked, enumerated, or inspected for members.
- No file content is rendered actively. HTML, SVG, and any other markup a browser would execute are bytes to be stored and downloaded, never markup to be mounted in the product origin.
- No content sniffing upgrades a file into a richer type. Only a media type that is already one of the supported raster formats enters the image pipeline; everything else stays opaque for its whole lifetime.

### Limits and transport capacity

Generic files carry their own validated deployment policy in `LocalAttachmentStore`, independent of the image policy that continues to govern rasters.

| Bound | Default | Meaning |
| --- | --- | --- |
| `maxFilesPerMessage` | 20 | Generic files accepted in one message, counted separately from images. |
| `maxFileBytes` | 1 GiB | Exact bytes accepted for one generic file. |
| `maxMessageFileBytes` | 1 GiB | Aggregate generic-file bytes accepted in one submission. |
| `maxRequestBodyBytes` | 600 MiB | Buffered JSON RPC body; it does not carry served-Web generic files. |

Served Web sends generic files through the raw streaming transfer recorded in [Raw streaming generic-file transfer](2026-08-29-raw-streaming-generic-file-transfer.md). Images and compatibility carriers remain on the bounded base64 JSON path. The composer pre-checks count, per-file bytes, and aggregate bytes against the `fileLimits` projection for immediate feedback; the Host independently enforces the same bounds for every caller.

### Composer, history, and download

The composer's picker, drag-and-drop, and paste paths all accept generic files alongside images and preserve the submitted order across the mixed batch: a text-plus-image-plus-file prompt reaches the model with its blocks in the positions the user built. Draft files remain browser-owned temporary state, exactly like draft images, and become durable only at message acceptance.

In history, only a supported raster image uses the image pipeline, inline gallery geometry, and lightbox. A generic file renders as an inert card showing its display name, media type, and byte count with one action: download. Served Web follows a session-authorized raw URL; the Host forces `application/octet-stream`, attachment disposition, `nosniff`, and `private, no-store`, so the browser streams the file without rendering its declared type or constructing a complete Blob.

Read authorization is a proof obligation, not a token check. The raw GET authorizes only a file reference in the requested session's authoritative `user/message.content`; tool metadata and arbitrary logged JSON do not qualify. Holding a content-addressed identifier is therefore insufficient to read it from a session that never accepted the file as user content.

### Model routes and the metadata fallback

A route declares what it accepts through `inputModalities`. When a request's history contains a `FileBlock` and the resolved route does not declare `file`, the shared LLM runtime projects that block into deterministic text through `textOnlyFileText`: the attachment identifier, the display name, the media type, and the exact byte count. The block is never removed silently, and the projection is a transient request-time view — durable history keeps the reference untouched, so the same session sent to a file-capable route later delivers the real bytes.

That projection is the single source for every consumer that needs a text stand-in: ACP, which has no generic file block on its wire, emits the same text; provider-neutral token estimation charges the same text; session-query extraction indexes the same text. One placeholder means these surfaces cannot drift from what the model was actually shown.

The built-in DeepSeek route is deliberately unchanged: its Files API path remains image-only, its catalog entries advertise `text` and `image`, and its per-model modality type excludes `file`. A DeepSeek request carrying a file therefore receives the metadata fallback. File-capable routes are third-party ones that declare the modality, and for those the actual file contents leave the deployment.

### The command envelope generalizes

The command submission envelope, which previously modeled images only, now carries the whole mixed batch. `CommandDefinition.input.attachments` replaces `input.images` as the declaration; the wire type is `EncodedCommandAttachment`, a tagged union of an encoded image and an encoded file; and the executor admits the two groups and then restores the submitted mixed order before freezing the blocks onto the invocation. The enforcement position is unchanged and remains the executor: attachments sent to a non-declaring command, an absent attachment store, or an exceeded batch limit settle as a logged `command/done` error before the handler runs, and a composer route that cannot consume the envelope refuses it visibly with the draft and its attachments retained.

### Relationship to the image-specific notes

This decision partially supersedes two implemented notes, and both stay active as the authority for their image-specific halves.

[Web multimodal image input and durable attachments](2026-07-22-web-multimodal-image-input-and-durable-attachments.md) remains authoritative for image normalization, the provider-independent master, image intake limits, the image lightbox, and provider image conversion. Superseded there: its statement that the attachment path supports images only, its rejection of a generic non-image attachment as future work, and its framing of `session.attachment` and the intake wire as image-shaped. The union it rejected — one undifferentiated `AttachmentBlock` for every modality — is *not* what shipped; `FileBlock` is a second explicit block, so every consumer still handles or refuses each modality by name.

[Command image-attachment envelope](2026-08-17-command-image-attachment-envelope.md) remains authoritative for whole-envelope consumption, producer-owned model visibility, the composer refusal banner, and the executor-enforcement rule. Superseded there: the image-only declaration field and the image-only wire type. Its own alternatives section named the exact reintroduction condition — "a second supported attachment kind is the reintroduction condition; the command envelope then widens to a tagged attachment union and commands declare the accepted kinds" — and this is that widening.

The image request pipeline recorded in [Unified image masters, request versions, and provider files](2026-08-20-unified-image-request-pipeline.md) and the intake alignment in [Whole-page image drop, projected intake limits, and thumbnail tiling](2026-08-12-web-image-intake-and-limits-alignment.md) are untouched: generic files never enter either.

## Alternatives considered

**Reinterpret an attached file as a workspace path and let the existing file tools read it.** This looks free — the harness already has read, glob, and grep — but it is a category error with a security consequence. An attachment name is uploader-supplied text that may name nothing on this host, may name something else entirely, or may be built to traverse; the bytes a user attached from a phone or another machine have no path at all. Turning a display name into a filesystem operation would make untrusted metadata address the host's disk. The name stays display-only.

**Inline durable base64 in session events instead of storing objects.** It removes the store, the digest, and the read authorization in one step. It also duplicates every attached byte across the event log, history pages, forks, compaction input, and exports; puts the complete file into one JSONL line; and invites token accounting to treat encoding text as model text. One immutable object plus a small reference keeps the durable representation bounded, and content addressing deduplicates the same file attached twice.

**Assume every adapter can take a file and let providers sort it out.** Uniformity would remove the modality declaration and the fallback path. It would also convert an unsupported input into a provider-side error deep in a request, or worse into a silently dropped block, and it would make the user's intent depend on which route happened to be selected. Declared modalities plus one deterministic metadata projection keep the model informed and the failure visible.

**Render the declared MIME type actively — preview HTML, display SVG, show PDFs inline.** This is the obvious product feature and the reason the file half exists at all. It is also the one change that converts an upload into execution inside the product origin: an SVG or HTML attachment is a script delivery mechanism, and the page it would run in holds the live session. Inert cards plus forced download give up preview convenience to keep untrusted bytes from ever being interpreted by the client.

**Keep generic files in the buffered base64 JSON carrier.** This remains the compatibility path for fixtures and custom transports, but it cannot implement the 1 GiB contract: base64 expands the payload, the browser and bridge materialize complete strings and buffers, and V8 string limits can be crossed before admission. Served Web therefore uses the raw route owned by [Raw streaming generic-file transfer](2026-08-29-raw-streaming-generic-file-transfer.md); images remain on JSON because their existing limits fit that carrier.

## Testing

Store and admission tests cover opaque streaming publication, digest and length verification, exact and exceeded limits with small configured bounds, staging cleanup, deduplication, cancellation, HMAC receipt scope and metadata integrity, canonical-base64 compatibility, and image-only providers. Host and command tests cover mixed legacy/receipt order, wrong-session denial, upload without event publication, and download authorization only after `user/message.content`. Connection and client tests prove raw `File` upload, backpressured route copying, receipt reuse after business rejection, legacy fallback, and direct forced-download URLs. LLM tests cover deterministic metadata projection and its reuse by ACP, token estimation, and session-query extraction.

## Consequences

- The harness accepts the artifacts tasks are usually about, not just pictures of them, and one durable representation serves the composer, the session log, commands, ACP, and every provider adapter.
- Durable storage grows faster, and still has no reference-aware garbage collection. One accepted submission may retain 1 GiB, which raises the cost of deferring that collection policy without changing its design.
- **File contents leave the deployment for file-capable third-party routes.** A user attaching a contract, a database dump, or a private key to a session routed at such a provider sends those exact bytes to that vendor under that vendor's retention terms. The harness makes the modality declaration and the route selection visible, but it does not classify content, and nothing in the product judges whether a given file should be transmitted. Deployments that cannot accept this route their sessions to text-and-image models, where the metadata fallback sends only the identifier, name, media type, and size.
- Served-Web files use a second HTTP route beside the JSON carrier. The route adds lifecycle and authorization work, but it keeps resident memory bounded as the file limit reaches 1 GiB; compatibility carriers remain constrained by their buffered base64 path.
- Users will expect previews the product deliberately does not provide. The inert card is a standing product cost paid for the guarantee that no attached byte is ever interpreted by the client.
- Generic files share durable content addressing and mixed-order semantics with images but use a separate served-Web transfer route, so changes to reference identity or message reconstruction must preserve both modalities without assuming one transport.
