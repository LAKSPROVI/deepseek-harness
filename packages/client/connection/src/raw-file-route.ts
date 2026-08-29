/** Raw generic-file HTTP carrier with bounded-memory streaming. */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { ApiProxy } from '@deepseek-ai/dsh-host-apiproxy'
import { SessionId } from '@deepseek-ai/dsh-session/types'

function requestValue(url: URL, name: string): string | undefined {
  const values = url.searchParams.getAll(name)
  return values.length === 1 && values[0] !== '' ? values[0] : undefined
}

function exactBytes(value: string | undefined): number | undefined {
  if (value === undefined || !/^(?:0|[1-9][0-9]*)$/u.test(value)) return undefined
  const bytes = Number(value)
  return Number.isSafeInteger(bytes) ? bytes : undefined
}

async function writeResponse(
  req: IncomingMessage,
  res: ServerResponse,
  response: Response,
  abort: AbortController,
): Promise<void> {
  res.writeHead(response.status, Object.fromEntries(response.headers.entries()))
  if (response.body === null) {
    res.end()
    return
  }
  try {
    for await (const chunk of response.body) {
      if (!res.write(chunk)) {
        await new Promise<void>((resolve) => {
          const done = (): void => {
            res.off('drain', done)
            res.off('close', done)
            resolve()
          }
          res.once('drain', done)
          res.once('close', done)
        })
      }
      if (abort.signal.aborted) break
    }
    if (!res.writableEnded) res.end()
  } catch (error: unknown) {
    if (!abort.signal.aborted) req.destroy(error instanceof Error ? error : new Error('file transfer failed'))
  }
}

/**
 * Handle one exact raw-file route request without passing bytes through JSON RPC.
 * @param req - Node request whose body remains an incremental async iterator.
 * @param res - Node response written with backpressure.
 * @param api - Host API owner of session authorization and durable storage.
 */
export async function handleRawFileTransfer(
  req: IncomingMessage,
  res: ServerResponse,
  api: ApiProxy,
): Promise<void> {
  const abort = new AbortController()
  res.on('close', () => {
    if (!res.writableEnded) abort.abort(new Error('file transfer connection closed'))
  })
  const url = new URL(req.url ?? '/', 'http://dsh.internal')
  const sessionId = requestValue(url, 'sessionId')
  if (sessionId === undefined) {
    res.writeHead(400)
    res.end('sessionId is required')
    return
  }

  let response: Response
  if (req.method === 'POST') {
    const expectedBytes = exactBytes(requestValue(url, 'bytes'))
    if (expectedBytes === undefined) {
      res.writeHead(400)
      res.end('bytes must be one non-negative safe integer')
      return
    }
    const declared = req.headers['content-length']
    if (Array.isArray(declared) || (declared !== undefined && exactBytes(declared) !== expectedBytes)) {
      res.writeHead(400, { connection: 'close' })
      res.end('Content-Length does not match bytes')
      req.destroy()
      return
    }
    response = await api.downloads.fileUpload({
      sessionId: SessionId(sessionId),
      body: req,
      expectedBytes,
      ...(requestValue(url, 'mediaType') === undefined ? {} : { mediaType: requestValue(url, 'mediaType') as string }),
      ...(requestValue(url, 'name') === undefined ? {} : { name: requestValue(url, 'name') as string }),
    }, abort.signal)
  } else if (req.method === 'GET') {
    if (req.headers.range !== undefined) {
      res.writeHead(416)
      res.end('range requests are not supported')
      return
    }
    const attachmentId = requestValue(url, 'attachmentId')
    if (attachmentId === undefined) {
      res.writeHead(400)
      res.end('attachmentId is required')
      return
    }
    response = await api.downloads.fileDownload({
      sessionId: SessionId(sessionId),
      attachmentId,
    }, abort.signal)
  } else {
    res.writeHead(405, { allow: 'GET, POST' })
    res.end('method not allowed')
    return
  }
  await writeResponse(req, res, response, abort)
}
