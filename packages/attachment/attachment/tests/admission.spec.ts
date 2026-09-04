import { describe, expect, it, vi } from 'vitest'
import type { AttachmentStore } from '@deepseek-ai/dsh-attachment'
import { admitEncodedAttachments, admitEncodedImages } from '@deepseek-ai/dsh-attachment'
import type {
  FileAttachmentRef, ImageAttachmentRef, SaveImageAttachment,
} from '@deepseek-ai/dsh-attachment/types'

const PNG = 'AAAA' // canonical base64, 3 bytes

/** Delegation double: records the exact saveImages batch and answers ordered refs. */
function storeOf() {
  const store = {
    saveImages: vi.fn((inputs: readonly SaveImageAttachment[]) => Promise.resolve(inputs.map((input, index): ImageAttachmentRef => ({
      attachmentId: `att-${index + 1}` as ImageAttachmentRef['attachmentId'],
      mediaType: input.mediaType,
      bytes: input.data.byteLength,
      width: 1,
      height: 1,
      ...input.name === undefined ? {} : { name: input.name },
    })))),
  }
  return { store: store as unknown as AttachmentStore, mocks: store }
}

describe('admitEncodedImages', () => {
  it('decodes every member and delegates one ordered batch to saveImages', async () => {
    const { store, mocks } = storeOf()
    const refs = await admitEncodedImages(store, [
      { mediaType: 'image/png', data: PNG, name: 'first.png' },
      { mediaType: 'image/jpeg', data: PNG, name: 'second.jpg' },
    ])
    expect(mocks.saveImages).toHaveBeenCalledTimes(1)
    const batch = mocks.saveImages.mock.calls[0]?.[0] as readonly SaveImageAttachment[]
    expect(batch.map(input => [input.name, input.mediaType, input.data.byteLength]))
      .toEqual([['first.png', 'image/png', 3], ['second.jpg', 'image/jpeg', 3]])
    expect(refs.map(ref => ref.attachmentId)).toEqual(['att-1', 'att-2'])
  })

  it('omits the name from store inputs when the upload has none', async () => {
    const { store, mocks } = storeOf()
    const refs = await admitEncodedImages(store, [{ mediaType: 'image/webp', data: PNG }])
    const batch = mocks.saveImages.mock.calls[0]?.[0] as readonly SaveImageAttachment[]
    expect('name' in (batch[0] as object)).toBe(false)
    expect(refs[0]?.name).toBeUndefined()
  })

  it('delegates an empty batch unchanged', async () => {
    const { store, mocks } = storeOf()
    await expect(admitEncodedImages(store, [])).resolves.toEqual([])
    expect(mocks.saveImages).toHaveBeenCalledWith([])
  })

  it('rejects non-canonical and empty base64 payloads before any store call', async () => {
    const { store, mocks } = storeOf()
    for (const data of ['', 'AAA', '!!!!']) {
      await expect(admitEncodedImages(store, [{ mediaType: 'image/png', data }]))
        .rejects.toMatchObject({ name: 'AttachmentError', code: 'INVALID_IMAGE_BASE64' })
    }
    expect(mocks.saveImages).not.toHaveBeenCalled()
  })

  it('propagates the store batch rejection unchanged', async () => {
    const { store, mocks } = storeOf()
    const refused = Object.assign(new Error('Image batch exceeds the configured image-count limit.'), { code: 'TOO_MANY_IMAGES' })
    mocks.saveImages.mockRejectedValueOnce(refused)
    await expect(admitEncodedImages(store, [{ mediaType: 'image/png', data: PNG }])).rejects.toBe(refused)
  })
})

describe('admitEncodedAttachments', () => {
  it('authenticates uploads and restores mixed display order', async () => {
    const image: ImageAttachmentRef = {
      attachmentId: 'image-1' as ImageAttachmentRef['attachmentId'],
      mediaType: 'image/png', bytes: 3, width: 1, height: 1, name: 'image.png',
    }
    const encodedFile: FileAttachmentRef = {
      attachmentId: 'file-1' as FileAttachmentRef['attachmentId'],
      mediaType: 'text/plain', bytes: 3, name: 'notes.txt',
    }
    const uploadedFile: FileAttachmentRef = {
      attachmentId: 'file-2' as FileAttachmentRef['attachmentId'],
      mediaType: 'application/pdf', bytes: 4, name: 'evidence.pdf',
    }
    const saveImages = vi.fn(() => Promise.resolve([image]))
    const saveFiles = vi.fn(() => Promise.resolve([encodedFile]))
    const authorizeUploadedFiles = vi.fn(() => Promise.resolve([uploadedFile]))
    const store = {
      fileLimits: { maxFileBytes: 8, maxFilesPerMessage: 2, maxMessageFileBytes: 8 },
      saveImages,
      saveFiles,
      authorizeUploadedFiles,
    } as unknown as AttachmentStore

    const result = await admitEncodedAttachments(store, 'session-1', [
      { type: 'file', uploadId: 'receipt', attachment: uploadedFile },
      { type: 'image', mediaType: 'image/png', data: PNG, name: 'image.png' },
      { type: 'file', mediaType: 'text/plain', data: PNG, name: 'notes.txt' },
    ])

    expect(authorizeUploadedFiles).toHaveBeenCalledWith(
      'session-1', [{ uploadId: 'receipt', attachment: uploadedFile }],
    )
    expect(result).toEqual([
      { type: 'file', attachment: uploadedFile },
      { type: 'image', attachment: image },
      { type: 'file', attachment: encodedFile },
    ])
    expect(Object.isFrozen(result)).toBe(true)
    expect(result.every(Object.isFrozen)).toBe(true)
  })
})
