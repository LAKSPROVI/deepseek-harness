/** Wire-form admission of base64-encoded image and opaque-file uploads. @module @deepseek-ai/dsh-attachment/admission */

import { Buffer } from 'node:buffer'
import { AttachmentError } from './error.ts'
import { AttachmentStore } from './index.ts'
import type {
  AdmittedAttachmentBlock,
  EncodedAttachment,
  EncodedFileAttachment,
  EncodedImageAttachment,
  FileAttachmentRef,
  ImageAttachmentRef,
  SaveFileAttachment,
  SaveImageAttachment,
  UploadedFileAttachment,
} from './types.ts'

/** Decode one upload payload while rejecting non-canonical base64 forms. */
function decodeBase64(
  data: string,
  subject: 'File' | 'Image',
  code: 'INVALID_FILE_BASE64' | 'INVALID_IMAGE_BASE64',
): Uint8Array {
  const decoded = Buffer.from(data, 'base64')
  if ((subject === 'Image' && data.length === 0) || decoded.toString('base64') !== data) {
    throw new AttachmentError(`${subject} upload is not canonical base64.`, code)
  }
  return new Uint8Array(decoded)
}

/** Store input for one decoded image upload. */
function imageSaveInput(image: EncodedImageAttachment): SaveImageAttachment {
  return {
    data: decodeBase64(image.data, 'Image', 'INVALID_IMAGE_BASE64'),
    mediaType: image.mediaType,
    ...image.name === undefined ? {} : { name: image.name },
  }
}

/** Store input for one decoded generic-file upload. */
function fileSaveInput(file: EncodedFileAttachment): SaveFileAttachment {
  return {
    data: decodeBase64(file.data, 'File', 'INVALID_FILE_BASE64'),
    ...file.mediaType === undefined ? {} : { mediaType: file.mediaType },
    ...file.name === undefined ? {} : { name: file.name },
  }
}

/**
 * Admit one wire image batch: enforce canonical base64 on every member, then
 * delegate batch admission — count and aggregate-byte limits, media-type and
 * per-image validation, ordered commit — to {@link AttachmentStore.saveImages}.
 * The shared entry for every RPC endpoint accepting browser uploads.
 * @param attachments - the deployment attachment store owning batch policy.
 * @param images - base64-encoded uploads in caller order.
 * @returns durable references in the same order as `images`.
 * @throws AttachmentError on a non-canonical payload or a refused batch.
 */
export async function admitEncodedImages(
  attachments: AttachmentStore,
  images: readonly EncodedImageAttachment[],
): Promise<readonly ImageAttachmentRef[]> {
  return attachments.saveImages(images.map(imageSaveInput))
}

/**
 * Decode every generic-file upload before delegating one ordered batch.
 * No bytes are interpreted as paths, executables, or archives.
 * @param attachments - the attachment store owning file admission policy.
 * @param files - base64-encoded opaque files in caller order.
 * @returns durable references in the same order as `files`.
 * @throws AttachmentError on non-canonical base64 or refused admission.
 */
export async function admitEncodedFiles(
  attachments: AttachmentStore,
  files: readonly EncodedFileAttachment[],
): Promise<readonly FileAttachmentRef[]> {
  return attachments.saveFiles(files.map(fileSaveInput))
}

/** Read one admitted reference whose index came from the matching encoded group. */
function admittedAt<T>(values: readonly T[], index: number): T {
  const value = values[index]
  if (value === undefined) throw new Error('attachment admission changed the submitted cardinality')
  return value
}

/**
 * Admit one mixed image and file vector, then restore its submitted order.
 * Uploaded-file receipts are authenticated against `scope`; encoded payloads
 * pass through the same batch policies as every other attachment entry point.
 * @param attachments - the attachment store owning image and file policy.
 * @param scope - opaque owner identity bound into uploaded-file receipts.
 * @param inputs - complete mixed attachment vector in display order.
 * @returns frozen durable blocks in the same order as `inputs`.
 */
export async function admitEncodedAttachments(
  attachments: AttachmentStore,
  scope: string,
  inputs: readonly EncodedAttachment[],
): Promise<readonly AdmittedAttachmentBlock[]> {
  const images: EncodedImageAttachment[] = []
  const encodedFiles: EncodedFileAttachment[] = []
  const uploadedFiles: UploadedFileAttachment[] = []
  const order: Array<{ readonly type: 'image' | 'encoded-file' | 'uploaded-file'; readonly index: number }> = []
  for (const input of inputs) {
    if (input.type === 'image') {
      order.push({ type: 'image', index: images.length })
      images.push(input)
    } else if ('data' in input) {
      order.push({ type: 'encoded-file', index: encodedFiles.length })
      encodedFiles.push(input)
    } else {
      order.push({ type: 'uploaded-file', index: uploadedFiles.length })
      const { type: _type, ...upload } = input
      uploadedFiles.push(upload)
    }
  }
  const [imageRefs, encodedRefs, uploadedRefs] = await Promise.all([
    images.length === 0 ? [] : admitEncodedImages(attachments, images),
    encodedFiles.length === 0 ? [] : admitEncodedFiles(attachments, encodedFiles),
    uploadedFiles.length === 0 ? [] : attachments.authorizeUploadedFiles(scope, uploadedFiles),
  ])
  if (encodedRefs.length > 0 || uploadedRefs.length > 0) {
    AttachmentStore.prototype.validateFileReferences.call(attachments, [...encodedRefs, ...uploadedRefs])
  }
  return Object.freeze(order.map((entry): AdmittedAttachmentBlock => {
    if (entry.type === 'image') {
      return Object.freeze({ type: 'image', attachment: admittedAt(imageRefs, entry.index) })
    }
    const refs = entry.type === 'encoded-file' ? encodedRefs : uploadedRefs
    return Object.freeze({ type: 'file', attachment: admittedAt(refs, entry.index) })
  }))
}
