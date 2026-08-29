import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import AttachmentStore, {
  AttachmentError,
  AttachmentId,
  admitEncodedFiles,
  isFileAdmissionError,
  type FileAttachmentLimits,
  type FileAttachmentRef,
  type ImageAttachmentRef,
  type SaveFileAttachment,
  type SaveImageAttachment,
  type StoredFileAttachment,
  type StoredImageAttachment,
} from '../src/index.ts'

const IMAGE_LIMITS = {
  maxImageBytes: 4,
  maxImagesPerMessage: 2,
  maxMessageImageBytes: 5,
  maxImagePixels: 4,
  maxImageDimension: 2000,
  mediaTypes: ['image/png'] as const,
}

const FILE_LIMITS: FileAttachmentLimits = {
  maxFileBytes: 4,
  maxFilesPerMessage: 2,
  maxMessageFileBytes: 5,
}

/** Concrete store recording the exact generic-file admission order. */
class RecordingFileStore extends AttachmentStore {
  readonly imageLimits = IMAGE_LIMITS
  override readonly fileLimits: FileAttachmentLimits = FILE_LIMITS
  readonly calls: string[] = []

  override async validateFile(input: SaveFileAttachment): Promise<void> {
    this.calls.push(`validate:${input.data[0] ?? 0}`)
  }

  override saveFile(input: SaveFileAttachment): Promise<FileAttachmentRef> {
    const value = input.data[0] ?? 0
    this.calls.push(`save:${value}`)
    return Promise.resolve({
      attachmentId: AttachmentId(`sha256:${String(value).padStart(64, '0')}`),
      mediaType: input.mediaType ?? 'application/octet-stream',
      bytes: input.data.byteLength,
      ...input.name === undefined ? {} : { name: input.name },
    })
  }

  override readFile(ref: FileAttachmentRef): Promise<StoredFileAttachment> {
    return Promise.resolve({ ref, data: Uint8Array.of(ref.bytes) })
  }

  validateImage(): Promise<void> {
    return Promise.resolve()
  }

  saveImage(_input: SaveImageAttachment): Promise<ImageAttachmentRef> {
    throw new Error('not used')
  }

  readImage(_ref: ImageAttachmentRef): Promise<StoredImageAttachment> {
    throw new Error('not used')
  }
}

/** Store that never opts into generic files: the default provider behavior. */
class ImageOnlyStore extends AttachmentStore {
  readonly imageLimits = IMAGE_LIMITS

  validateImage(): Promise<void> {
    return Promise.resolve()
  }

  saveImage(): Promise<ImageAttachmentRef> {
    throw new Error('not used')
  }

  readImage(): Promise<StoredImageAttachment> {
    throw new Error('not used')
  }
}

function file(value: number, bytes = 1): SaveFileAttachment {
  return { data: new Uint8Array(bytes).fill(value), mediaType: 'application/pdf', name: `${value}.pdf` }
}

describe('admitEncodedFiles', () => {
  it('decodes every member and delegates one ordered batch to saveFiles', async () => {
    const store = new RecordingFileStore(new Context())

    const refs = await admitEncodedFiles(store, [
      { mediaType: 'application/pdf', data: 'AQ==', name: 'first.pdf' },
      { mediaType: 'application/zip', data: 'Ag==', name: 'second.zip' },
    ])

    expect(store.calls).toEqual(['validate:1', 'validate:2', 'save:1', 'save:2'])
    expect(refs.map(ref => [ref.name, ref.mediaType, ref.bytes]))
      .toEqual([['first.pdf', 'application/pdf', 1], ['second.zip', 'application/zip', 1]])
  })

  it('passes an undeclared media type through so the store applies the binary fallback', async () => {
    const store = new RecordingFileStore(new Context())

    const refs = await admitEncodedFiles(store, [{ data: 'AQ==' }])

    expect(refs[0]?.mediaType).toBe('application/octet-stream')
    expect(refs[0]).not.toHaveProperty('name')
  })

  it('admits a zero-byte file, unlike an empty image payload', async () => {
    const store = new RecordingFileStore(new Context())

    const refs = await admitEncodedFiles(store, [{ data: '', name: 'empty.bin' }])

    expect(refs[0]?.bytes).toBe(0)
  })

  it('rejects non-canonical base64 before any store call', async () => {
    const store = new RecordingFileStore(new Context())

    for (const data of ['AQ', 'AQ=', '!!!!', 'AQ== ']) {
      await expect(admitEncodedFiles(store, [{ data }]))
        .rejects.toMatchObject({ name: 'AttachmentError', code: 'INVALID_FILE_BASE64' })
    }
    expect(store.calls).toEqual([])
  })

  it('delegates an empty batch unchanged', async () => {
    const store = new RecordingFileStore(new Context())

    await expect(admitEncodedFiles(store, [])).resolves.toEqual([])
    expect(store.calls).toEqual([])
  })
})

describe('AttachmentStore.saveFiles', () => {
  it('validates the complete batch before committing in input order', async () => {
    const store = new RecordingFileStore(new Context())

    const refs = await store.saveFiles([file(1), file(2)])

    expect(store.calls).toEqual(['validate:1', 'validate:2', 'save:1', 'save:2'])
    expect(refs.map(ref => ref.name)).toEqual(['1.pdf', '2.pdf'])
  })

  it('rejects count, per-file bytes, and aggregate bytes before validation or writes', async () => {
    const store = new RecordingFileStore(new Context())

    await expect(store.saveFiles([file(1), file(2), file(3)]))
      .rejects.toMatchObject({ code: 'TOO_MANY_FILES' })
    await expect(store.saveFiles([file(1, 5)]))
      .rejects.toMatchObject({ code: 'FILE_TOO_LARGE' })
    await expect(store.saveFiles([file(1, 3), file(2, 3)]))
      .rejects.toMatchObject({ code: 'FILES_TOO_LARGE' })
    expect(store.calls).toEqual([])
  })

  it('admits a batch that exactly meets every limit', async () => {
    const store = new RecordingFileStore(new Context())

    const refs = await store.saveFiles([file(1, 4), file(2, 1)])

    expect(refs.map(ref => ref.bytes)).toEqual([4, 1])
  })

  it('refuses every generic-file operation when the provider supports images only', async () => {
    const store = new ImageOnlyStore(new Context())
    const unsupported = { code: 'FILE_ATTACHMENTS_UNSUPPORTED' }

    expect(store.fileLimits).toBeUndefined()
    await expect(store.validateFile(file(1))).rejects.toMatchObject(unsupported)
    await expect(store.saveFile(file(1))).rejects.toMatchObject(unsupported)
    await expect(store.saveFiles([file(1)])).rejects.toMatchObject(unsupported)
    await expect(store.readFile({
      attachmentId: AttachmentId(`sha256:${'0'.repeat(64)}`), mediaType: 'application/pdf', bytes: 1,
    })).rejects.toMatchObject(unsupported)
  })
})

describe('isFileAdmissionError', () => {
  it('separates caller-correctable file admission failures from storage faults', () => {
    expect(isFileAdmissionError(new AttachmentError('too many', 'TOO_MANY_FILES'))).toBe(true)
    expect(isFileAdmissionError(new AttachmentError('aggregate', 'FILES_TOO_LARGE'))).toBe(true)
    expect(isFileAdmissionError(new AttachmentError('bad base64', 'INVALID_FILE_BASE64'))).toBe(true)
    expect(isFileAdmissionError(Object.assign(new Error('foreign policy error'), { code: 'FILE_TOO_LARGE' }))).toBe(true)
    expect(isFileAdmissionError(new AttachmentError('unsupported', 'FILE_ATTACHMENTS_UNSUPPORTED'))).toBe(false)
    expect(isFileAdmissionError(new AttachmentError('corrupt object', 'ATTACHMENT_CORRUPT'))).toBe(false)
    expect(isFileAdmissionError(new Error('unknown failure'))).toBe(false)
  })
})
