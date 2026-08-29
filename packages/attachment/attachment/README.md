# @deepseek-ai/dsh-attachment

English | [中文](README.zh.md)

The durable attachment seam. `ctx.attachments` validates and durably commits provider-independent normalized images and opaque generic files, then returns a serializable `ImageAttachmentRef` or `FileAttachmentRef`; consumers never persist browser paths, object URLs, provider URLs, or base64 in session events.

Unsent composer attachments remain browser-owned temporary drafts. `validateImage` runs the complete admission policy without persisting. `saveImages` owns batch count and aggregate-byte limits, prepares every normalized attachment before publishing any member, then commits in order and returns references only after the complete batch succeeds. A later storage failure returns no partial references, although an earlier immutable content-addressed object may remain unreachable until reference-aware garbage collection exists. `saveImage` commits one accepted image before any model-visible session event is published and returns its `ImageAttachmentRef`. When normalization reduces the raster, the reference records the orientation-applied input size in `originalDimensions`. `readImage` verifies the normalized attachment against its logged metadata. `readImageRequest` deterministically derives a route-sized request version whose identity covers the attachment id, transform version, pixel and byte budgets, and encoder settings. Callers compose ordered batches with `Promise.all(refs.map(...))`; the local implementation still bounds compression through its instance limiter, cache, and singleflight. Callers may cancel reads and projections; implementations preserve cancellation instead of translating it into a storage failure.

Generic files travel the same durable path without any content interpretation. `FileAttachmentRef` carries the opaque content-addressed `attachmentId`, the normalized `mediaType`, exact `bytes`, and an optional sanitized `name`; the name is display metadata that storage never resolves as a path. `fileLimits` is the deployment-resolved generic-file policy and is `undefined` on a provider that supports images only, in which case `validateFile`, `saveFile`, `saveFiles`, and `readFile` all reject with `FILE_ATTACHMENTS_UNSUPPORTED`. `saveFiles` enforces file count, per-file bytes, and aggregate bytes before any write, then commits in order and returns references only after the complete batch succeeds. `readFile` verifies the reference, exact byte length, and content digest before returning bytes. A declared media type that is absent or does not parse as a valid type/subtype becomes `application/octet-stream`. Nothing in this seam decodes, extracts, transcodes, or executes file bytes, so a file's stored representation is exactly the submitted bytes. `AttachmentError.code` uses the closed `AttachmentErrorCode` string union. Its `ImageAdmissionErrorCode` and `FileAdmissionErrorCode` subsets mark caller-correctable image and file input failures; `isImageAdmissionError` and `isFileAdmissionError` recognize those subsets at runtime so each protocol adapter can map its own error vocabulary.

`admitEncodedImages(attachments, images)` and `admitEncodedFiles(attachments, files)` are the shared wire entries used by every RPC endpoint that accepts browser uploads (the session prompt endpoint and the command executor): each enforces canonical base64 on every member, then delegates batch admission — limits, validation, ordered commit — to `saveImages` or `saveFiles`. The base64 upload forms are `EncodedImageAttachment` and `EncodedFileAttachment`, exported from `@deepseek-ai/dsh-attachment/types` so wire contracts can reference them.

## Model Experience

Indirectly, through the role-neutral core `ImageBlock` and `FileBlock` and the provider adapters that resolve their durable references. Durable storage alone grants no native model understanding: an adapter resolves an image reference into an exact request version whose descriptor exposes the complete attachment id and actual request dimensions, while a route that does not declare the `file` input modality receives the core deterministic metadata projection — attachment id, name, media type, and byte length as text — instead of file bytes, and only a file-capable route can receive the contents.

#### KV Cache effect

Adding an image or a file changes the provider request and therefore invalidates the affected request suffix.

## Known Limitations and Deferred Work

- Image admission accepts PNG, JPEG, WebP, and GIF only.
- Retention and garbage collection are deferred because resumed and forked sessions may share immutable objects.
- A file submitted to a configured third-party file-capable model provider is sent to that provider as bytes; the harness does not restrict which file contents a route may receive.
- Audio, video, and persistent unsent drafts require separate lifecycle and provider contracts.
