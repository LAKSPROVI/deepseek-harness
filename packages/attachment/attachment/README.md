# @deepseek-ai/dsh-attachment

English | [中文](README.zh.md)

The durable attachment seam. `ctx.attachments` validates and durably commits provider-independent normalized images and opaque generic files, then returns a serializable `ImageAttachmentRef` or `FileAttachmentRef`; consumers never persist browser paths, object URLs, provider URLs, or base64 in session events.

Unsent composer attachments remain browser-owned temporary drafts. `validateImage` runs the complete admission policy without persisting. `saveImages` owns batch count and aggregate-byte limits, prepares every normalized attachment before publishing any member, then commits in order and returns references only after the complete batch succeeds. A later storage failure returns no partial references, although an earlier immutable content-addressed object may remain unreachable until reference-aware garbage collection exists. `saveImage` commits one accepted image before any model-visible session event is published and returns its `ImageAttachmentRef`. When normalization reduces the raster, the reference records the orientation-applied input size in `originalDimensions`. `readImage` verifies the normalized attachment against its logged metadata. `readImageRequest` deterministically derives a route-sized request version whose identity covers the attachment id, transform version, pixel and byte budgets, and encoder settings. Callers compose ordered batches with `Promise.all(refs.map(...))`; the local implementation still bounds compression through its instance limiter, cache, and singleflight. Callers may cancel reads and projections; implementations preserve cancellation instead of translating it into a storage failure.

Generic files travel the same durable path without content interpretation. `FileAttachmentRef` carries the opaque content-addressed `attachmentId`, normalized `mediaType`, exact `bytes`, and optional sanitized `name`; storage never resolves the display name as a path. `fileLimits` is undefined when a provider supports images only, and every file operation then rejects with `FILE_ATTACHMENTS_UNSUPPORTED`. `saveFiles` retains the bounded in-memory compatibility path. `saveFileStream(scope, input)` incrementally enforces limits, hashes, stages, syncs, and publishes a raw upload, then returns an `UploadedFileAttachment` receipt authenticating the complete reference for that scope. Prompt and command admission call `authorizeUploadedFiles` before logging references. `readFileStream` verifies digest and length during iteration without materializing the complete object. Missing or malformed media types become `application/octet-stream`; no method decodes, extracts, transcodes, or executes file bytes. `AttachmentError.code` uses the closed `AttachmentErrorCode` union, and its admission subsets let protocol adapters map caller-correctable failures.

`admitEncodedImages` and `admitEncodedFiles` remain the canonical-base64 entries for images and carriers without raw file transfer. Served Web uploads generic files first through the streaming path and submits only `UploadedFileAttachment`; prompt and command admission may combine receipts with legacy encoded files, validate the complete reference batch, and preserve submitted order. Images remain on the base64 path.

## Model Experience

Indirectly, through the role-neutral core `ImageBlock` and `FileBlock` and the provider adapters that resolve their durable references. Durable storage alone grants no native model understanding: an adapter resolves an image reference into an exact request version whose descriptor exposes the complete attachment id and actual request dimensions, while a route that does not declare the `file` input modality receives the core deterministic metadata projection — attachment id, name, media type, and byte length as text — instead of file bytes, and only a file-capable route can receive the contents.

#### KV Cache effect

Adding an image or a file changes the provider request and therefore invalidates the affected request suffix.

## Known Limitations and Deferred Work

- Image admission accepts PNG, JPEG, WebP, and GIF only.
- Retention and garbage collection are deferred because resumed and forked sessions may share immutable objects.
- A file submitted to a configured third-party file-capable model provider is sent to that provider as bytes; the harness does not restrict which file contents a route may receive.
- Audio, video, and persistent unsent drafts require separate lifecycle and provider contracts.
