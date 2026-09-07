/**
 * Generic opaque-file command admission: mixed submission order, the store's
 * authoritative file policy, and the settled error results a dispatching
 * composer relies on to retain the user's originals.
 */

import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { createScope } from '@deepseek-ai/dsh-scope'
import type { Agent } from '@deepseek-ai/dsh-agent'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import CommandRuntime, { type CommandDefinition } from '@deepseek-ai/dsh-commands'
import { AttachmentError, AttachmentId, AttachmentStore } from '@deepseek-ai/dsh-attachment'

/** Canonical base64 payloads: 'AAAA' decodes to three bytes, 'AAAAAQ==' to four. */
const PNG = 'AAAA'
const BYTES_3 = 'AAAA'
const BYTES_4 = 'AAAAAQ=='

async function mount(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(CommandRuntime)
  return ctx
}

async function mintAgent(ctx: Context, name: string): Promise<Agent> {
  const session = ctx.sessions.create(SessionId(name))
  const agent = { id: session.id, session } as Agent
  await ctx.plugin(Object.assign((inner: Context) => { createScope(inner, agent) }, { inject: ['commands'] }))
  return agent
}

function lifecycleOf(agent: Agent): Array<{ type: string; data: unknown }> {
  return agent.session.events
    .filter(event => event.type === 'command/run' || event.type === 'command/done')
    .map(event => ({ type: event.type, data: event.data }))
}

/**
 * Attachment double delegating batch policy to the real base class, so file
 * count, aggregate bytes, and per-file bytes are enforced by production code.
 */
function storeOf(overrides: { maxFilesPerMessage?: number; maxFileBytes?: number; maxMessageFileBytes?: number } = {}) {
  let images = 0
  let files = 0
  const base = AttachmentStore.prototype as unknown as {
    validateFileBatch(this: unknown, batch: readonly unknown[]): void
    validateFileReferences(this: unknown, refs: readonly unknown[]): void
    validateFiles(this: unknown, batch: readonly unknown[]): Promise<void>
    authorizeUploadedFiles(this: unknown, scope: string, uploads: readonly unknown[]): Promise<readonly unknown[]>
    saveFiles(this: unknown, batch: readonly unknown[]): Promise<unknown[]>
    saveImages(this: unknown, batch: readonly unknown[]): Promise<unknown[]>
    validateImageBatch(this: unknown, batch: readonly unknown[]): void
  }
  return {
    imageLimits: {
      maxImageBytes: 1024, maxImagesPerMessage: 4, maxMessageImageBytes: 4096,
      maxImagePixels: 1_000_000, maxImageDimension: 2000, mediaTypes: ['image/png'],
    },
    fileLimits: {
      maxFileBytes: overrides.maxFileBytes ?? 1024,
      maxFilesPerMessage: overrides.maxFilesPerMessage ?? 4,
      maxMessageFileBytes: overrides.maxMessageFileBytes ?? 4096,
    },
    validateImage: vi.fn(() => Promise.resolve()),
    saveImage: vi.fn((input: { mediaType: string; name?: string }) => {
      images += 1
      return Promise.resolve({
        attachmentId: `img-${images}`, mediaType: input.mediaType, bytes: 3, width: 1, height: 1,
        ...input.name === undefined ? {} : { name: input.name },
      })
    }),
    validateFile: vi.fn(() => Promise.resolve()),
    saveFile: vi.fn((input: { data: Uint8Array; mediaType?: string; name?: string }) => {
      files += 1
      return Promise.resolve({
        attachmentId: `file-${files}`,
        // Unknown declared types collapse to the opaque default, mirroring the local store.
        mediaType: input.mediaType ?? 'application/octet-stream',
        bytes: input.data.byteLength,
        ...input.name === undefined ? {} : { name: input.name },
      })
    }),
    validateImageBatch(inputs: readonly unknown[]) { base.validateImageBatch.call(this, inputs) },
    saveImages(inputs: readonly unknown[]) { return base.saveImages.call(this, inputs) },
    validateFileBatch(inputs: readonly unknown[]) { base.validateFileBatch.call(this, inputs) },
    validateFileReferences(refs: readonly unknown[]) { base.validateFileReferences.call(this, refs) },
    validateFiles(inputs: readonly unknown[]) { return base.validateFiles.call(this, inputs) },
    authorizeUploadedFile(scope: string, upload: { uploadId: string; attachment: object }) {
      if (upload.uploadId !== `receipt:${scope}`) {
        return Promise.reject(new AttachmentError('Uploaded file receipt is invalid.', 'INVALID_ATTACHMENT_REF'))
      }
      return Promise.resolve(upload.attachment)
    },
    authorizeUploadedFiles(scope: string, uploads: readonly unknown[]) {
      return base.authorizeUploadedFiles.call(this, scope, uploads)
    },
    saveFiles(inputs: readonly unknown[]) { return base.saveFiles.call(this, inputs) },
  }
}

/** Store double for a deployment whose provider supports images only. */
function imageOnlyStoreOf() {
  const store = storeOf() as Record<string, unknown>
  store['fileLimits'] = undefined
  store['saveFiles'] = (inputs: readonly unknown[]) =>
    (AttachmentStore.prototype.saveFiles as (this: unknown, batch: readonly unknown[]) => Promise<unknown[]>)
      .call(store, inputs)
  store['saveFile'] = AttachmentStore.prototype.saveFile.bind(store as never)
  store['validateFile'] = AttachmentStore.prototype.validateFile.bind(store as never)
  return store
}

function accepting(handler: CommandDefinition['handler']): CommandDefinition {
  return {
    name: 'vision',
    description: 'accepts attachments',
    input: { hint: '<objective>', attachments: true },
    handler,
  }
}

describe('command generic file attachments', () => {
  it('hands the handler mixed image and file blocks in exact submission order', async () => {
    const ctx = await mount()
    ctx.provide('attachments', storeOf())
    const agent = await mintAgent(ctx, 'a')
    const seen = vi.fn((invocation: { attachments: readonly unknown[] }) => {
      expect(Object.isFrozen(invocation.attachments)).toBe(true)
      return { kind: 'success' as const }
    })
    ctx.commands.register(accepting(seen))

    await ctx.commands.execute(agent, '/vision x', [
      { type: 'file', data: BYTES_3, mediaType: 'application/pdf', name: 'brief.pdf' },
      { type: 'image', mediaType: 'image/png', data: PNG, name: 'shot.png' },
      { type: 'file', data: BYTES_4, name: 'notes.bin' },
    ], new AbortController().signal)

    const invocation = seen.mock.calls[0]?.[0] as {
      attachments: ReadonlyArray<{ type: string; attachment: { name?: string; mediaType: string; bytes?: number } }>
    }
    expect(invocation.attachments.map(block => [block.type, block.attachment.name, block.attachment.mediaType]))
      .toEqual([
        ['file', 'brief.pdf', 'application/pdf'],
        ['image', 'shot.png', 'image/png'],
        ['file', 'notes.bin', 'application/octet-stream'],
      ])
    expect(invocation.attachments[2]?.attachment.bytes).toBe(4)
  })

  it('authorizes a receipt for the exact command session and preserves mixed order', async () => {
    const ctx = await mount()
    const store = storeOf()
    ctx.provide('attachments', store)
    const agent = await mintAgent(ctx, 'receipt-session')
    const seen = vi.fn((_invocation: unknown) => ({ kind: 'success' as const }))
    ctx.commands.register(accepting(seen))
    const ref = {
      attachmentId: AttachmentId('sha256:raw'), mediaType: 'application/octet-stream', bytes: 3, name: 'raw.bin',
    }

    const accepted = await ctx.commands.execute(agent, '/vision x', [
      { type: 'image', mediaType: 'image/png', data: PNG, name: 'shot.png' },
      { type: 'file', uploadId: `receipt:${String(agent.session.id)}`, attachment: ref },
      { type: 'file', data: BYTES_3, name: 'legacy.bin' },
    ], new AbortController().signal)
    expect(accepted?.result.kind).toBe('success')
    const invocation = seen.mock.calls[0]?.[0] as {
      attachments: ReadonlyArray<{ type: string; attachment: { name?: string } }>
    }
    expect(invocation.attachments.map(block => [block.type, block.attachment.name])).toEqual([
      ['image', 'shot.png'], ['file', 'raw.bin'], ['file', 'legacy.bin'],
    ])

    const denied = await ctx.commands.execute(agent, '/vision x', [
      { type: 'file', uploadId: 'receipt:another-session', attachment: ref },
    ], new AbortController().signal)
    expect(denied?.result).toMatchObject({ kind: 'error' })
    expect(seen).toHaveBeenCalledOnce()
  })

  it('settles the store file-count limit as a logged error without entering the handler', async () => {
    const ctx = await mount()
    ctx.provide('attachments', storeOf({ maxFilesPerMessage: 2 }))
    const agent = await mintAgent(ctx, 'a')
    const handler = vi.fn(() => ({ kind: 'success' as const }))
    ctx.commands.register(accepting(handler))

    const execution = await ctx.commands.execute(agent, '/vision x', [
      { type: 'file', data: BYTES_3 },
      { type: 'file', data: BYTES_3 },
      { type: 'file', data: BYTES_3 },
    ], new AbortController().signal)

    expect(execution?.result).toEqual({
      kind: 'error', text: 'File batch exceeds the configured file-count limit.',
    })
    expect(handler).not.toHaveBeenCalled()
    expect(lifecycleOf(agent).at(-1)).toMatchObject({ type: 'command/done', data: { kind: 'error' } })
  })

  it('settles a single oversized file and an oversized aggregate as logged errors', async () => {
    const ctx = await mount()
    ctx.provide('attachments', storeOf({ maxFileBytes: 3, maxMessageFileBytes: 6 }))
    const agent = await mintAgent(ctx, 'a')
    ctx.commands.register(accepting(() => ({ kind: 'success' })))

    const perFile = await ctx.commands.execute(
      agent, '/vision x', [{ type: 'file', data: BYTES_4 }], new AbortController().signal)
    expect(perFile?.result).toEqual({ kind: 'error', text: 'File exceeds the configured byte limit.' })

    const aggregate = await ctx.commands.execute(agent, '/vision x', [
      { type: 'file', data: BYTES_3 },
      { type: 'file', data: BYTES_3 },
      { type: 'file', data: BYTES_3 },
    ], new AbortController().signal)
    expect(aggregate?.result).toEqual({
      kind: 'error', text: 'File batch exceeds the configured aggregate file-byte limit.',
    })
  })

  it('settles a non-canonical file payload as a logged error', async () => {
    const ctx = await mount()
    ctx.provide('attachments', storeOf())
    const agent = await mintAgent(ctx, 'a')
    ctx.commands.register(accepting(() => ({ kind: 'success' })))

    const execution = await ctx.commands.execute(
      agent, '/vision x', [{ type: 'file', data: 'A@AA' }], new AbortController().signal)

    expect(execution?.result).toEqual({ kind: 'error', text: 'File upload is not canonical base64.' })
  })

  it('settles files against an image-only provider as an unsupported-file error', async () => {
    const ctx = await mount()
    ctx.provide('attachments', imageOnlyStoreOf())
    const agent = await mintAgent(ctx, 'a')
    const handler = vi.fn(() => ({ kind: 'success' as const }))
    ctx.commands.register(accepting(handler))

    const execution = await ctx.commands.execute(
      agent, '/vision x', [{ type: 'file', data: BYTES_3 }], new AbortController().signal)

    expect(execution?.result).toEqual({
      kind: 'error', text: 'The mounted attachment provider does not support generic files.',
    })
    expect(handler).not.toHaveBeenCalled()
  })

  it('rejects files sent to a non-declaring command before admission', async () => {
    const ctx = await mount()
    const store = storeOf()
    ctx.provide('attachments', store)
    const agent = await mintAgent(ctx, 'a')
    const handler = vi.fn(() => ({ kind: 'success' as const }))
    ctx.commands.register({ name: 'deploy', description: 'plain', handler })

    const execution = await ctx.commands.execute(
      agent, '/deploy now', [{ type: 'file', data: BYTES_3 }], new AbortController().signal)

    expect(execution?.result).toEqual({ kind: 'error', text: '/deploy does not accept attachments' })
    expect(handler).not.toHaveBeenCalled()
    expect(store.saveFile).not.toHaveBeenCalled()
  })

  it('settles files as unavailable when no attachment store is composed', async () => {
    const ctx = await mount()
    const agent = await mintAgent(ctx, 'a')
    ctx.commands.register(accepting(() => ({ kind: 'success' })))

    const execution = await ctx.commands.execute(
      agent, '/vision x', [{ type: 'file', data: BYTES_3 }], new AbortController().signal)

    expect(execution?.result).toEqual({
      kind: 'error',
      text: '/vision: attachments are unavailable because no attachment store is composed',
    })
  })
})
