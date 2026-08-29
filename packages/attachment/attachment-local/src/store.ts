/** Content-addressed, owner-private local attachment storage. */

import { Buffer } from 'node:buffer'
import { createHash, randomUUID } from 'node:crypto'
import { constants, createReadStream } from 'node:fs'
import { chmod, link, mkdir, open, readFile, unlink } from 'node:fs/promises'
import { dirname, join, parse, resolve } from 'node:path'
import {
  AttachmentError,
  AttachmentId,
} from '@deepseek-ai/dsh-attachment'
import type {
  FileAttachmentLimits,
  FileAttachmentRef,
  ImageAttachmentLimits,
  ImageAttachmentRef,
  SaveFileAttachment,
  SaveFileAttachmentStream,
  SaveImageAttachment,
  StoredFileAttachment,
  StoredFileAttachmentStream,
  StoredImageAttachment,
} from '@deepseek-ai/dsh-attachment'
import { normalizeImage } from './normalization.ts'
import type { NormalizationPolicy } from './normalization.ts'
import { detectImage, probeImage } from './image.ts'
import type { DetectedImage } from './image.ts'

const ID_PATTERN = /^sha256:([a-f0-9]{64})$/
const durableHomes = new Set<string>()

function digest(data: Uint8Array): string {
  return createHash('sha256').update(data).digest('hex')
}

function displayName(value: string | undefined): string | undefined {
  if (value === undefined) return undefined
  // Strip both separator styles by hand: a POSIX host treats `\` as an
  // ordinary character, so path.basename would keep a Windows client's full
  // local path and leak it into the reference and the session log.
  const leaf = value.slice(Math.max(value.lastIndexOf('/'), value.lastIndexOf('\\')) + 1)
  const clean = leaf.replace(/[\u0000-\u001f\u007f-\u009f]/g, '').trim().slice(0, 255)
  return clean === '' || clean === '.' || clean === '..' ? undefined : clean
}

const MEDIA_TYPE_PATTERN = /^[!#$%&'*+.^_`|~0-9a-z-]+\/[!#$%&'*+.^_`|~0-9a-z-]+$/
const FILE_MEDIA_TYPE_FALLBACK = 'application/octet-stream'

/** Normalize an untrusted declared media type without inspecting file bytes. */
function fileMediaType(value: string | undefined): string {
  const essence = value?.split(';', 1)[0]?.trim().toLowerCase()
  return essence !== undefined && MEDIA_TYPE_PATTERN.test(essence)
    ? essence
    : FILE_MEDIA_TYPE_FALLBACK
}

function objectPath(root: string, sha256: string): string {
  return join(root, 'objects', sha256.slice(0, 2), sha256)
}

type StoredObjectRef = Pick<FileAttachmentRef, 'attachmentId' | 'bytes'>

function ensureReference(ref: StoredObjectRef): string {
  const match = ID_PATTERN.exec(String(ref.attachmentId))
  if (match?.[1] === undefined || !Number.isSafeInteger(ref.bytes) || ref.bytes < 0) {
    throw new AttachmentError('Attachment reference is invalid.', 'INVALID_ATTACHMENT_REF')
  }
  return match[1]
}

async function inspectMetadata(
  data: Uint8Array,
  declaredMediaType: ImageAttachmentRef['mediaType'],
  limits: ImageAttachmentLimits,
): Promise<DetectedImage> {
  if (data.byteLength === 0) throw new AttachmentError('Image is empty.', 'INVALID_IMAGE')
  const detected = await detectImage(data, { maxPixels: limits.maxImagePixels, maxDimension: limits.maxImageDimension })
  if (detected.mediaType !== declaredMediaType) throw new AttachmentError('Declared image type does not match its bytes.', 'IMAGE_TYPE_MISMATCH')
  return detected
}

/**
 * Run the full admission policy for one image without touching storage,
 * including normalization: a batch whose members all validate cannot later
 * be refused by the normalized image byte cap during publication.
 * @param input - encoded bytes and declared metadata.
 * @param limits - resolved source admission policy.
 * @param policy - resolved normalization policy.
 * @returns completion after the raster has been decoded and its normalized version proven to fit.
 */
export async function validateImageFile(
  input: SaveImageAttachment,
  limits: ImageAttachmentLimits,
  policy: NormalizationPolicy,
): Promise<void> {
  await prepareImageFile(input, limits, policy)
}

/** Fully prepared normalized object, verified before any batch member is persisted. */
export interface PreparedImageFile {
  /** Deterministic normalized bytes whose digest is {@link ref.attachmentId}. */
  data: Uint8Array
  /** Durable reference describing {@link data}. */
  ref: ImageAttachmentRef
}

/**
 * Decode, normalize, and verify one submitted image without touching storage.
 * @param input - submitted encoded bytes and declared media type.
 * @param limits - source admission policy.
 * @param policy - independent normalization policy.
 * @returns immutable reference facts beside bytes ready for atomic publication.
 */
export async function prepareImageFile(
  input: SaveImageAttachment,
  limits: ImageAttachmentLimits,
  policy: NormalizationPolicy,
): Promise<PreparedImageFile> {
  if (input.data.byteLength > limits.maxImageBytes) {
    throw new AttachmentError('Image exceeds the configured byte limit.', 'IMAGE_TOO_LARGE')
  }
  const detected = await inspectMetadata(input.data, input.mediaType, limits)
  const normalized = await normalizeImage(input.data, detected, policy)
  const sha256 = digest(normalized.data)
  const name = displayName(input.name)
  const downscaled = detected.width !== normalized.width || detected.height !== normalized.height
  return {
    data: normalized.data,
    ref: {
      attachmentId: AttachmentId(`sha256:${sha256}`),
      mediaType: normalized.mediaType,
      width: normalized.width,
      height: normalized.height,
      bytes: normalized.data.byteLength,
      ...(name !== undefined ? { name } : {}),
      ...downscaled ? { originalDimensions: { width: detected.width, height: detected.height } } : {},
    },
  }
}

/**
 * Make a directory's entries durable (fsync on a read-only directory handle).
 * A synced file alone does not survive a crash when its directory entry never
 * reached storage, so the publication directory is synced before a durable
 * reference is reported.
 */
async function syncDirectory(path: string): Promise<void> {
  /* v8 ignore next -- Windows cannot open directory handles; NTFS metadata journaling owns entry durability there. */
  if (process.platform === 'win32') return
  /* v8 ignore start -- Windows cannot exercise directory fsync; POSIX behavior tests enforce this peer. */
  const handle = await open(path, constants.O_RDONLY)
  try {
    await handle.sync()
  } finally {
    await handle.close()
  }
  /* v8 ignore stop */
}

/**
 * Create one private directory tree and persist every ancestor entry up to a
 * caller-vouched durable boundary. The walk deliberately ignores what mkdir
 * reports as newly created: a concurrent first save can create a level this
 * process then merely observes, so "already existed" is not "already durable"
 * — the entry may still be unsynced in the creator, and a crash would drop a
 * directory the session checkpoint already references. Re-syncing a durable
 * entry is harmless; skipping an unsynced one is not.
 * @param path - absolute directory to create.
 * @param boundary - absolute ancestor the caller vouches is already durable.
 */
async function ensureDurableDirectory(path: string, boundary: string): Promise<void> {
  const target = resolve(path)
  const stop = resolve(boundary)
  await mkdir(target, { recursive: true, mode: 0o700 })
  await chmod(target, 0o700)
  let level = target
  while (level !== stop) {
    const parent = dirname(level)
    await syncDirectory(parent)
    /* v8 ignore next -- filesystem-root guard: callers pass a boundary that is an ancestor of path, so the walk reaches it first. */
    if (parent === level) return
    level = parent
  }
}

/**
 * Establish this process's proof that one DSH_HOME entry and every ancestor
 * below the filesystem root are durable. Mere existence is insufficient: a
 * concurrent process may have created the directory but not synced its parent.
 */
async function ensureDurableHome(path: string): Promise<string> {
  const home = resolve(path)
  if (!durableHomes.has(home)) {
    await ensureDurableDirectory(home, parse(home).root)
    durableHomes.add(home)
  }
  return home
}

/** Publish exact verified bytes through the private atomic object path. */
async function commitPreparedObject<T extends StoredObjectRef>(
  root: string,
  data: Uint8Array,
  ref: T,
): Promise<T> {
  const sha256 = ensureReference(ref)
  if (digest(data) !== sha256 || data.byteLength !== ref.bytes) {
    throw new AttachmentError('Prepared attachment bytes do not match their reference.', 'ATTACHMENT_CORRUPT')
  }
  const bucket = join(root, 'objects', sha256.slice(0, 2))
  const staging = join(root, 'tmp')
  // Establish DSH_HOME itself against the filesystem root once per process.
  // Every process performs that proof independently, so observing a directory
  // another process created can never be mistaken for durable publication.
  const boundary = await ensureDurableHome(dirname(dirname(resolve(root))))
  await ensureDurableDirectory(bucket, boundary)
  await ensureDurableDirectory(staging, boundary)
  const temporary = join(staging, randomUUID())
  const target = objectPath(root, sha256)
  let handle
  try {
    handle = await open(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600)
    await handle.writeFile(data)
    await handle.sync()
    await handle.close()
    handle = undefined
    try {
      await link(temporary, target)
    } catch (error) {
      /* v8 ignore next -- Private same-filesystem directories make EEXIST the only recoverable link race. */
      if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error
      const existing = new Uint8Array(await readFile(target))
      if (digest(existing) !== sha256 || existing.byteLength !== ref.bytes) {
        throw new AttachmentError('Stored attachment failed integrity verification.', 'ATTACHMENT_CORRUPT')
      }
    }
    // Persist the target entry and close a concurrent bucket-creation window
    // before the reference can reach a session checkpoint. The dedup path
    // repeats both syncs because it may observe another writer's link before
    // that writer reaches its own durability boundary.
    await syncDirectory(bucket)
    await syncDirectory(join(root, 'objects'))
    await unlink(temporary)
  } catch (error) {
    /* v8 ignore next -- A descriptor can remain open only when the underlying write/sync/close operation fails. */
    if (handle !== undefined) await handle.close().catch(
      /* v8 ignore next -- Close failure is superseded by the storage operation that entered cleanup. */
      () => {},
    )
    await unlink(temporary).catch(
      /* v8 ignore next -- The callback requires a second independent staging-unlink failure. */
      (cleanupError: unknown) => {
        /* v8 ignore next -- Cleanup is best-effort only for a staging file already removed by a failed operation. */
        if (!(cleanupError instanceof Error && 'code' in cleanupError && cleanupError.code === 'ENOENT')) throw cleanupError
      },
    )
    if (error instanceof AttachmentError) throw error
    throw new AttachmentError('Unable to persist attachment.', 'ATTACHMENT_WRITE_FAILED', { cause: error })
  }
  return ref
}

/**
 * Publish one already verified normalized image below a versioned attachment root.
 * @param root - absolute `DSH_HOME/attachments/v1` root.
 * @param prepared - deterministic normalized bytes and reference.
 * @returns durable content-addressed normalized image reference.
 */
export function commitPreparedImageFile(
  root: string,
  prepared: PreparedImageFile,
): Promise<ImageAttachmentRef> {
  return commitPreparedObject(root, prepared.data, prepared.ref)
}

/**
 * Decode and normalize one image once, then publish the prepared object.
 * @param root - absolute `DSH_HOME/attachments/v1` root.
 * @param input - submitted encoded bytes and declared media type.
 * @param limits - resolved source admission policy.
 * @param policy - resolved normalization policy.
 * @returns durable content-addressed normalized image reference.
 */
export async function saveImageFile(
  root: string,
  input: SaveImageAttachment,
  limits: ImageAttachmentLimits,
  policy: NormalizationPolicy,
): Promise<ImageAttachmentRef> {
  return commitPreparedImageFile(root, await prepareImageFile(input, limits, policy))
}

/** Fully prepared opaque object, copied and verified before any batch write. */
export interface PreparedFileAttachment {
  /** Exact immutable snapshot whose digest is {@link ref.attachmentId}. */
  data: Uint8Array
  /** Durable reference describing {@link data}. */
  ref: FileAttachmentRef
}

/**
 * Validate and snapshot one opaque file without interpreting or persisting it.
 * @param input - exact bytes and untrusted display metadata.
 * @param limits - resolved generic-file admission policy.
 * @returns copied bytes and canonical reference facts ready for atomic publication.
 */
export function prepareFileAttachment(
  input: SaveFileAttachment,
  limits: FileAttachmentLimits,
): PreparedFileAttachment {
  if (input.data.byteLength > limits.maxFileBytes) {
    throw new AttachmentError('File exceeds the configured byte limit.', 'FILE_TOO_LARGE')
  }
  const data = new Uint8Array(input.data)
  const sha256 = digest(data)
  const name = displayName(input.name)
  return {
    data,
    ref: {
      attachmentId: AttachmentId(`sha256:${sha256}`),
      mediaType: fileMediaType(input.mediaType),
      bytes: data.byteLength,
      ...(name === undefined ? {} : { name }),
    },
  }
}

/**
 * Publish one prepared opaque file without decoding, executing, or extracting it.
 * @param root - absolute `DSH_HOME/attachments/v1` root.
 * @param prepared - copied exact bytes and canonical reference.
 * @returns durable content-addressed file reference.
 */
export function commitPreparedFileAttachment(
  root: string,
  prepared: PreparedFileAttachment,
): Promise<FileAttachmentRef> {
  return commitPreparedObject(root, prepared.data, prepared.ref)
}

/**
 * Validate, snapshot, and atomically publish one opaque file.
 * @param root - absolute `DSH_HOME/attachments/v1` root.
 * @param input - exact bytes and untrusted display metadata.
 * @param limits - resolved generic-file admission policy.
 * @returns durable content-addressed file reference.
 */
export function saveFileAttachment(
  root: string,
  input: SaveFileAttachment,
  limits: FileAttachmentLimits,
): Promise<FileAttachmentRef> {
  return commitPreparedFileAttachment(root, prepareFileAttachment(input, limits))
}

/** Private staged stream with final content-addressed reference facts. */
interface StagedFileAttachment {
  path: string
  ref: FileAttachmentRef
}

/** Remove a staging file without masking the operation failure that triggered cleanup. */
async function removeStaging(path: string): Promise<void> {
  await unlink(path).catch((error: unknown) => {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
  })
}

/** Incrementally verify one object without materializing it in memory. */
async function verifyObjectStream(path: string, ref: StoredObjectRef, signal?: AbortSignal): Promise<void> {
  const expected = ensureReference(ref)
  const hash = createHash('sha256')
  let bytes = 0
  try {
    for await (const value of createReadStream(path, { signal })) {
      signal?.throwIfAborted()
      const chunk = value as Buffer
      bytes += chunk.byteLength
      hash.update(chunk)
    }
  } catch (error) {
    signal?.throwIfAborted()
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      throw new AttachmentError('Attachment object is missing.', 'ATTACHMENT_NOT_FOUND')
    }
    throw new AttachmentError('Unable to read attachment.', 'ATTACHMENT_READ_FAILED', { cause: error })
  }
  if (bytes !== ref.bytes || hash.digest('hex') !== expected) {
    throw new AttachmentError('Stored attachment failed integrity verification.', 'ATTACHMENT_CORRUPT')
  }
}

/** Await one producer chunk while allowing cancellation to release staging immediately. */
async function nextChunk(
  iterator: AsyncIterator<Uint8Array>,
  signal?: AbortSignal,
): Promise<IteratorResult<Uint8Array>> {
  signal?.throwIfAborted()
  if (signal === undefined) return iterator.next()
  return new Promise((resolve, reject) => {
    const abort = (): void => {
      reject(signal.reason instanceof Error ? signal.reason : new Error('File stream was aborted.'))
    }
    signal.addEventListener('abort', abort, { once: true })
    void iterator.next().then(resolve, reject).finally(() => {
      signal.removeEventListener('abort', abort)
    })
  })
}

/** Consume one source with backpressure into a private staging file. */
async function stageFileStream(
  root: string,
  input: SaveFileAttachmentStream,
  limits: FileAttachmentLimits,
  aggregate: { bytes: number },
  signal?: AbortSignal,
): Promise<StagedFileAttachment> {
  signal?.throwIfAborted()
  if (input.expectedBytes !== undefined) {
    if (!Number.isSafeInteger(input.expectedBytes) || input.expectedBytes < 0) {
      throw new AttachmentError('Expected file byte length is invalid.', 'FILE_SIZE_MISMATCH')
    }
    if (input.expectedBytes > limits.maxFileBytes) {
      throw new AttachmentError('File exceeds the configured byte limit.', 'FILE_TOO_LARGE')
    }
    const expectedAggregate = aggregate.bytes + input.expectedBytes
    if (!Number.isSafeInteger(expectedAggregate) || expectedAggregate > limits.maxMessageFileBytes) {
      throw new AttachmentError('File batch exceeds the configured aggregate file-byte limit.', 'FILES_TOO_LARGE')
    }
  }
  const staging = join(root, 'tmp')
  const boundary = await ensureDurableHome(dirname(dirname(resolve(root))))
  await ensureDurableDirectory(staging, boundary)
  const path = join(staging, randomUUID())
  const hash = createHash('sha256')
  let bytes = 0
  let handle
  try {
    handle = await open(path, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600)
    const iterator = input.data[Symbol.asyncIterator]()
    for (;;) {
      const result = await nextChunk(iterator, signal)
      if (result.done) break
      const chunk = result.value
      const nextFileBytes = bytes + chunk.byteLength
      if (!Number.isSafeInteger(nextFileBytes) || nextFileBytes > limits.maxFileBytes) {
        throw new AttachmentError('File exceeds the configured byte limit.', 'FILE_TOO_LARGE')
      }
      const nextAggregateBytes = aggregate.bytes + chunk.byteLength
      if (!Number.isSafeInteger(nextAggregateBytes) || nextAggregateBytes > limits.maxMessageFileBytes) {
        throw new AttachmentError('File batch exceeds the configured aggregate file-byte limit.', 'FILES_TOO_LARGE')
      }
      await handle.writeFile(chunk)
      bytes = nextFileBytes
      aggregate.bytes = nextAggregateBytes
      hash.update(chunk)
    }
    if (input.expectedBytes !== undefined
      && (!Number.isSafeInteger(input.expectedBytes) || input.expectedBytes < 0 || bytes !== input.expectedBytes)) {
      throw new AttachmentError('File byte length does not match the expected size.', 'FILE_SIZE_MISMATCH')
    }
    signal?.throwIfAborted()
    await handle.sync()
    await handle.close()
    handle = undefined
    const name = displayName(input.name)
    return {
      path,
      ref: {
        attachmentId: AttachmentId(`sha256:${hash.digest('hex')}`),
        mediaType: fileMediaType(input.mediaType),
        bytes,
        ...(name === undefined ? {} : { name }),
      },
    }
  } catch (error) {
    if (handle !== undefined) await handle.close().catch(() => {})
    await removeStaging(path)
    signal?.throwIfAborted()
    if (error instanceof AttachmentError) throw error
    throw new AttachmentError('Unable to stage attachment.', 'ATTACHMENT_WRITE_FAILED', { cause: error })
  }
}

/** Publish one staged stream object through the content-addressed object namespace. */
async function commitStagedFile(
  root: string,
  staged: StagedFileAttachment,
  signal?: AbortSignal,
): Promise<FileAttachmentRef> {
  signal?.throwIfAborted()
  const sha256 = ensureReference(staged.ref)
  const bucket = join(root, 'objects', sha256.slice(0, 2))
  const boundary = await ensureDurableHome(dirname(dirname(resolve(root))))
  await ensureDurableDirectory(bucket, boundary)
  const target = objectPath(root, sha256)
  try {
    try {
      await link(staged.path, target)
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error
      await verifyObjectStream(target, staged.ref, signal)
    }
    signal?.throwIfAborted()
    await syncDirectory(bucket)
    await syncDirectory(join(root, 'objects'))
    await removeStaging(staged.path)
    return staged.ref
  } catch (error) {
    await removeStaging(staged.path)
    signal?.throwIfAborted()
    if (error instanceof AttachmentError) throw error
    throw new AttachmentError('Unable to persist attachment.', 'ATTACHMENT_WRITE_FAILED', { cause: error })
  }
}

/**
 * Stage and publish one opaque byte stream with bounded memory.
 * @param root - absolute versioned attachment root.
 * @param input - ordered byte source and display metadata.
 * @param limits - resolved generic-file limits.
 * @param signal - optional cancellation.
 * @returns immutable content-addressed file reference.
 */
export async function saveFileAttachmentStream(
  root: string,
  input: SaveFileAttachmentStream,
  limits: FileAttachmentLimits,
  signal?: AbortSignal,
): Promise<FileAttachmentRef> {
  const staged = await stageFileStream(root, input, limits, { bytes: 0 }, signal)
  return commitStagedFile(root, staged, signal)
}

/**
 * Stage every stream before publishing any member and clean all remaining staging on failure.
 * @param root - absolute versioned attachment root.
 * @param inputs - ordered streaming files.
 * @param limits - resolved generic-file limits.
 * @param signal - optional cancellation.
 * @returns references in input order after complete publication.
 */
export async function saveFileAttachmentStreams(
  root: string,
  inputs: readonly SaveFileAttachmentStream[],
  limits: FileAttachmentLimits,
  signal?: AbortSignal,
): Promise<readonly FileAttachmentRef[]> {
  if (inputs.length > limits.maxFilesPerMessage) {
    throw new AttachmentError('File batch exceeds the configured file-count limit.', 'TOO_MANY_FILES')
  }
  const aggregate = { bytes: 0 }
  const staged: StagedFileAttachment[] = []
  try {
    for (const input of inputs) staged.push(await stageFileStream(root, input, limits, aggregate, signal))
  } catch (error) {
    await Promise.all(staged.map(file => removeStaging(file.path)))
    throw error
  }
  const refs: FileAttachmentRef[] = []
  try {
    for (const file of staged) refs.push(await commitStagedFile(root, file, signal))
    return refs
  } catch (error) {
    await Promise.all(staged.slice(refs.length).map(file => removeStaging(file.path)))
    throw error
  }
}

/**
 * Open a single-use incremental stream that rejects on size or digest mismatch.
 * @param root - absolute versioned attachment root.
 * @param ref - durable file reference.
 * @param signal - optional cancellation observed while iterating.
 * @returns verified stream descriptor without an exposed filesystem path.
 */
export function readFileAttachmentStream(
  root: string,
  ref: FileAttachmentRef,
  signal?: AbortSignal,
): StoredFileAttachmentStream {
  const sha256 = ensureReference(ref)
  signal?.throwIfAborted()
  const data = (async function* (): AsyncGenerator<Uint8Array> {
    const hash = createHash('sha256')
    let bytes = 0
    try {
      for await (const value of createReadStream(objectPath(root, sha256), { signal })) {
        signal?.throwIfAborted()
        const chunk = value as Buffer
        bytes += chunk.byteLength
        hash.update(chunk)
        yield new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength)
      }
    } catch (error) {
      signal?.throwIfAborted()
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        throw new AttachmentError('Attachment object is missing.', 'ATTACHMENT_NOT_FOUND')
      }
      throw new AttachmentError('Unable to read attachment.', 'ATTACHMENT_READ_FAILED', { cause: error })
    }
    if (bytes !== ref.bytes || hash.digest('hex') !== sha256) {
      throw new AttachmentError('Stored attachment failed integrity verification.', 'ATTACHMENT_CORRUPT')
    }
  })()
  return { ref, data }
}

/** Read exact object bytes after validating the opaque id, length, and digest. */
async function readStoredObject(
  root: string,
  ref: StoredObjectRef,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  signal?.throwIfAborted()
  const sha256 = ensureReference(ref)
  let data: Uint8Array
  try {
    data = new Uint8Array(await readFile(objectPath(root, sha256), { signal }))
  } catch (error) {
    signal?.throwIfAborted()
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      throw new AttachmentError('Attachment object is missing.', 'ATTACHMENT_NOT_FOUND')
    }
    throw new AttachmentError('Unable to read attachment.', 'ATTACHMENT_READ_FAILED', { cause: error })
  }
  signal?.throwIfAborted()
  if (data.byteLength !== ref.bytes || digest(data) !== sha256) {
    throw new AttachmentError('Stored attachment failed integrity verification.', 'ATTACHMENT_CORRUPT')
  }
  return data
}

/**
 * Read one opaque file and verify its exact byte length and content digest.
 * @param root - absolute `DSH_HOME/attachments/v1` root.
 * @param ref - durable content-addressed file reference.
 * @param signal - optional cancellation for filesystem and verification work.
 * @returns exact verified bytes and the supplied reference.
 */
export async function readFileAttachment(
  root: string,
  ref: FileAttachmentRef,
  signal?: AbortSignal,
): Promise<StoredFileAttachment> {
  return { ref, data: await readStoredObject(root, ref, signal) }
}

/**
 * Read and verify one content-addressed image.
 * @param root - absolute `DSH_HOME/attachments/v1` root.
 * @param ref - reference recorded in the session log.
 * @param signal - optional cancellation for filesystem and verification work.
 * @returns verified bytes and reference.
 * @throws the signal reason when aborted, or an AttachmentError when verification fails.
 */
export async function readImageFile(
  root: string,
  ref: ImageAttachmentRef,
  signal?: AbortSignal,
): Promise<StoredImageAttachment> {
  const data = await readStoredObject(root, ref, signal)
  // The digest proves these are the exact bytes admission fully decoded, so
  // the read path only re-derives the header fields (no raster decode, no
  // per-request pixel amplification on history replay).
  const metadata = await probeImage(data)
  signal?.throwIfAborted()
  if (metadata.mediaType !== ref.mediaType || data.byteLength !== ref.bytes
    || metadata.width !== ref.width || metadata.height !== ref.height) {
    throw new AttachmentError('Stored attachment metadata does not match its reference.', 'ATTACHMENT_CORRUPT')
  }
  return { ref, data }
}
