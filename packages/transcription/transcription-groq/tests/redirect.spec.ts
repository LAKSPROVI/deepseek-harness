/**
 * Real HTTP coverage proves whether native `fetch` forwards a credentialed
 * multipart upload to a cross-origin `Location`; mocked request-init assertions
 * alone cannot observe that boundary.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createServer, type IncomingMessage, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { GroqTranscriptionProvider } from '@deepseek-ai/dsh-transcription-groq'
import type { GroqTranscriptionProviderOptions } from '@deepseek-ai/dsh-transcription-groq'
import type { TranscriptionRequest } from '@deepseek-ai/dsh-transcription'

/** Construct the provider over a fixed options value; production passes a live thunk. */
const transcriptionProvider = (options: GroqTranscriptionProviderOptions): GroqTranscriptionProvider =>
  new GroqTranscriptionProvider(() => options)

const TEST_API_KEY = 'redirect-test-key'
const targetRequests: ReceivedRequest[] = []

interface ReceivedRequest {
  readonly body: string
  readonly headers: IncomingMessage['headers']
  readonly method?: string
}

const request = (): TranscriptionRequest => ({ audio: new Uint8Array([9, 8, 7, 6]), format: 'audio/webm' })

let redirectOrigin: string
let targetOrigin: string

const targetServer = createServer((request_, response) => {
  void captureRequest(request_).then((received) => {
    targetRequests.push(received)
    response.writeHead(204).end()
  }, (error: unknown) => response.destroy(asError(error)))
})

const redirectServer = createServer((request_, response) => {
  request_.resume()
  const status = Number(new URL(request_.url ?? '/', 'http://fixture.test').pathname.split('/')[1])
  response.writeHead(status, { location: targetOrigin + '/collect' }).end()
})

beforeAll(async () => {
  targetOrigin = await listen(targetServer)
  redirectOrigin = await listen(redirectServer)
})

afterAll(async () => {
  await Promise.all([close(redirectServer), close(targetServer)])
})

describe('GroqTranscriptionProvider redirect policy', () => {
  it.each([301, 302, 303, 307, 308])('rejects HTTP %i before contacting Location', async (status) => {
    targetRequests.length = 0
    const provider = transcriptionProvider({
      apiKey: TEST_API_KEY,
      baseURL: redirectOrigin + '/' + String(status),
      model: 'whisper-large-v3-turbo',
    })

    await expect(provider.transcribe(request()))
      .rejects.toMatchObject({ code: 'TRANSCRIPTION_PROVIDER_ERROR' })
    expect(targetRequests).toHaveLength(0)
  })

  it('shows default 307 following forwards the audio body to the redirect target', async () => {
    targetRequests.length = 0
    const body = 'raw-audio-bytes'
    await fetch(redirectOrigin + '/307', {
      method: 'POST',
      headers: { 'authorization': 'Bearer ' + TEST_API_KEY, 'content-type': 'application/octet-stream' },
      body,
    })

    expect(targetRequests).toHaveLength(1)
    expect(targetRequests[0]).toMatchObject({ method: 'POST', body })
    // fetch strips `authorization` across origins, so the audio payload — not the
    // key — is what default following would hand to another host.
    expect(targetRequests[0]?.headers.authorization).toBeUndefined()
  })
})

/** Read a complete request received by the redirect target. */
function captureRequest(request_: IncomingMessage): Promise<ReceivedRequest> {
  return new Promise((resolve, reject) => {
    const chunks: Uint8Array[] = []
    request_.on('data', (chunk: unknown) => {
      if (typeof chunk === 'string' || chunk instanceof Uint8Array) chunks.push(Buffer.from(chunk))
      else reject(new TypeError('unexpected HTTP request chunk'))
    })
    request_.once('error', reject)
    request_.once('end', () => {
      resolve({
        ...request_.method !== undefined ? { method: request_.method } : {},
        headers: request_.headers,
        body: Buffer.concat(chunks).toString('utf8'),
      })
    })
  })
}

/** Listen on an ephemeral loopback port and return the server origin. */
async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address() as AddressInfo
  return 'http://127.0.0.1:' + String(address.port)
}

/** Close a listening fixture server after every request has settled. */
async function close(server: Server): Promise<void> {
  if (!server.listening) return
  await new Promise<void>((resolve, reject) => server.close((error) => {
    if (error === undefined) resolve()
    else reject(error)
  }))
}

/** Narrow an unknown rejection to the Error the response destroy call needs. */
function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}
