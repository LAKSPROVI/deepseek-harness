import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'

import { apply, DEFAULT_JEV_MODEL, name, parseJevArgs } from '../src/index.ts'

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
})
