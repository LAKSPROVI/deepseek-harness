/**
 * Host admission and authorization for generic opaque file attachments:
 * mixed prompt ordering against durable references, the attachment store as
 * the authoritative file policy, model-route independence of durable intake,
 * and the discriminated session-authorized download path.
 */

import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import AttachmentStore, { AttachmentId } from '@deepseek-ai/dsh-attachment'
import LlmRuntime, { CallId, createToolResultMessage, LlmAdapter } from '@deepseek-ai/dsh-llm'
import type {
  GenerateOptions, LlmModelInfo, LlmProviderInfo, LlmResolvedModelInfo, StreamChunk, UserMessage,
} from '@deepseek-ai/dsh-llm'
import SessionStore from '@deepseek-ai/dsh-session'
import type { SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import UserQuestionService from '@deepseek-ai/dsh-user-questions'
import type { RpcRequest } from '@deepseek-ai/dsh-host-apiproxy/api/rpc'
import { RpcId } from '@deepseek-ai/dsh-host-apiproxy/api/rpc'
import { createApiProxy } from '../src/api-proxy.ts'

let nextRpc = 1
function request<P>(payload: P): RpcRequest<P> {
  return { rpcId: RpcId(`files-${String(nextRpc++)}`), payload }
}

/** Minimal adapter whose advertised input modalities are supplied per registration. */
class ModalityAdapter extends LlmAdapter {
  constructor(private readonly modalities: LlmModelInfo['inputModalities']) {
    super()
  }

  override providerInfo(provider: string): LlmProviderInfo {
    return { id: provider, name: 'Route' }
  }

  override listModels(): Promise<readonly LlmModelInfo[]> {
    return Promise.resolve([])
  }

  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return Promise.resolve({
      provider,
      id: model,
      name: model,
      ...(this.modalities === undefined ? {} : { inputModalities: this.modalities }),
    })
  }

  override async *stream(_options: GenerateOptions): AsyncIterable<StreamChunk> {
    // Admission tests never enter provider streaming.
  }
}

async function harness(): Promise<{ ctx: Context; agent: Agent; sessionId: SessionId }> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(SystemPrompt, { persona: '' })
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(UserQuestionService)
  await ctx.plugin(AgentRegistry)
  ctx.llm.registerAdapter(['files-native'], new ModalityAdapter(['text', 'image', 'file']))
  ctx.llm.registerAdapter(['text-only'], new ModalityAdapter(['text']))
  const session = ctx.sessions.create()
  const agent = {
    id: session.id, session, status: 'running', ctx, inbox: { nextTurn: [], nextStep: [] },
  } as unknown as Agent
  ctx.agents.register(agent)
  return { ctx, agent, sessionId: session.id }
}

/**
 * Attachment double whose file batch policy is the real base-class
 * implementation, so limit enforcement under test is production code.
 */
function fileStore(limits: Partial<{
  maxFileBytes: number
  maxFilesPerMessage: number
  maxMessageFileBytes: number
}> = {}) {
  let saved = 0
  const store = {
    imageLimits: {
      maxImageBytes: 1024, maxImagesPerMessage: 4, maxMessageImageBytes: 4096,
      maxImagePixels: 1_000_000, maxImageDimension: 2000, mediaTypes: ['image/png'],
    },
    fileLimits: {
      maxFileBytes: limits.maxFileBytes ?? 1024,
      maxFilesPerMessage: limits.maxFilesPerMessage ?? 4,
      maxMessageFileBytes: limits.maxMessageFileBytes ?? 4096,
    },
    validateImage: vi.fn(() => Promise.resolve()),
    saveImage: vi.fn((input: { data: Uint8Array; mediaType: string; name?: string }) => Promise.resolve({
      attachmentId: `img-${String(input.data[0])}`,
      mediaType: input.mediaType,
      bytes: input.data.byteLength,
      width: 1,
      height: 1,
      ...input.name === undefined ? {} : { name: input.name },
    })),
    validateFile: vi.fn(() => Promise.resolve()),
    authorizeUploadedFile: vi.fn((scope: string, upload: { uploadId: string; attachment: object }) => {
      if (upload.uploadId !== `receipt:${scope}`) return Promise.reject(new Error('wrong upload scope'))
      return Promise.resolve(upload.attachment)
    }),
    saveFile: vi.fn((input: { data: Uint8Array; mediaType?: string; name?: string }) => {
      saved += 1
      return Promise.resolve({
        attachmentId: `file-${String(saved)}`,
        mediaType: input.mediaType ?? 'application/octet-stream',
        bytes: input.data.byteLength,
        ...input.name === undefined ? {} : { name: input.name },
      })
    }),
  }
  return Object.setPrototypeOf(store, AttachmentStore.prototype) as typeof store
}

describe('generic file prompt admission', () => {
  it('preserves mixed text, image, and file order as durable references', async () => {
    const { ctx, agent, sessionId } = await harness()
    const attachments = fileStore()
    ctx.provide('attachments', attachments as never)
    const followup = vi.fn()
    Object.assign(agent, { followup })
    const api = createApiProxy(ctx, {
      defaultModelSelection: () => ({ provider: 'files-native', model: 'route' }),
      cwd: '/tmp',
    })

    const result = await api.sessions.prompt(request({
      sessionId,
      mode: 'queue' as const,
      content: [
        { type: 'file' as const, data: 'AQ==', mediaType: 'application/pdf', name: 'brief.pdf' },
        { type: 'text' as const, text: 'review' },
        { type: 'image' as const, mediaType: 'image/png' as const, data: 'Ag==', name: 'shot.png' },
        { type: 'file' as const, data: 'Aw==' },
      ],
    }))

    expect(result.result.ok).toBe(true)
    expect((followup.mock.calls[0]?.[0] as UserMessage).content).toEqual([
      {
        type: 'file',
        attachment: {
          attachmentId: 'file-1', mediaType: 'application/pdf', bytes: 1, name: 'brief.pdf',
        },
      },
      { type: 'text', text: 'review' },
      {
        type: 'image',
        attachment: {
          attachmentId: 'img-2', mediaType: 'image/png', bytes: 1, width: 1, height: 1, name: 'shot.png',
        },
      },
      { type: 'file', attachment: { attachmentId: 'file-2', mediaType: 'application/octet-stream', bytes: 1 } },
    ])
    await ctx.fiber.dispose()
  })

  it('authorizes uploaded receipts for the exact session and preserves mixed order', async () => {
    const { ctx, agent, sessionId } = await harness()
    const attachments = fileStore()
    ctx.provide('attachments', attachments as never)
    const followup = vi.fn()
    Object.assign(agent, { followup })
    const api = createApiProxy(ctx, {
      defaultModelSelection: () => ({ provider: 'files-native', model: 'route' }), cwd: '/tmp',
    })
    const ref = {
      attachmentId: AttachmentId('sha256:raw'), mediaType: 'application/octet-stream', bytes: 3, name: 'raw.bin',
    }

    const accepted = await api.sessions.prompt(request({
      sessionId, mode: 'queue' as const, content: [
        { type: 'text' as const, text: 'inspect' },
        { type: 'file' as const, uploadId: `receipt:${String(sessionId)}`, attachment: ref },
      ],
    }))
    expect(accepted.result.ok).toBe(true)
    expect((followup.mock.calls[0]?.[0] as UserMessage).content).toEqual([
      { type: 'text', text: 'inspect' }, { type: 'file', attachment: ref },
    ])

    const denied = await api.sessions.prompt(request({
      sessionId, mode: 'queue' as const, content: [
        { type: 'file' as const, uploadId: 'receipt:another-session', attachment: ref },
      ],
    }))
    expect(denied.result.ok).toBe(false)
    expect(followup).toHaveBeenCalledOnce()
    await ctx.fiber.dispose()
  })

  it('rejects a file batch that exceeds the host file-count limit before any write', async () => {
    const { ctx, sessionId } = await harness()
    const attachments = fileStore({ maxFilesPerMessage: 2 })
    ctx.provide('attachments', attachments as never)
    const api = createApiProxy(ctx, {
      defaultModelSelection: () => ({ provider: 'files-native', model: 'route' }),
      cwd: '/tmp',
    })

    const denied = await api.sessions.prompt(request({
      sessionId,
      mode: 'queue' as const,
      content: Array.from({ length: 3 }, () => ({ type: 'file' as const, data: 'AQ==' })),
    }))

    expect(denied.result).toMatchObject({
      ok: false,
      error: { code: 'attachment-error', details: { reason: 'TOO_MANY_FILES' } },
    })
    expect(attachments.saveFile).not.toHaveBeenCalled()
    await ctx.fiber.dispose()
  })

  it('rejects an oversized file and a non-canonical payload with their exact reasons', async () => {
    const { ctx, sessionId } = await harness()
    const attachments = fileStore({ maxFileBytes: 1 })
    ctx.provide('attachments', attachments as never)
    const api = createApiProxy(ctx, {
      defaultModelSelection: () => ({ provider: 'files-native', model: 'route' }),
      cwd: '/tmp',
    })

    const oversized = await api.sessions.prompt(request({
      sessionId, mode: 'queue' as const, content: [{ type: 'file' as const, data: 'AQI=' }],
    }))
    expect(oversized.result).toMatchObject({
      ok: false,
      error: { code: 'attachment-error', details: { reason: 'FILE_TOO_LARGE' } },
    })

    const malformed = await api.sessions.prompt(request({
      sessionId, mode: 'queue' as const, content: [{ type: 'file' as const, data: 'A@AA' }],
    }))
    expect(malformed.result).toMatchObject({
      ok: false,
      error: { code: 'attachment-error', details: { reason: 'INVALID_FILE_BASE64' } },
    })
    expect(attachments.saveFile).not.toHaveBeenCalled()
    await ctx.fiber.dispose()
  })

  it('persists files for a text-only route: durable intake never depends on model support', async () => {
    const { ctx, agent, sessionId } = await harness()
    const attachments = fileStore()
    ctx.provide('attachments', attachments as never)
    const followup = vi.fn()
    Object.assign(agent, { followup })
    const api = createApiProxy(ctx, {
      defaultModelSelection: () => ({ provider: 'text-only', model: 'plain' }),
      cwd: '/tmp',
    })

    const result = await api.sessions.prompt(request({
      sessionId,
      mode: 'queue' as const,
      content: [{ type: 'file' as const, data: 'AQ==', name: 'notes.bin' }],
    }))

    expect(result.result.ok).toBe(true)
    expect(attachments.saveFile).toHaveBeenCalledTimes(1)
    expect((followup.mock.calls[0]?.[0] as UserMessage).content).toEqual([
      {
        type: 'file',
        attachment: {
          attachmentId: 'file-1', mediaType: 'application/octet-stream', bytes: 1, name: 'notes.bin',
        },
      },
    ])
    await ctx.fiber.dispose()
  })
})

describe('generic file attachment authorization', () => {
  it('publishes no event on upload and authorizes raw download only from user-message content', async () => {
    const { ctx, agent, sessionId } = await harness()
    const ref = {
      attachmentId: AttachmentId('sha256:streamed'), mediaType: 'application/pdf', bytes: 3, name: 'brief.pdf',
    }
    const receipt = { uploadId: `receipt:${String(sessionId)}`, attachment: ref }
    const saveFileStream = vi.fn(() => Promise.resolve(receipt))
    const readFileStream = vi.fn(() => Promise.resolve({
      ref,
      data: (async function* (): AsyncGenerator<Uint8Array> {
        yield Uint8Array.of(1)
        yield Uint8Array.of(2, 3)
      })(),
    }))
    ctx.provide('attachments', {
      ...fileStore(), saveFileStream, readFileStream,
    } as never)
    const api = createApiProxy(ctx, {
      defaultModelSelection: () => ({ provider: 'files-native', model: 'route' }), cwd: '/tmp',
    })
    const before = agent.session.events.length
    const uploaded = await api.downloads.fileUpload({
      sessionId,
      body: (async function* (): AsyncGenerator<Uint8Array> { yield Uint8Array.of(1, 2, 3) })(),
      expectedBytes: 3,
      mediaType: 'application/pdf',
      name: 'brief.pdf',
    }, new AbortController().signal)
    expect(uploaded.status).toBe(201)
    await expect(uploaded.json()).resolves.toEqual(receipt)
    expect(agent.session.events).toHaveLength(before)

    const beforeLog = await api.downloads.fileDownload(
      { sessionId, attachmentId: ref.attachmentId }, new AbortController().signal)
    expect(beforeLog.status).toBe(404)

    agent.session.append('turn/start', { turn: 1 })
    agent.session.append('tool/call', {
      turn: 1, step: 1, callId: CallId('file-tool'), name: 'file-tool', arguments: '{}',
    })
    agent.session.append('tool/result', {
      turn: 1,
      step: 1,
      message: createToolResultMessage({
        callId: CallId('file-tool'), content: [{ type: 'text', text: 'done' }], isError: false,
      }),
      meta: { type: 'file', attachment: ref },
    } as never, { surfaceOp: 'append' })
    const toolOnly = await api.downloads.fileDownload(
      { sessionId, attachmentId: ref.attachmentId }, new AbortController().signal)
    expect(toolOnly.status).toBe(404)
    expect(readFileStream).not.toHaveBeenCalled()

    agent.session.append('user/message', {
      id: 'file-message', role: 'user', source: { kind: 'user' },
      content: [{ type: 'file', attachment: ref }],
    } as never, { surfaceOp: 'append' })
    const allowed = await api.downloads.fileDownload(
      { sessionId, attachmentId: ref.attachmentId }, new AbortController().signal)
    expect(allowed.status).toBe(200)
    await expect(allowed.arrayBuffer().then(value => [...new Uint8Array(value)])).resolves.toEqual([1, 2, 3])
    expect(allowed.headers.get('content-type')).toBe('application/octet-stream')
    expect(allowed.headers.get('content-disposition')).toContain('attachment;')
    expect(allowed.headers.get('x-content-type-options')).toBe('nosniff')
    expect(allowed.headers.get('cache-control')).toBe('private, no-store')
    expect(readFileStream).toHaveBeenCalledOnce()
    await ctx.fiber.dispose()
  })

  it('authorizes only explicit debate content among optional Team events', async () => {
    const { ctx, agent, sessionId } = await harness()
    const debateRef = {
      attachmentId: 'debate-file', mediaType: 'application/pdf', bytes: 2, name: 'evidence.pdf',
    }
    const hiddenRef = {
      attachmentId: 'task-file', mediaType: 'application/pdf', bytes: 2, name: 'hidden.pdf',
    }
    const readFile = vi.fn((ref: typeof debateRef) => Promise.resolve({ ref, data: Uint8Array.of(7, 8) }))
    const readFileStream = vi.fn((ref: typeof debateRef) => Promise.resolve({
      ref,
      data: (async function* (): AsyncGenerator<Uint8Array> { yield Uint8Array.of(7, 8) })(),
    }))
    ctx.provide('attachments', { readFile, readFileStream } as never)
    const api = createApiProxy(ctx, {
      defaultModelSelection: () => ({ provider: 'files-native', model: 'route' }), cwd: '/tmp',
    })
    agent.session.append('team/debate' as never, {
      version: 1,
      teamId: sessionId,
      debate: {
        id: 'debate-one', revision: 1, topic: 'Review evidence', status: 'active', phase: 'positions',
        round: 1, maxRounds: 1, participants: ['lead', 'worker'], contributions: [], history: [],
        evidence: [{ type: 'file', attachment: debateRef }],
      },
    } as never)
    agent.session.append('team/task' as never, {
      version: 1, teamId: sessionId, task: { id: '1', attachment: hiddenRef },
    } as never)

    const admitted = await api.sessions.attachment(request({
      sessionId, attachmentId: 'debate-file' as never,
    }))
    expect(admitted.result).toMatchObject({
      ok: true, value: { type: 'file', attachment: debateRef, data: 'Bwg=' },
    })
    const download = await api.downloads.fileDownload(
      { sessionId, attachmentId: debateRef.attachmentId as never }, new AbortController().signal)
    expect(download.status).toBe(200)
    await expect(download.arrayBuffer().then(value => [...new Uint8Array(value)])).resolves.toEqual([7, 8])

    const denied = await api.sessions.attachment(request({
      sessionId, attachmentId: 'task-file' as never,
    }))
    expect(denied.result).toMatchObject({
      ok: false, error: { details: { reason: 'ATTACHMENT_NOT_REFERENCED' } },
    })
    expect((await api.downloads.fileDownload(
      { sessionId, attachmentId: hiddenRef.attachmentId as never }, new AbortController().signal)).status).toBe(404)
    expect(readFile).toHaveBeenCalledOnce()
    expect(readFileStream).toHaveBeenCalledOnce()
    await ctx.fiber.dispose()
  })

  it('serves file bytes discriminated as file only when the session log references the id', async () => {
    const { ctx, agent, sessionId } = await harness()
    const ref = { attachmentId: 'file-authorized', mediaType: 'application/pdf', bytes: 2, name: 'brief.pdf' }
    const readFile = vi.fn(() => Promise.resolve({ ref, data: Uint8Array.of(1, 2) }))
    const readImage = vi.fn(() => Promise.reject(new Error('images must not be read for a file reference')))
    ctx.provide('attachments', { readFile, readImage } as never)
    const api = createApiProxy(ctx, {
      defaultModelSelection: () => ({ provider: 'files-native', model: 'route' }),
      cwd: '/tmp',
    })
    agent.session.append('user/message', {
      id: 'file-message', role: 'user', source: { kind: 'user' },
      content: [{ type: 'file', attachment: ref }],
    } as never, { surfaceOp: 'append' })

    const allowed = await api.sessions.attachment(request({
      sessionId, attachmentId: 'file-authorized' as never,
    }))
    expect(allowed.result).toMatchObject({
      ok: true, value: { type: 'file', attachment: ref, data: 'AQI=' },
    })

    const denied = await api.sessions.attachment(request({
      sessionId, attachmentId: 'file-unknown' as never,
    }))
    expect(denied.result).toMatchObject({
      ok: false,
      error: { code: 'attachment-error', details: { reason: 'ATTACHMENT_NOT_REFERENCED' } },
    })
    expect(readFile).toHaveBeenCalledOnce()
    expect(readImage).not.toHaveBeenCalled()
    await ctx.fiber.dispose()
  })

  it('routes an image reference to the image read path in the same session', async () => {
    const { ctx, agent, sessionId } = await harness()
    const ref = { attachmentId: 'img-authorized', mediaType: 'image/png' as const, bytes: 2, width: 1, height: 1 }
    const readImage = vi.fn(() => Promise.resolve({ ref, data: Uint8Array.of(3, 4) }))
    const readFile = vi.fn(() => Promise.reject(new Error('files must not be read for an image reference')))
    ctx.provide('attachments', { readImage, readFile } as never)
    const api = createApiProxy(ctx, {
      defaultModelSelection: () => ({ provider: 'files-native', model: 'route' }),
      cwd: '/tmp',
    })
    agent.session.append('user/message', {
      id: 'image-message', role: 'user', source: { kind: 'user' },
      content: [{ type: 'image', attachment: ref }],
    } as never, { surfaceOp: 'append' })

    const allowed = await api.sessions.attachment(request({
      sessionId, attachmentId: 'img-authorized' as never,
    }))
    expect(allowed.result).toMatchObject({
      ok: true, value: { type: 'image', attachment: ref, data: 'AwQ=' },
    })
    expect(readFile).not.toHaveBeenCalled()
    await ctx.fiber.dispose()
  })
})
