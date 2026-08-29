import { describe, expect, it } from 'vitest'
import {
  MAX_PROMPT_BODY_CHARS, MAX_PROMPT_COUNT, type SavedPrompt,
} from '../src/prompt-settings.ts'
import { createPromptLibraryStore } from '../src/client/store.ts'
import { validatePromptList } from '../src/client/validation.ts'

function prompt(id: string, title = `Title ${id}`, body = `Body ${id}`): SavedPrompt {
  return { id, title, body }
}

describe('prompt-library Client contracts', () => {
  it('enforces count and field limits before persistence', () => {
    expect(validatePromptList(Array.from({ length: MAX_PROMPT_COUNT }, (_, index) => prompt(String(index))))).toEqual({ ok: true })
    expect(validatePromptList(Array.from({ length: MAX_PROMPT_COUNT + 1 }, (_, index) => prompt(String(index))))).toEqual({
      ok: false, key: 'error.count', count: MAX_PROMPT_COUNT,
    })
    expect(validatePromptList([prompt('a', 'Title', 'x'.repeat(MAX_PROMPT_BODY_CHARS + 1))])).toEqual({
      ok: false, key: 'error.body', count: MAX_PROMPT_BODY_CHARS,
    })
  })

  it('projects persistence unavailability into the shared store', () => {
    const store = createPromptLibraryStore().create()
    store.actions.sync({
      status: 'unavailable', value: undefined, base: undefined, user: undefined,
      revision: undefined, writable: false, mode: 'memory',
    })
    expect(store.getSnapshot()).toMatchObject({
      status: 'unavailable', writable: false, mode: 'memory', prompts: [],
    })
  })
})
