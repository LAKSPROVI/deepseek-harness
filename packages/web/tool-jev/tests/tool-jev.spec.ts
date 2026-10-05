import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'

import { apply, DEFAULT_JEV_MODEL, formatJevOutput, name, parseJevArgs } from '../src/index.ts'

describe('tool-jev', () => {
  it('exposes the plugin name', () => {
    expect(name).toBe('tool-jev')
  })

  it('parses a valid request and defaults the model', () => {
    const parsed = parseJevArgs({
      state: 'Cliente diz que perdeu o prazo de embargos.',
      questions: [
        { name: 'critico', type: 'noul', instructions: 'The state describes a lost legal deadline' },
      ],
    })
    expect(parsed.model).toBe(DEFAULT_JEV_MODEL)
    expect(parsed.questions.critico?.type).toBe('noul')
  })

  it('rejects a blank state', () => {
    expect(() => parseJevArgs({ state: '   ', questions: [{ name: 'a', type: 'noul', instructions: 'x' }] }))
      .toThrow('state must be a non-blank string')
  })

  it('rejects a question with a bad primitive', () => {
    expect(() => parseJevArgs({
      state: 's',
      questions: [{ name: 'a', type: 'essay', instructions: 'x' }],
    })).toThrow('type must be choice, score, or noul')
  })

  it('requires criteria for choice and score', () => {
    expect(() => parseJevArgs({ state: 's', questions: [{ name: 'a', type: 'choice', instructions: 'x' }] }))
      .toThrow('requires a non-empty criteria object')
    expect(() => parseJevArgs({ state: 's', questions: [{ name: 'a', type: 'score', instructions: 'x' }] }))
      .toThrow('requires a non-empty criteria rubric array')
  })

  it('rejects a reused question name', () => {
    expect(() => parseJevArgs({
      state: 's',
      questions: [
        { name: 'a', type: 'noul', instructions: 'x' },
        { name: 'a', type: 'noul', instructions: 'y' },
      ],
    })).toThrow('question name "a" is reused')
  })

  it('registers the tool and calls the API with the parsed request', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      model: 'jev-1.13.0',
      answers: { a: { type: 'noul', noul: 0.99 } },
      usage: { input_tokens: 10, output_tokens: 1 },
    }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    process.env.TYPESAFE_API_KEY = 'test-key'

    const registered: Array<{ name: string; def: { execute: (args: unknown, exec: { signal: AbortSignal }) => Promise<unknown> } }> = []
    const ctx = {
      tools: {
        get: vi.fn(() => ({ })),
        register: vi.fn((definition: {
          name: string
          execute: (args: unknown, exec: { signal: AbortSignal }) => Promise<unknown>
        }) => { registered.push({ name: definition.name, def: definition }) }),
      },
    } as unknown as Context

    apply(ctx, {
      enabled: true, apiUrl: 'https://api.typesafe.ai/v1/systemone', model: DEFAULT_JEV_MODEL, timeoutMs: 5000,
    })

    expect(registered.map(t => t.name)).toEqual(['jev_decide'])
    const result = await registered[0]!.def.execute(
      {
        state: 'Cliente relata urgencia.',
        questions: [{ name: 'a', type: 'noul', instructions: 'The state conveys urgency' }],
      },
      { signal: new AbortController().signal },
    )
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(result).toMatchObject({ model: 'jev-1.13.0' })

    const sent = JSON.parse((fetchMock.mock.calls[0]![1] as { body: string }).body) as { state: string; questions: Record<string, unknown> }
    expect(sent.state).toBe('Cliente relata urgencia.')
    expect(Object.keys(sent.questions)).toEqual(['a'])

    vi.unstubAllGlobals()
    delete process.env.TYPESAFE_API_KEY
  })

  it('rejects every malformed questions shape', () => {
    expect(() => parseJevArgs({ state: 's' })).toThrow('questions must be a non-empty array')
    expect(() => parseJevArgs({ state: 's', questions: [] })).toThrow('questions must be a non-empty array')
    expect(() => parseJevArgs({ state: 's', questions: [42] })).toThrow('every question must be an object')
    expect(() => parseJevArgs({ state: 's', questions: [{ type: 'noul', instructions: 'x' }] }))
      .toThrow('every question requires a non-blank name')
    expect(() => parseJevArgs({ state: 's', questions: [{ name: 'a', type: 'noul', instructions: ' ' }] }))
      .toThrow('instructions must be non-blank')
    expect(() => parseJevArgs({ state: 42, questions: [{ name: 'a', type: 'noul', instructions: 'x' }] }))
      .toThrow('state must be a non-blank string')
  })

  it('treats non-string instructions as blank and accepts a valid score rubric', () => {
    expect(() => parseJevArgs({ state: 's', questions: [{ name: 'a', type: 'noul', instructions: 42 }] }))
      .toThrow('instructions must be non-blank')
    const parsed = parseJevArgs({
      state: 's',
      questions: [{ name: 'grade', type: 'score', instructions: 'How strong is the case?', criteria: ['weak', 'strong'] }],
    })
    expect(parsed.questions.grade?.criteria).toEqual(['weak', 'strong'])
  })

  it('keeps choice criteria as a named object and score criteria as a rubric array', () => {
    expect(() => parseJevArgs({
      state: 's', questions: [{ name: 'a', type: 'choice', instructions: 'x', criteria: [] }],
    })).toThrow('requires a non-empty criteria object')
    expect(() => parseJevArgs({
      state: 's', questions: [{ name: 'a', type: 'score', instructions: 'x', criteria: { weak: 'w' } }],
    })).toThrow('requires a non-empty criteria rubric array')
    const parsed = parseJevArgs({
      state: 's',
      questions: [{ name: 'pick', type: 'choice', instructions: 'x', criteria: { first: 'one', second: 'two' } }],
    })
    expect(parsed.questions.pick?.criteria).toEqual({ first: 'one', second: 'two' })
  })

  it('trims an explicit model and falls back on blank or non-string values', () => {
    const question = [{ name: 'a', type: 'noul', instructions: 'x' }]
    expect(parseJevArgs({ state: 's', model: ' custom ', questions: question }).model).toBe('custom')
    expect(parseJevArgs({ state: 's', model: '   ', questions: question }).model).toBe(DEFAULT_JEV_MODEL)
    expect(parseJevArgs({ state: 's', model: 42, questions: question }).model).toBe(DEFAULT_JEV_MODEL)
  })

  it('fences one answer set as a json document', () => {
    expect(formatJevOutput({ a: 1 })).toBe('```json\n{\n  "a": 1\n}\n```')
  })

  /** The registered-tool harness shared by the execute-path tests below. */
  interface RegisteredJevTool {
    name: string
    execute: (args: unknown, exec: { signal: AbortSignal }) => Promise<unknown>
    output: {
      render: (args: unknown, value: unknown) => Array<{ type: 'text'; text: string }>
      presentationMeta: () => { kind: string }
    }
    isConcurrencySafe: (args: unknown) => boolean
  }
  function registeredTool(config: Record<string, unknown>) {
    const registered: RegisteredJevTool[] = []
    const ctx = {
      tools: {
        get: vi.fn(() => ({})),
        register: vi.fn((definition: RegisteredJevTool) => { registered.push(definition) }),
      },
    } as unknown as Context
    apply(ctx, { model: DEFAULT_JEV_MODEL, ...config })
    return registered
  }

  it('skips registration when disabled and rejects a bad timeout budget', () => {
    expect(registeredTool({ enabled: false })).toEqual([])
    expect(() => registeredTool({ enabled: true, timeoutMs: 0 })).toThrow('timeoutMs must be a positive integer')
    expect(() => registeredTool({ enabled: true, timeoutMs: 1.5 })).toThrow('timeoutMs must be a positive integer')
    expect(registeredTool({ enabled: true }).length).toBe(1)
  })

  it('fails loudly without an API key and surfaces API errors', async () => {
    delete process.env.TYPESAFE_API_KEY
    const noKey = registeredTool({ enabled: true, timeoutMs: 5_000 })
    await expect(noKey[0]!.execute(
      { state: 's', questions: [{ name: 'a', type: 'noul', instructions: 'x' }] },
      { signal: new AbortController().signal },
    )).rejects.toThrow('TYPESAFE_API_KEY is not set')

    const fetchMock = vi.fn().mockResolvedValue(new Response('upstream exploded', { status: 503 }))
    vi.stubGlobal('fetch', fetchMock)
    process.env.TYPESAFE_API_KEY = 'test-key'
    const failing = registeredTool({ enabled: true, timeoutMs: 5_000 })
    await expect(failing[0]!.execute(
      { state: 's', questions: [{ name: 'a', type: 'noul', instructions: 'x' }] },
      { signal: new AbortController().signal },
    )).rejects.toThrow('TypeSafe API 503: upstream exploded')
    vi.unstubAllGlobals()
    delete process.env.TYPESAFE_API_KEY
  })

  it('defaults a missing model and missing answers in the tool output', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      usage: { input_tokens: 2, output_tokens: 1 },
    }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    process.env.TYPESAFE_API_KEY = 'test-key'
    const tool = registeredTool({ enabled: true, timeoutMs: 5_000 })
    const result = await tool[0]!.execute(
      { state: 's', questions: [{ name: 'a', type: 'noul', instructions: 'x' }] },
      { signal: new AbortController().signal },
    ) as { model: string; answersJson: string }
    expect(result.model).toBe('')
    expect(result.answersJson).toBe('{}')

    // The registered definition renders its fenced JSON output, reports a
    // generic presentation, and declares valid API reads concurrency-safe.
    const def = tool[0]!
    expect(def.output.render({}, { a: 1 })).toEqual([{ type: 'text', text: formatJevOutput({ a: 1 }) }])
    expect(def.output.presentationMeta()).toEqual({ kind: 'generic' })
    expect(def.isConcurrencySafe({
      state: 's',
      questions: [{ name: 'a', type: 'noul', instructions: 'x' }],
    })).toBe(true)
    expect(def.isConcurrencySafe({})).toBe(false)

    vi.unstubAllGlobals()
    delete process.env.TYPESAFE_API_KEY
  })
})
