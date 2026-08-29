# Agent Note: Raw streaming generic-file transfer

Status: implemented

English | [中文](2026-08-29-raw-streaming-generic-file-transfer.zh.md)

## Problem

The generic-file attachment path originally used the same base64 JSON carrier as images. That representation cannot safely carry the required 1 GiB file limit: base64 expands the payload, `File.arrayBuffer()` materializes the source, JSON construction creates a complete string, the Host bridge concatenates the complete body, and decoding allocates another complete buffer. A 1 GiB file also exceeds practical V8 string limits before Host admission can reject or persist it.

The upload and download paths must therefore keep memory bounded without weakening the durable-reference rule from [Opaque generic file attachments](2026-08-29-opaque-generic-file-attachments.md). Uploading bytes alone must not publish a user message, retries after a business rejection must not retransmit the object, and an attachment id alone must not authorize a download.

## Decision

Served Web transfers generic files through the exact `POST` and `GET /api/session.file` route outside the buffered JSON bridge. Images remain on the existing base64 RPC path. Fixture mode and custom `__DSH_TRANSPORT__` carriers expose no raw-transfer capability and retain the bounded legacy `EncodedFileAttachment` path.

The default generic-file limits are 1 GiB (`1,073,741,824` bytes) per file and 1 GiB for the complete generic-file batch, with at most 20 files. These are storage and submission limits, not a promise that a selected model consumes file bytes. Routes without native `file` input receive the deterministic metadata projection; the built-in DeepSeek routes remain text-and-image routes.

### Upload and receipt

The browser sends the `File` object directly as the request body and declares the session id, exact byte count, display name, and media type in bounded request metadata. The raw route checks the declared length and forwards the request as an `AsyncIterable<Uint8Array>` without `arrayBuffer()`, base64, JSON, or `Buffer.concat`.

`AttachmentStore.saveFileStream` counts and hashes chunks incrementally, enforces per-file and aggregate limits while reading, writes a private staging file, syncs it, publishes by exclusive hard link into content-addressed storage, and removes staging state on cancellation or failure. Equal bytes deduplicate. `expectedBytes` is both an early limit check and an exact end-of-stream assertion.

A successful upload returns `UploadedFileAttachment { uploadId, attachment }`. The local provider computes `uploadId` as HMAC-SHA-256 over the exact session scope and complete normalized `FileAttachmentRef`, using a random process-local secret and constant-time verification. Prompt and command admission authenticate the receipt for the exact session and validate the complete mixture of legacy and uploaded file references before publishing a durable message. The browser caches a successful receipt by session and draft attachment until release, so a rejected prompt or command can retry without retransmitting the object.

### Download authorization

The browser supplies only `sessionId` and `attachmentId` to the raw GET. The Host derives all metadata from a matching file block in that session's authoritative `user/message.content`; tool metadata, arbitrary plugin JSON, and other event fields do not authorize a read. It then streams a digest-and-length-verified object with `application/octet-stream`, attachment disposition, `X-Content-Type-Options: nosniff`, and `Cache-Control: private, no-store`. Range requests are rejected because partial reads cannot satisfy the complete-object verification contract.

The `/api` browser trust fence also guards this route. That fence prevents DNS-rebinding and cross-site reachability; it is not user authentication and this decision does not claim otherwise.

## Alternatives considered

**Raise the buffered JSON carrier limit.** This preserves one transport but still requires several complete-file allocations, incurs base64 expansion, and crosses runtime string limits before reaching 1 GiB. A larger constant cannot make the representation stream.

**Log the upload immediately.** This would make upload authorization state durable, but selecting a file would publish model-visible history before the user submits a prompt or command. Upload remains staging; only accepted prompt or command admission appends the reference.

**Use an unsigned attachment id as the upload result.** Content addressing proves bytes, not who uploaded them or which metadata and session were admitted. The receipt binds all of those values while remaining small enough for the ordinary RPC envelope.

**Teach every provider to consume generic bytes.** Provider support is independent from Harness storage capacity. Metadata fallback remains deterministic and explicit; a provider receives bytes only when its route declares native file input.

## Testing

Storage tests use small configured limits to cover exact length, one-byte overflow across chunks, expected-length mismatch, cancellation cleanup, deduplication, verified streaming reads, wrong-session receipt denial, and metadata tampering without allocating a real 1 GiB buffer. Host, command, connection, and conversation tests cover mixed legacy/receipt order, upload without event publication, authoritative-log download authorization, raw request bodies, backpressure, Range denial, receipt reuse, fallback carriers, and direct download URLs.

## Consequences

- Served Web can accept and return 1 GiB generic files with bounded application memory and transport backpressure.
- Upload receipts are reusable only within the same Host process and exact session. Restart invalidates an uploaded-but-unsubmitted receipt; references already accepted into session history remain valid.
- The content-addressed store has no per-user quota, upload reservation ledger, receipt TTL, or reference-aware garbage collector. An uploaded object that is never submitted may remain orphaned until a future retention system collects it.
- The raw route adds a second HTTP transfer path and its own cancellation, length, authorization, and lifecycle tests. The buffered JSON carrier remains for images and compatibility transports.
- Generic file cards remain inert and expose no transfer progress. The browser delegates the final streamed save to its normal download handling.
