import { Context } from '@deepseek-ai/cordis'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import LocalAttachmentStore, {
  DEFAULT_MAX_FILE_BYTES,
  DEFAULT_MAX_FILES_PER_MESSAGE,
  DEFAULT_MAX_MESSAGE_FILE_BYTES,
} from '../src/index.ts'

const homes: string[] = []

async function service(config: Record<string, unknown> = {}): Promise<LocalAttachmentStore> {
  const dshHome = await mkdtemp(join(tmpdir(), 'dsh-attachment-file-'))
  homes.push(dshHome)
  return new LocalAttachmentStore(new Context(), { dshHome, ...config })
}

function bytes(...values: number[]): Uint8Array {
  return Uint8Array.from(values)
}

function objectOf(store: LocalAttachmentStore, attachmentId: string): string {
  const sha256 = attachmentId.slice('sha256:'.length)
  return join(store.root, 'objects', sha256.slice(0, 2), sha256)
}

afterEach(async () => {
  await Promise.all(homes.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

describe('local generic-file storage', () => {
  it('resolves every omitted generic-file limit explicitly', async () => {
    const store = await service()

    expect(DEFAULT_MAX_FILE_BYTES).toBe(1024 * 1024 * 1024)
    expect(DEFAULT_MAX_FILES_PER_MESSAGE).toBe(20)
    expect(DEFAULT_MAX_MESSAGE_FILE_BYTES).toBe(1024 * 1024 * 1024)
    expect(store.fileLimits).toEqual({
      maxFileBytes: DEFAULT_MAX_FILE_BYTES,
      maxFilesPerMessage: DEFAULT_MAX_FILES_PER_MESSAGE,
      maxMessageFileBytes: DEFAULT_MAX_MESSAGE_FILE_BYTES,
    })
  })

  it('preserves exact bytes of an opaque payload no image decoder would accept', async () => {
    const store = await service()
    const data = bytes(0, 255, 1, 0, 0, 127, 200)

    const ref = await store.saveFile({ data, mediaType: 'application/x-tar', name: 'archive.tar' })

    expect(ref).toEqual({
      attachmentId: `sha256:${createHash('sha256').update(data).digest('hex')}`,
      mediaType: 'application/x-tar',
      bytes: 7,
      name: 'archive.tar',
    })
    await expect(store.readFile(ref)).resolves.toEqual({ ref, data })
    expect(new Uint8Array(await readFile(objectOf(store, String(ref.attachmentId))))).toEqual(data)
  })

  it('publishes one private object and deduplicates equal bytes across differing metadata', async () => {
    const store = await service()
    const data = bytes(9, 8, 7)

    const first = await store.saveFile({ data, mediaType: 'application/pdf', name: 'report.pdf' })
    const second = await store.saveFile({ data, mediaType: 'text/csv', name: 'rows.csv' })

    expect(second.attachmentId).toBe(first.attachmentId)
    expect(second.mediaType).toBe('text/csv')
    if (process.platform !== 'win32') {
      expect((await stat(objectOf(store, String(first.attachmentId)))).mode & 0o777).toBe(0o600)
    }
  })

  it('normalizes unknown, malformed, and parameterized media types', async () => {
    const store = await service()

    const declared = await Promise.all([
      { data: bytes(1) },
      { data: bytes(2), mediaType: 'not a media type' },
      { data: bytes(3), mediaType: 'TEXT/Plain; charset=utf-8' },
      { data: bytes(4), mediaType: 'application/vnd.custom+json' },
    ].map(input => store.saveFile(input)))

    expect(declared.map(ref => ref.mediaType)).toEqual([
      'application/octet-stream',
      'application/octet-stream',
      'text/plain',
      'application/vnd.custom+json',
    ])
  })

  it('strips local path information and control characters from the display name', async () => {
    const store = await service()

    const names = await Promise.all([
      'C:\\Users\\me\\secret\\budget.xlsx',
      '/home/me/private/notes.txt',
      '../../etc/passwd',
      'plain\u0000name.bin',
    ].map((name, index) => store.saveFile({ data: bytes(index + 10), name })))

    expect(names.map(ref => ref.name)).toEqual(['budget.xlsx', 'notes.txt', 'passwd', 'plainname.bin'])
    const unnamed = await store.saveFile({ data: bytes(99), name: '/tmp/..' })
    expect(unnamed).not.toHaveProperty('name')
  })

  it('commits a batch in input order and enforces limits before any write', async () => {
    const store = await service({ maxFileBytes: 4, maxFilesPerMessage: 2, maxMessageFileBytes: 5 })

    const refs = await store.saveFiles([
      { data: bytes(1), name: 'a.bin' },
      { data: bytes(2, 2), name: 'b.bin' },
    ])
    expect(refs.map(ref => [ref.name, ref.bytes])).toEqual([['a.bin', 1], ['b.bin', 2]])

    const rejected = await service({ maxFileBytes: 4, maxFilesPerMessage: 2, maxMessageFileBytes: 5 })
    await expect(rejected.saveFiles([{ data: bytes(1) }, { data: bytes(2) }, { data: bytes(3) }]))
      .rejects.toMatchObject({ code: 'TOO_MANY_FILES' })
    await expect(rejected.saveFiles([{ data: bytes(1, 1, 1, 1, 1) }]))
      .rejects.toMatchObject({ code: 'FILE_TOO_LARGE' })
    await expect(rejected.saveFiles([{ data: bytes(1, 1, 1) }, { data: bytes(2, 2, 2) }]))
      .rejects.toMatchObject({ code: 'FILES_TOO_LARGE' })
    expect(existsSync(rejected.root)).toBe(false)
  })

  it('validates without persisting anything', async () => {
    const store = await service({ maxFileBytes: 2 })

    await expect(store.validateFile({ data: bytes(1, 2) })).resolves.toBeUndefined()
    await expect(store.validateFile({ data: bytes(1, 2, 3) }))
      .rejects.toMatchObject({ code: 'FILE_TOO_LARGE' })
    await expect(store.validateFiles([{ data: bytes(1) }, { data: bytes(2) }])).resolves.toBeUndefined()
    expect(existsSync(store.root)).toBe(false)
  })

  it('keeps admitted history readable after deployment limits become stricter', async () => {
    const dshHome = await mkdtemp(join(tmpdir(), 'dsh-attachment-file-strict-'))
    homes.push(dshHome)
    const permissive = new LocalAttachmentStore(new Context(), { dshHome })
    const ref = await permissive.saveFile({ data: bytes(4, 5, 6, 7) })

    const strict = new LocalAttachmentStore(new Context(), { dshHome, maxFileBytes: 1 })

    await expect(strict.saveFile({ data: bytes(4, 5, 6, 7) })).rejects.toMatchObject({ code: 'FILE_TOO_LARGE' })
    await expect(strict.saveFiles([{ data: bytes(4, 5, 6, 7) }])).rejects.toMatchObject({ code: 'FILE_TOO_LARGE' })
    await expect(strict.readFile(ref)).resolves.toEqual({ ref, data: bytes(4, 5, 6, 7) })
  })

  it('fails closed on a missing object, tampered bytes, wrong length, or invalid reference', async () => {
    const store = await service()
    const data = bytes(3, 1, 4, 1, 5)
    const ref = await store.saveFile({ data, name: 'digits.bin' })

    await expect(store.readFile({ ...ref, bytes: ref.bytes + 1 }))
      .rejects.toMatchObject({ code: 'ATTACHMENT_CORRUPT' })
    await expect(store.readFile({ ...ref, attachmentId: 'not-a-digest' as never }))
      .rejects.toMatchObject({ code: 'INVALID_ATTACHMENT_REF' })
    for (const malformedBytes of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      await expect(store.readFile({ ...ref, bytes: malformedBytes }))
        .rejects.toMatchObject({ code: 'INVALID_ATTACHMENT_REF' })
    }

    const missing = await service()
    await expect(missing.readFile(ref)).rejects.toMatchObject({ code: 'ATTACHMENT_NOT_FOUND' })

    await writeFile(objectOf(store, String(ref.attachmentId)), bytes(9, 9, 9, 9, 9))
    await expect(store.readFile(ref)).rejects.toMatchObject({ code: 'ATTACHMENT_CORRUPT' })

    const unreadable = await service()
    await mkdir(objectOf(unreadable, String(ref.attachmentId)), { recursive: true })
    await expect(unreadable.readFile(ref)).rejects.toMatchObject({ code: 'ATTACHMENT_READ_FAILED' })
  })

  it('streams exact limits, rejects overflow and size mismatch, and leaves no staging files', async () => {
    const store = await service({ maxFileBytes: 4, maxMessageFileBytes: 4 })
    const source = async function* (...chunks: Uint8Array[]): AsyncGenerator<Uint8Array> {
      yield* chunks
    }

    const upload = await store.saveFileStream('session-a', {
      data: source(bytes(1, 2), bytes(3, 4)), expectedBytes: 4, name: 'exact.bin',
    })
    expect(upload.attachment.bytes).toBe(4)
    const readChunks: Uint8Array[] = []
    for await (const chunk of (await store.readFileStream(upload.attachment)).data) readChunks.push(chunk)
    expect(readChunks).toEqual([bytes(1, 2, 3, 4)])

    await expect(store.saveFileStream('session-a', {
      data: source(bytes(1, 2, 3), bytes(4, 5)), expectedBytes: 5,
    })).rejects.toMatchObject({ code: 'FILE_TOO_LARGE' })
    await expect(store.saveFileStream('session-a', {
      data: source(bytes(1, 2, 3)), expectedBytes: 4,
    })).rejects.toMatchObject({ code: 'FILE_SIZE_MISMATCH' })
    await expect(readdir(join(store.root, 'tmp'))).resolves.toEqual([])
  })

  it('deduplicates streamed bytes and authenticates receipts only for their exact session and metadata', async () => {
    const store = await service({ maxFileBytes: 8, maxMessageFileBytes: 8 })
    const stream = async function* (): AsyncGenerator<Uint8Array> { yield bytes(7, 8, 9) }
    const first = await store.saveFileStream('session-a', {
      data: stream(), expectedBytes: 3, mediaType: 'application/pdf', name: 'one.pdf',
    })
    const second = await store.saveFileStream('session-a', {
      data: stream(), expectedBytes: 3, mediaType: 'text/plain', name: 'two.txt',
    })

    expect(second.attachment.attachmentId).toBe(first.attachment.attachmentId)
    await expect(store.authorizeUploadedFile('session-a', first)).resolves.toEqual(first.attachment)
    await expect(store.authorizeUploadedFile('session-b', first))
      .rejects.toMatchObject({ code: 'INVALID_ATTACHMENT_REF' })
    await expect(store.authorizeUploadedFile('session-a', {
      ...first, attachment: { ...first.attachment, name: 'forged.pdf' },
    })).rejects.toMatchObject({ code: 'INVALID_ATTACHMENT_REF' })
  })

  it('preserves the caller cancellation reason on read', async () => {
    const store = await service()
    const ref = await store.saveFile({ data: bytes(1, 2, 3) })
    const controller = new AbortController()

    await expect(store.readFile(ref, controller.signal)).resolves.toEqual({ ref, data: bytes(1, 2, 3) })

    const cancellation = new Error('file read cancelled')
    controller.abort(cancellation)
    await expect(store.readFile(ref, controller.signal)).rejects.toBe(cancellation)
  })
})
