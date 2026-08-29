/** Browser raw-file transfer over the served same-origin Web carrier. */

import type {
  FileAttachmentRef, UploadedFileAttachment,
} from '@deepseek-ai/dsh-attachment'
import type { SessionId } from './api.ts'
import { FILE_TRANSFER_PATH } from '../api-path.ts'

/** Raw generic-file operations available only on the served HTTP application. */
export interface BrowserFileTransfer {
  /**
   * Stream one browser File to durable Host storage without base64 encoding.
   * @param sessionId - session that alone may submit the returned receipt.
   * @param file - browser-owned opaque bytes and display metadata.
   * @param signal - optional request cancellation.
   * @returns session-bound receipt carrying the durable file reference.
   */
  upload(sessionId: SessionId, file: File, signal?: AbortSignal): Promise<UploadedFileAttachment>
  /**
   * Build the same-origin URL that streams one logged file through Host authorization.
   * @param sessionId - session whose log must reference the file.
   * @param attachment - durable file reference rendered by that session.
   * @returns URL suitable for a browser download navigation.
   */
  downloadUrl(sessionId: SessionId, attachment: FileAttachmentRef): string
}

/**
 * Create the served-Web raw transfer client.
 * @returns raw upload and authorized-download operations for the current origin.
 */
export function createWebFileTransfer(): BrowserFileTransfer {
  return {
    async upload(sessionId, file, signal) {
      const url = transferUrl({
        sessionId: String(sessionId),
        bytes: String(file.size),
        mediaType: file.type === '' ? 'application/octet-stream' : file.type,
        ...(file.name === '' ? {} : { name: file.name }),
      })
      const response = await globalThis.fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/octet-stream' },
        body: file,
        ...signal === undefined ? {} : { signal },
      })
      if (!response.ok) {
        const detail = await response.text()
        throw new Error(`file upload failed: HTTP ${response.status}${detail === '' ? '' : `: ${detail}`}`)
      }
      return await response.json() as UploadedFileAttachment
    },
    downloadUrl(sessionId, attachment) {
      return transferUrl({
        sessionId: String(sessionId),
        attachmentId: String(attachment.attachmentId),
      }).href
    },
  }
}

function transferUrl(params: Readonly<Record<string, string>>): URL {
  const location = (globalThis as { location?: { origin?: string } }).location
  const base = location?.origin !== undefined && location.origin !== 'null'
    ? location.origin
    : 'http://dsh.internal'
  const url = new URL(FILE_TRANSFER_PATH, base)
  for (const [name, value] of Object.entries(params)) url.searchParams.set(name, value)
  return url
}
