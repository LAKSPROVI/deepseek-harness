# 持久附件

[English](attachment.md) | 中文

附件 seam 将二进制所有权与会话日志分离。生产方把经过校验的字节交给 [`ctx.attachments`](#ctxattachments--attachmentstore-abstract-seam)；只有对象完成持久化后，该服务才会发布不可变的内容寻址引用。会话事件和模型可见的 `ImageBlock` 或 `FileBlock` 包含该引用及其元数据，绝不包含浏览器对象 URL、宿主临时路径、提供方 URL 或 base64 数据。

未发送的浏览器草稿可以保留在内存中，原生客户端也可以将其暂存于操作系统临时存储。宿主接受用户消息后，会先把附件移到 `<DSH_HOME>/attachments/v1` 下，再追加用户事件。图片使用经过校验的光栅归一化与请求版本；通用文件保留精确的不透明字节。

来源：[`packages/attachment/attachment/src/types.ts`](../../packages/attachment/attachment/src/types.ts)

## 标识与经过校验的元数据

`AttachmentId` 是带类型标记的不透明字符串。本地后端目前生成 `sha256:<digest>`，但消费方既不能解析这种表示，也不能据此派生文件系统路径。

```ts type-equiv
/** Durable, serializable reference to one immutable opaque file. */
interface FileAttachmentRef {
  /** Opaque content-addressed identifier; never a filesystem path or bearer URL. */
  attachmentId: AttachmentId
  /** Normalized declared media type, or `application/octet-stream`. */
  mediaType: string
  /** Exact stored byte length. */
  bytes: number
  /** Optional sanitized display name; storage never interprets it as a path. */
  name?: string
}
```

```ts type-equiv
/** Deployment-resolved limits for generic-file admission. */
interface FileAttachmentLimits {
  /** Maximum exact bytes accepted for one file. */
  maxFileBytes: number
  /** Maximum generic-file count accepted in one message. */
  maxFilesPerMessage: number
  /** Maximum aggregate generic-file bytes accepted in one message. */
  maxMessageFileBytes: number
}
```

```ts type-equiv
/** Base64-encoded generic-file upload accompanying one wire request. */
interface EncodedFileAttachment {
  /** Declared media type; absent or malformed values use the binary fallback. */
  mediaType?: string
  /** Canonical base64 encoding of the exact file bytes. */
  data: string
  /** Optional display name; it is never interpreted as a path. */
  name?: string
}
```

```ts type-equiv
/** Session-scoped proof that a raw upload produced one immutable file. */
interface UploadedFileAttachment {
  /** Opaque integrity proof over the scope and complete attachment reference. */
  uploadId: string
  /** Exact reference authenticated by `uploadId`; callers cannot replace its metadata. */
  attachment: FileAttachmentRef
}
```

```ts type-equiv
/** Request to validate and durably commit one opaque file. */
interface SaveFileAttachment {
  /** Exact file bytes; providers must not execute, decode, or extract them. */
  data: Uint8Array
  /** Declared media type; absent or malformed values use the binary fallback. */
  mediaType?: string
  /** Optional display name; it is never interpreted as a path. */
  name?: string
}
```

```ts type-equiv
/** Streaming request to validate and durably commit one opaque file. */
interface SaveFileAttachmentStream {
  /** Exact file bytes in producer order; Node.js `Readable` satisfies this interface. */
  data: AsyncIterable<Uint8Array>
  /** Optional exact byte count checked before publication. */
  expectedBytes?: number
  /** Declared media type; absent or malformed values use the binary fallback. */
  mediaType?: string
  /** Optional display name; it is never interpreted as a path. */
  name?: string
}
```

```ts type-equiv
/** Stored opaque bytes returned after reference and digest verification. */
interface StoredFileAttachment {
  ref: FileAttachmentRef
  data: Uint8Array
}
```

```ts type-equiv
/** Single-use verified stream over one stored opaque file. */
interface StoredFileAttachmentStream {
  ref: FileAttachmentRef
  /** Bytes are integrity-verified incrementally; corruption rejects iteration before successful completion. */
  data: AsyncIterable<Uint8Array>
}
```

```ts type-equiv
/** Raster image formats accepted by the version-one attachment path. */
type ImageMediaType = 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif'
```

```ts type-equiv
/** Durable, serializable reference to one immutable normalized image. */
interface ImageAttachmentRef {
  /** Opaque storage identifier; never a filesystem path or bearer URL. */
  attachmentId: AttachmentId
  /** Media type verified from the stored bytes. */
  mediaType: ImageMediaType
  /** Exact encoded byte length. */
  bytes: number
  /** Intrinsic encoded width in pixels. */
  width: number
  /** Intrinsic encoded height in pixels. */
  height: number
  /** Optional display name stripped of local path information. */
  name?: string
  /**
   * Input dimensions after applying EXIF orientation and before normalization
   * scaling. Present only when normalization reduced the image.
   */
  originalDimensions?: {
    width: number
    height: number
  }
}
```

```ts type-equiv
/** Deployment-resolved limits used by upload admission and request buffering. */
interface ImageAttachmentLimits {
  maxImageBytes: number
  maxImagesPerMessage: number
  maxMessageImageBytes: number
  maxImagePixels: number
  /** Maximum intrinsic width and maximum intrinsic height in pixels for one image. */
  maxImageDimension: number
  mediaTypes: readonly ImageMediaType[]
}
```

本地后端每条消息最多准入 20 张图片，源图编码数据总量不超过 200 MiB。单张源图不得超过 20 MiB、64,000,000 像素和单边 8192 像素。这些源文件限制先于独立的规范化阶段执行；该阶段默认把长边限制为 2048 像素，把编码数据限制为 4 MiB。

引用记录固有尺寸和编码长度，使客户端无需先解码即可排布历史记录；每次权威读取仍会根据对象重新校验摘要、媒体签名、尺寸和元数据。

## 提交与经校验读取的数据

```ts type-equiv
/** Base64-encoded image upload accompanying one wire request. */
interface EncodedImageAttachment {
  /** Declared media type, verified against the decoded bytes during admission. */
  mediaType: ImageMediaType
  /** Canonical base64 encoding of the image bytes. */
  data: string
  /** Optional display name; it is never interpreted as a path. */
  name?: string
}
```

```ts type-equiv
/** Request to validate and durably commit one image. */
interface SaveImageAttachment {
  data: Uint8Array
  /** Caller-declared media type, checked against fully decoded bytes. */
  mediaType: ImageMediaType
  /** Optional browser/provider display name; it is never interpreted as a path. */
  name?: string
}
```

```ts type-equiv
/** Stored image bytes returned after reference and digest verification. */
interface StoredImageAttachment {
  ref: ImageAttachmentRef
  data: Uint8Array
}
```

```ts type-equiv
/** Deterministic request-image policy selected by one exact model route. */
interface ImageRequestPolicy {
  /** Maximum width multiplied by height after aspect-preserving projection. */
  maxPixels: number
  /** Encoded-byte cap before base64 expansion or Files API upload. */
  maxBytes: number
}
```

```ts type-equiv
/** Cached request version derived from one provider-independent normalized attachment. */
interface RequestImageAttachment {
  /** Cache and upload-index key over the attachment id, policy, and fixed encoder parameters. */
  variantId: ImageVariantId
  /** Durable normalized attachment from which this request version was derived. */
  attachment: ImageAttachmentRef
  /** Encoded request bytes. */
  data: Uint8Array
  mediaType: ImageMediaType
  bytes: number
  width: number
  height: number
  /** Provider-compatible sample depth proven after request encoding. */
  depth: 'uchar'
  /** Provider-compatible color space proven after request encoding. */
  space: 'srgb'
  /** Whether the encoded request version retains an alpha channel. */
  hasAlpha: boolean
}
```

`saveImage()` 准备并原子提交提供方无关的规范化附件，然后直接返回 `ImageAttachmentRef`。`saveImages()` 在发布批次前为每个成员各准备一次经过验证的附件，因此校验拒绝不会留下部分对象，发布也不会重复解码或选择质量。`admitEncodedImages()` 是面向 base64 上传的 wire 入口，把张数、聚合字节和有序批量准入交给 `saveImages()`。`readImage()` 校验来自已授权会话路径的规范化附件。`readImageRequest()` 按确切路由的像素和字节预算派生并缓存请求版本；新条目在发布前完整解码，缓存命中只做有界元数据探测。调用方需要有序批次时，对单数方法使用 `Promise.all`。本地实现按需编码首选候选、合并相同请求身份的并发任务、允许每个等待方单独取消、没有等待方时停止共享任务，并通过实例级限流器限制全部变换，默认同时执行两项。该服务不规定保留策略：恢复和 fork 后的会话可能共享对象，因此基于引用的垃圾回收会延期实现，不与单个会话的删除绑定。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxattachments--attachmentstore-abstract-seam"></a>

### `ctx.attachments` — `AttachmentStore` (abstract seam)

Immutable binary attachment service. Implementations validate bytes before publishing a reference.

```ts cordis-catalog
/**
 * Validate one opaque file without persisting it.
 * @param input - exact bytes and untrusted display metadata.
 * @returns completion after the complete file admission policy succeeds.
 */
validateFile(input: SaveFileAttachment): Promise<void>

/**
 * Validate count, individual bytes, and aggregate bytes for durable file references.
 * @param refs - complete ordered file-reference batch.
 */
validateFileReferences(refs: readonly FileAttachmentRef[]): void

/**
 * Validate one ordered file batch without persisting any member.
 * @param inputs - opaque files in owning-message order.
 * @returns completion after batch and per-file validation succeeds.
 */
async validateFiles(inputs: readonly SaveFileAttachment[]): Promise<void>

/**
 * Validate the complete ordered file batch before committing any member.
 * @param inputs - opaque files in owning-message order.
 * @returns durable references in the same order after every member succeeds.
 */
async saveFiles(inputs: readonly SaveFileAttachment[]): Promise<readonly FileAttachmentRef[]>

/**
 * Validate and durably commit one opaque file without interpreting its bytes.
 * @param input - exact bytes and untrusted display metadata.
 * @returns the immutable content-addressed file reference.
 */
saveFile(input: SaveFileAttachment): Promise<FileAttachmentRef>

/**
 * Read one opaque file and verify its digest and exact byte length.
 * @param ref - durable reference from trusted session state.
 * @param signal - optional cancellation for backend read and verification work.
 * @returns exact verified bytes and the supplied reference.
 */
readFile(ref: FileAttachmentRef, signal?: AbortSignal): Promise<StoredFileAttachment>

/**
 * Stream one opaque file into durable storage and bind its receipt to an owning scope.
 * @param scope - opaque owner identity that must accompany later admission.
 * @param input - ordered byte source and untrusted display metadata.
 * @param signal - optional cancellation for source consumption, staging, and publication.
 * @returns a scoped proof and immutable reference after complete publication.
 */
saveFileStream( scope: string, input: SaveFileAttachmentStream, signal?: AbortSignal, ): Promise<UploadedFileAttachment>

/**
 * Verify a raw-upload receipt for its exact owner and immutable metadata.
 * @param scope - opaque owner identity supplied when the upload was created.
 * @param upload - proof and reference returned by `saveFileStream`.
 * @returns the authenticated immutable reference.
 */
authorizeUploadedFile(scope: string, upload: UploadedFileAttachment): Promise<FileAttachmentRef>

/**
 * Verify an ordered receipt batch and enforce complete message limits.
 * @param scope - opaque owner identity shared by every receipt.
 * @param uploads - ordered raw-upload receipts.
 * @returns authenticated references in the same order.
 */
async authorizeUploadedFiles( scope: string, uploads: readonly UploadedFileAttachment[], ): Promise<readonly FileAttachmentRef[]>

/**
 * Open a single-use verified byte stream without materializing the complete file.
 * @param ref - durable reference from trusted session state.
 * @param signal - optional cancellation observed during iteration.
 * @returns the reference and byte source; integrity failures reject iteration.
 */
readFileStream(ref: FileAttachmentRef, signal?: AbortSignal): Promise<StoredFileAttachmentStream>

/**
 * Validate one image without persisting it.
 * Batch callers validate every member before saving any member.
 * @param input - encoded bytes, declared media type, and optional display name.
 * @returns completion after the encoded raster has been fully decoded.
 */
abstract validateImage(input: SaveImageAttachment): Promise<void>

/**
 * Validate and durably commit one ordered image batch.
 * @param inputs - encoded images in owning-message order.
 * @returns durable normalized attachment references in the same order after every member succeeds.
 */
async saveImages(inputs: readonly SaveImageAttachment[]): Promise<readonly ImageAttachmentRef[]>

/**
 * Validate and durably commit one image before its owning session event is appended.
 * The returned reference describes the persisted normalized image. When
 * normalization reduces the raster, its `originalDimensions` records the
 * orientation-applied input dimensions.
 * @param input - encoded bytes, declared media type, and optional display name.
 * @returns the durable content-addressed normalized image reference.
 */
abstract saveImage(input: SaveImageAttachment): Promise<ImageAttachmentRef>

/**
 * Read one image and verify that bytes still match the recorded reference.
 * @param ref - durable reference from the session log.
 * @param signal - optional cancellation for backend read and verification work.
 * @returns the verified bytes and normalized attachment reference.
 * @throws the signal reason when aborted, or a storage error when verification fails.
 */
abstract readImage(ref: ImageAttachmentRef, signal?: AbortSignal): Promise<StoredImageAttachment>

/**
 * Generate or read one deterministic model-request version from the stored normalized image.
 * @param ref - durable provider-independent normalized attachment reference.
 * @param policy - exact route pixel and encoded-byte budget.
 * @param signal - optional cancellation.
 * @returns request bytes and the cache/upload identity covering every transform input.
 */
readImageRequest( ref: ImageAttachmentRef, policy: ImageRequestPolicy, signal?: AbortSignal, ): Promise<RequestImageAttachment>
```

Source: [`packages/attachment/attachment/src/index.ts`](../../packages/attachment/attachment/src/index.ts)
<!-- END GENERATED cordis-surface -->
