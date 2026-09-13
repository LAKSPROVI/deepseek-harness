import { Context } from '@deepseek-ai/cordis'
import { SettingsProvider, type SettingsNamespace } from '@deepseek-ai/dsh-settings'
import { describe, expect, it } from 'vitest'
import { apply } from '../src/index.ts'
import {
  MAX_PROMPT_AGGREGATE_CHARS, beginsWithSlashCommand, insertPromptBody,
  type SavedPrompt, validatePromptLibrarySettings,
} from '../src/prompt-settings.ts'

function prompt(id: string, title = `Title ${id}`, body = `Body ${id}`): SavedPrompt {
  return { id, title, body }
}

class MemorySettings extends SettingsProvider {
  readonly writable = true
  protected load(): Promise<Record<string, unknown>> { return Promise.resolve({}) }
  protected persist(_ns: SettingsNamespace, _section: Record<string, unknown>): Promise<void> {
    return Promise.resolve()
  }
}

describe('prompt-library contracts', () => {
  it('registers, validates, and disposes the Host namespace with its fiber', async () => {
    const ctx = new Context()
    await ctx.plugin(MemorySettings).await()
    const fiber = ctx.plugin({ apply })
    await fiber.await()
    const namespace = 'prompt-library' as SettingsNamespace
    expect(ctx.settings.get(namespace)).toEqual({ prompts: [] })
    await ctx.settings.update(namespace, { prompts: [prompt('one')] })
    expect(ctx.settings.get(namespace)).toEqual({ prompts: [prompt('one')] })
    await expect(ctx.settings.update(namespace, { prompts: [prompt('same'), prompt('same')] })).rejects.toThrow(/duplicate/)
    await fiber.dispose()
    expect(ctx.settings.describe().map(row => row.ns)).not.toContain(namespace)
  })
  it('enforces uniqueness and the complete aggregate limit at the Host namespace', () => {
    expect(() => { validatePromptLibrarySettings({ prompts: [prompt('same'), prompt('same')] }) }).toThrow(/duplicate prompt id/)
    expect(() => {
      validatePromptLibrarySettings({ prompts: [prompt('large', 'T', 'x'.repeat(MAX_PROMPT_AGGREGATE_CHARS))] })
    }).toThrow(/aggregate characters/)
  })

  it('inserts into an empty or occupied draft without any submit operation', () => {
    const inputActions = { setDraft: (text: string) => { draft = text }, submit: () => { submits += 1 } }
    let draft = ''
    let submits = 0
    inputActions.setDraft(insertPromptBody(draft, 'Saved body'))
    expect(draft).toBe('Saved body')
    inputActions.setDraft(insertPromptBody(draft, 'Second body'))
    expect(draft).toBe('Saved body\n\nSecond body')
    expect(submits).toBe(0)
    expect(beginsWithSlashCommand('  /compact')).toBe(true)
    expect(beginsWithSlashCommand('plain')).toBe(false)
  })
})
