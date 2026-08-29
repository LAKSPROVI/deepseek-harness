/** Raw generic-file route streaming without the buffered JSON bridge. */
import { EventEmitter } from 'node:events'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { Readable } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'
import type { ApiProxy } from '@deepseek-ai/dsh-host-apiproxy'
import { handleRawFileTransfer } from '../src/raw-file-route.ts'

function request(method: string, url: string, chunks: Uint8Array[] = [], headers: Record<string, string> = {}): IncomingMessage {
  return Object.assign(Readable.from(chunks), { method, url, headers }) as unknown as IncomingMessage
}

function response(): { res: ServerResponse; state: { status?: number; headers?: object; body: Buffer } } {
  const state: { status?: number; headers?: object; body: Buffer } = { body: Buffer.alloc(0) }
  const res = Object.assign(new EventEmitter(), {
    writableEnded: false,
    writeHead(status: number, headers?: object) {
      state.status = status
      if (headers !== undefined) state.headers = headers
      return this
    },
    write(chunk: Uint8Array) { state.body = Buffer.concat([state.body, Buffer.from(chunk)]); return true },
    end(this: { writableEnded: boolean }, chunk?: string | Uint8Array) {
      if (chunk !== undefined) state.body = Buffer.concat([state.body, Buffer.from(chunk)])
      this.writableEnded = true
      return this
    },
  }) as unknown as ServerResponse
  return { res, state }
}

function api(): ApiProxy {
  return {
    downloads: {
      fileUpload: vi.fn(async ({ body }) => {
        const chunks: Uint8Array[] = []
        for await (const chunk of body) chunks.push(chunk)
        return Response.json({ chunks: chunks.map(chunk => [...chunk]) }, { status: 201 })
      }),
      fileDownload: vi.fn(() => Promise.resolve(new Response(new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(Uint8Array.of(4, 5))
          controller.enqueue(Uint8Array.of(6))
          controller.close()
        },
      }), { headers: { 'content-type': 'application/octet-stream' } }))),
      sessionLog: vi.fn(),
    },
  } as unknown as ApiProxy
}

describe('raw file route', () => {
  it('passes POST chunks directly to Host and streams its response', async () => {
    const host = api()
    const out = response()
    await handleRawFileTransfer(request(
      'POST', '/api/session.file?sessionId=s1&bytes=3&name=a.bin',
      [Uint8Array.of(1), Uint8Array.of(2, 3)], { 'content-length': '3' },
    ), out.res, host)
    expect(out.state.status).toBe(201)
    expect(JSON.parse(out.state.body.toString())).toEqual({ chunks: [[1], [2, 3]] })
    expect(host.downloads.fileUpload).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: 's1', expectedBytes: 3, name: 'a.bin' }),
      expect.any(AbortSignal),
    )
  })

  it('streams GET and rejects mismatched length or Range before Host', async () => {
    const host = api()
    const downloaded = response()
    await handleRawFileTransfer(request(
      'GET', '/api/session.file?sessionId=s1&attachmentId=sha256%3Aabc',
    ), downloaded.res, host)
    expect(downloaded.state.body).toEqual(Buffer.from([4, 5, 6]))

    const mismatch = response()
    await handleRawFileTransfer(request(
      'POST', '/api/session.file?sessionId=s1&bytes=4', [], { 'content-length': '5' },
    ), mismatch.res, host)
    expect(mismatch.state.status).toBe(400)

    const ranged = response()
    await handleRawFileTransfer(request(
      'GET', '/api/session.file?sessionId=s1&attachmentId=sha256%3Aabc', [], { range: 'bytes=0-1' },
    ), ranged.res, host)
    expect(ranged.state.status).toBe(416)
    expect(host.downloads.fileUpload).not.toHaveBeenCalled()
    expect(host.downloads.fileDownload).toHaveBeenCalledTimes(1)
  })
})
