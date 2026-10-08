/** Native HTTP observations for configured JEV model selection and redirect refusal. */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { Context } from '@deepseek-ai/cordis'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import type { ToolDefinition, ToolExecutionToken } from '@deepseek-ai/dsh-tools'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { apply, DEFAULT_JEV_MODEL, type Config } from '../src/index.ts'

const input = { state: 'fixture state', questions: [{ name: 'a', type: 'noul', instructions: 'fixture question' }] }
const fixtureKey = 'jev-local-fixture-key'

interface ReceivedRequest {
  body: string
  authorization: string | undefined
  method: string | undefined
}

async function receive(request: IncomingMessage): Promise<ReceivedRequest> {
  const body = await new Promise<string>((resolve, reject) => {
    const chunks: Uint8Array[] = []
    request.on('data', (chunk: unknown) => {
      if (typeof chunk === 'string' || chunk instanceof Uint8Array) chunks.push(Buffer.from(chunk))
      else reject(new Error('Unexpected request bytes'))
    })
    request.once('error', reject)
    request.once('end', () => { resolve(Buffer.concat(chunks).toString('utf8')) })
  })
  return { body, authorization: request.headers.authorization, method: request.method }
}

async function listen(
  handler: (request: IncomingMessage, response: ServerResponse) => Promise<void>,
): Promise<{ origin: string; server: Server }> {
  const server = createServer((request, response) => {
    void handler(request, response).catch((error: unknown) => {
      response.destroy(error instanceof Error ? error : new Error(String(error)))
    })
  })
  onTestFinished(async () => {
    if (!server.listening) return
    const closed = new Promise<void>((resolve, reject) => {
      server.close((error) => { if (error) reject(error); else resolve() })
    })
    server.closeAllConnections()
    await closed
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Expected a loopback listener')
  return { origin: `http://127.0.0.1:${address.port}`, server }
}

function register(config: Config): ToolDefinition {
  vi.stubEnv('TYPESAFE_API_KEY', fixtureKey)
  onTestFinished(() => { vi.unstubAllEnvs() })
  const ctx = new Context()
  let definition: ToolDefinition | undefined
  ctx.provide('tools', { register: (value: ToolDefinition) => { definition = value } } as Context['tools'])
  apply(ctx, { enabled: true, ...config })
  if (definition === undefined) throw new Error('JEV tool did not register')
  return definition
}

async function execute(tool: ToolDefinition, args: Record<string, unknown>): Promise<unknown> {
  const callId = ToolCallId('jev-runtime-policy-fixture')
  return await tool.execute(args, {
    name: tool.name, arguments: args, callId, rootCallId: callId,
    token: Symbol('jev-runtime-policy-fixture') as ToolExecutionToken,
    signal: new AbortController().signal, deferContext: () => {}, concludeTurn: () => {},
  })
}

describe('JEV runtime request policy', () => {
  it.each([
    { configured: 'configured-jev', argument: undefined, expected: 'configured-jev' },
    { configured: ' configured-jev ', argument: '   ', expected: 'configured-jev' },
    { configured: 'configured-jev', argument: ' explicit-jev ', expected: 'explicit-jev' },
    { configured: undefined, argument: undefined, expected: DEFAULT_JEV_MODEL },
    { configured: '   ', argument: '', expected: DEFAULT_JEV_MODEL },
  ])('sends model $expected with config $configured and argument $argument', async ({ configured, argument, expected }) => {
    const received: ReceivedRequest[] = []
    const endpoint = await listen(async (request, response) => {
      received.push(await receive(request))
      response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ model: expected, answers: {}, usage: {} }))
    })
    const tool = register({ apiUrl: endpoint.origin, ...(configured === undefined ? {} : { model: configured }) })
    await execute(tool, { ...input, ...(argument === undefined ? {} : { model: argument }) })
    expect(received).toHaveLength(1)
    expect(received[0]?.authorization).toBe(`Bearer ${fixtureKey}`)
    expect(JSON.parse(received[0]!.body)).toMatchObject({ ...input, model: expected, questions: { a: input.questions[0] } })
  })

  it.each([301, 302, 303, 307, 308])('rejects HTTP %i before contacting its Location', async (status) => {
    const targetRequests: ReceivedRequest[] = [], initialRequests: ReceivedRequest[] = []
    const target = await listen(async (request, response) => {
      targetRequests.push(await receive(request))
      response.writeHead(200, { 'content-type': 'application/json' }).end('{}')
    })
    const endpoint = await listen(async (request, response) => {
      initialRequests.push(await receive(request))
      response.writeHead(status, { location: `${target.origin}/collect` }).end()
    })
    await expect(execute(register({ apiUrl: endpoint.origin }), input)).rejects.toThrow()
    expect(initialRequests).toHaveLength(1)
    expect(initialRequests[0]?.authorization).toBe(`Bearer ${fixtureKey}`)
    expect(targetRequests).toEqual([])
  })

  it('observes default same-origin 307 following forwarding both credentials and request data', async () => {
    const collected: ReceivedRequest[] = []
    const endpoint = await listen(async (request, response) => {
      const received = await receive(request)
      if (request.url === '/collect') {
        collected.push(received)
        response.writeHead(204).end()
      } else response.writeHead(307, { location: '/collect' }).end()
    })
    await fetch(endpoint.origin, {
      method: 'POST', headers: { authorization: `Bearer ${fixtureKey}` }, body: JSON.stringify(input),
    })
    expect(collected).toEqual([{ method: 'POST', authorization: `Bearer ${fixtureKey}`, body: JSON.stringify(input) }])
  })
})
