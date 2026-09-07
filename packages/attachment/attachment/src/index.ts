/** Durable attachment storage seam (`ctx.attachments`). @module @deepseek-ai/dsh-attachment */

import { Context, Service } from '@deepseek-ai/cordis'
import { AttachmentError } from './error.ts'
import type {
  FileAttachmentLimits,
  FileAttachmentRef,
  ImageAttachmentLimits,
  ImageAttachmentRef,
  ImageRequestPolicy,
  RequestImageAttachment,
  SaveFileAttachment,
  SaveFileAttachmentStream,
  SaveImageAttachment,
  StoredFileAttachment,
  StoredFileAttachmentStream,
  StoredImageAttachment,
  UploadedFileAttachment,
} from './types.ts'

export { AttachmentId, ImageVariantId } from './brand.ts'
export { AttachmentError, isFileAdmissionError, isImageAdmissionError } from './error.ts'
export type { AttachmentErrorCode, FileAdmissionErrorCode, ImageAdmissionErrorCode } from './error.ts'
export { admitEncodedAttachments, admitEncodedFiles, admitEncodedImages } from './admission.ts'
export type {
  AdmittedAttachmentBlock,
  AttachmentId as AttachmentIdType,
  EncodedAttachment,
  EncodedFileAttachment,
  EncodedImageAttachment,
  FileAttachmentLimits,
  FileAttachmentRef,
  ImageAttachmentLimits,
  ImageAttachmentRef,
  ImageRequestPolicy,
  ImageMediaType,
  RequestImageAttachment,
  SaveFileAttachment,
  SaveFileAttachmentStream,
  SaveImageAttachment,
  StoredFileAttachment,
  StoredFileAttachmentStream,
  StoredImageAttachment,
  UploadedFileAttachment,
} from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    attachments: AttachmentStore
  }
}

/** Immutable binary attachment service. Implementations validate bytes before publishing a reference. */
export abstract class AttachmentStore extends Service {
  constructor(ctx: Context) {
    super(ctx, 'attachments')
  }

  /** Deployment-resolved image policy used by authoritative and fast-path validation. */
  abstract readonly imageLimits: ImageAttachmentLimits

  /** Deployment-resolved generic-file policy, absent when the provider only supports images. */
  readonly fileLimits: FileAttachmentLimits | undefined = undefined

  /**
   * Validate one opaque file without persisting it.
   * @param input - exact bytes and untrusted display metadata.
   * @returns completion after the complete file admission policy succeeds.
   */
  validateFile(input: SaveFileAttachment): Promise<void> {
    void input
    return Promise.reject(new AttachmentError(
      'Generic-file validation requires a generic-file attachment provider.',
      'FILE_ATTACHMENTS_UNSUPPORTED',
    ))
  }

  /**
   * Validate count, individual bytes, and aggregate bytes for durable file references.
   * @param refs - complete ordered file-reference batch.
   */
  validateFileReferences(refs: readonly FileAttachmentRef[]): void {
    const limits = this.fileLimits
    if (limits === undefined) {
      throw new AttachmentError(
        'The mounted attachment provider does not support generic files.',
        'FILE_ATTACHMENTS_UNSUPPORTED',
      )
    }
    if (refs.length > limits.maxFilesPerMessage) {
      throw new AttachmentError('File batch exceeds the configured file-count limit.', 'TOO_MANY_FILES')
    }
    let totalBytes = 0
    for (const ref of refs) {
      if (!Number.isSafeInteger(ref.bytes) || ref.bytes < 0 || ref.bytes > limits.maxFileBytes) {
        throw new AttachmentError('File exceeds the configured byte limit.', 'FILE_TOO_LARGE')
      }
      totalBytes += ref.bytes
      if (!Number.isSafeInteger(totalBytes) || totalBytes > limits.maxMessageFileBytes) {
        throw new AttachmentError('File batch exceeds the configured aggregate file-byte limit.', 'FILES_TOO_LARGE')
      }
    }
  }

  /** Validate generic-file count, aggregate bytes, and each exact byte length before writes. */
  protected validateFileBatch(inputs: readonly SaveFileAttachment[]): void {
    const limits = this.fileLimits
    if (limits === undefined) {
      throw new AttachmentError(
        'The mounted attachment provider does not support generic files.',
        'FILE_ATTACHMENTS_UNSUPPORTED',
      )
    }
    if (inputs.length > limits.maxFilesPerMessage) {
      throw new AttachmentError('File batch exceeds the configured file-count limit.', 'TOO_MANY_FILES')
    }
    let totalBytes = 0
    for (const input of inputs) {
      if (input.data.byteLength > limits.maxFileBytes) {
        throw new AttachmentError('File exceeds the configured byte limit.', 'FILE_TOO_LARGE')
      }
      totalBytes += input.data.byteLength
      if (!Number.isSafeInteger(totalBytes) || totalBytes > limits.maxMessageFileBytes) {
        throw new AttachmentError('File batch exceeds the configured aggregate file-byte limit.', 'FILES_TOO_LARGE')
      }
    }
  }

  /**
   * Validate one ordered file batch without persisting any member.
   * @param inputs - opaque files in owning-message order.
   * @returns completion after batch and per-file validation succeeds.
   */
  async validateFiles(inputs: readonly SaveFileAttachment[]): Promise<void> {
    this.validateFileBatch(inputs)
    for (const input of inputs) await this.validateFile(input)
  }

  /**
   * Validate the complete ordered file batch before committing any member.
   * @param inputs - opaque files in owning-message order.
   * @returns durable references in the same order after every member succeeds.
   */
  async saveFiles(inputs: readonly SaveFileAttachment[]): Promise<readonly FileAttachmentRef[]> {
    await this.validateFiles(inputs)
    const refs: FileAttachmentRef[] = []
    for (const input of inputs) refs.push(await this.saveFile(input))
    return refs
  }

  /**
   * Validate and durably commit one opaque file without interpreting its bytes.
   * @param input - exact bytes and untrusted display metadata.
   * @returns the immutable content-addressed file reference.
   */
  saveFile(input: SaveFileAttachment): Promise<FileAttachmentRef> {
    void input
    return Promise.reject(new AttachmentError(
      'The mounted attachment provider does not support generic files.',
      'FILE_ATTACHMENTS_UNSUPPORTED',
    ))
  }

  /**
   * Read one opaque file and verify its digest and exact byte length.
   * @param ref - durable reference from trusted session state.
   * @param signal - optional cancellation for backend read and verification work.
   * @returns exact verified bytes and the supplied reference.
   */
  readFile(ref: FileAttachmentRef, signal?: AbortSignal): Promise<StoredFileAttachment> {
    signal?.throwIfAborted()
    void ref
    return Promise.reject(new AttachmentError(
      'The mounted attachment provider does not support generic files.',
      'FILE_ATTACHMENTS_UNSUPPORTED',
    ))
  }

  /**
   * Stream one opaque file into durable storage and bind its receipt to an owning scope.
   * @param scope - opaque owner identity that must accompany later admission.
   * @param input - ordered byte source and untrusted display metadata.
   * @param signal - optional cancellation for source consumption, staging, and publication.
   * @returns a scoped proof and immutable reference after complete publication.
   */
  saveFileStream(
    scope: string,
    input: SaveFileAttachmentStream,
    signal?: AbortSignal,
  ): Promise<UploadedFileAttachment> {
    signal?.throwIfAborted()
    void scope
    void input
    return Promise.reject(new AttachmentError(
      'The mounted attachment provider does not support generic files.',
      'FILE_ATTACHMENTS_UNSUPPORTED',
    ))
  }

  /**
   * Verify a raw-upload receipt for its exact owner and immutable metadata.
   * @param scope - opaque owner identity supplied when the upload was created.
   * @param upload - proof and reference returned by `saveFileStream`.
   * @returns the authenticated immutable reference.
   */
  authorizeUploadedFile(scope: string, upload: UploadedFileAttachment): Promise<FileAttachmentRef> {
    void scope
    void upload
    return Promise.reject(new AttachmentError('Uploaded file receipt is invalid.', 'INVALID_ATTACHMENT_REF'))
  }

  /**
   * Verify an ordered receipt batch and enforce complete message limits.
   * @param scope - opaque owner identity shared by every receipt.
   * @param uploads - ordered raw-upload receipts.
   * @returns authenticated references in the same order.
   */
  async authorizeUploadedFiles(
    scope: string,
    uploads: readonly UploadedFileAttachment[],
  ): Promise<readonly FileAttachmentRef[]> {
    const refs = await Promise.all(uploads.map(upload => this.authorizeUploadedFile(scope, upload)))
    this.validateFileReferences(refs)
    return refs
  }

  /**
   * Open a single-use verified byte stream without materializing the complete file.
   * @param ref - durable reference from trusted session state.
   * @param signal - optional cancellation observed during iteration.
   * @returns the reference and byte source; integrity failures reject iteration.
   */
  readFileStream(ref: FileAttachmentRef, signal?: AbortSignal): Promise<StoredFileAttachmentStream> {
    signal?.throwIfAborted()
    void ref
    return Promise.reject(new AttachmentError(
      'Streaming file reads require a generic-file attachment provider.',
      'FILE_ATTACHMENTS_UNSUPPORTED',
    ))
  }

  /**
   * Validate one image without persisting it.
   * Batch callers validate every member before saving any member.
   * @param input - encoded bytes, declared media type, and optional display name.
   * @returns completion after the encoded raster has been fully decoded.
   */
  abstract validateImage(input: SaveImageAttachment): Promise<void>

  /**
   * Validate one ordered image batch before committing any member.
   * Validation failures start no writes; storage failures return no partial
   * references, although already published content-addressed objects may stay
   * unreachable until a future retention policy collects them.
   * @param inputs - encoded images in their owning message order.
   * @returns durable references in the exact input order.
   */
  protected validateImageBatch(inputs: readonly SaveImageAttachment[]): void {
    const { maxImagesPerMessage, maxMessageImageBytes, mediaTypes } = this.imageLimits
    if (inputs.length > maxImagesPerMessage) {
      throw new AttachmentError('Image batch exceeds the configured image-count limit.', 'TOO_MANY_IMAGES')
    }
    const totalBytes = inputs.reduce((sum, input) => sum + input.data.byteLength, 0)
    if (totalBytes > maxMessageImageBytes) {
      throw new AttachmentError('Image batch exceeds the configured aggregate image-byte limit.', 'IMAGES_TOO_LARGE')
    }
    for (const input of inputs) {
      if (!mediaTypes.includes(input.mediaType)) {
        throw new AttachmentError(`Image type ${input.mediaType} is not accepted by this deployment.`, 'UNSUPPORTED_IMAGE_TYPE')
      }
    }
  }

  /**
   * Validate and durably commit one ordered image batch.
   * @param inputs - encoded images in owning-message order.
   * @returns durable normalized attachment references in the same order after every member succeeds.
   */
  async saveImages(inputs: readonly SaveImageAttachment[]): Promise<readonly ImageAttachmentRef[]> {
    this.validateImageBatch(inputs)
    for (const input of inputs) await this.validateImage(input)

    const refs: ImageAttachmentRef[] = []
    for (const input of inputs) refs.push(await this.saveImage(input))
    return refs
  }

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
  readImageRequest(
    ref: ImageAttachmentRef,
    policy: ImageRequestPolicy,
    signal?: AbortSignal,
  ): Promise<RequestImageAttachment> {
    signal?.throwIfAborted()
    void ref
    void policy
    return Promise.reject(new AttachmentError(
      'The mounted attachment provider cannot derive model-request images.',
      'ATTACHMENT_PROJECTION_UNSUPPORTED',
    ))
  }

}

export default AttachmentStore
