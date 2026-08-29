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
  SaveImageAttachment,
  StoredFileAttachment,
  StoredImageAttachment,
} from './types.ts'

export { AttachmentId, ImageVariantId } from './brand.ts'
export { AttachmentError, isFileAdmissionError, isImageAdmissionError } from './error.ts'
export type { AttachmentErrorCode, FileAdmissionErrorCode, ImageAdmissionErrorCode } from './error.ts'
export { admitEncodedFiles, admitEncodedImages } from './admission.ts'
export type {
  AttachmentId as AttachmentIdType,
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
  SaveImageAttachment,
  StoredFileAttachment,
  StoredImageAttachment,
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
  async validateFile(input: SaveFileAttachment): Promise<void> {
    void input
    throw new AttachmentError(
      'The mounted attachment provider does not support generic files.',
      'FILE_ATTACHMENTS_UNSUPPORTED',
    )
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
