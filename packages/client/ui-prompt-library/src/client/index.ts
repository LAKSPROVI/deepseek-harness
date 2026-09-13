/** Browser plugin for durable prompt-library CRUD and composer insertion. */

import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type { BoundActions } from '@deepseek-ai/dsh-client-ui-slots'
import {
  PROMPT_LIBRARY_SETTINGS_NAMESPACE, type PromptLibrarySettings, type SavedPrompt,
} from '../prompt-settings.ts'
import { PromptLibrarySettingsSection } from './PromptLibrarySettingsSection.tsx'
import { PromptLibraryLauncher } from './PromptLibraryLauncher.tsx'
import { PromptLibraryOverlay } from './PromptLibraryOverlay.tsx'
import { en, NS, zh } from './locales.ts'
import { createPromptLibraryStore } from './store.ts'
import type { PromptLibraryInjected } from './slots.ts'
import { validatePromptList } from './validation.ts'

export { createPromptLibraryStore } from './store.ts'
export type { PromptLibraryInjected } from './slots.ts'

/** Services read by apply and its registration inject factories. */
export const inject = ['slots', 'locale', 'settingsScope']

/** Build a stable id without relying on storage or a process-global counter. */
function nextPromptId(sequence: number): string {
  return `prompt-${Date.now().toString(36)}-${sequence.toString(36)}`
}

/**
 * Install the shared store, settings binding, dictionaries, and three slot entries.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  const scope = ctx.settingsScope.bind<PromptLibrarySettings>({ namespace: PROMPT_LIBRARY_SETTINGS_NAMESPACE })
  const handle = createPromptLibraryStore()
  const store = handle.create()
  const actions: BoundActions<typeof handle> = store.actions
  let sequence = 0
  const sync = (): void => { actions.sync(scope.getSnapshot()) }
  sync()
  ctx.effect(() => scope.subscribe(sync), 'ui-prompt-library: settings projection')
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-prompt-library: dictionaries')

  const persist = async (prompts: SavedPrompt[]): Promise<void> => {
    const validation = validatePromptList(prompts)
    if (!validation.ok) throw new TypeError(validation.key)
    actions.beginSave()
    try {
      await scope.set('prompts', prompts)
      sync()
    } catch {
      actions.failSave('error.save')
      throw new Error('prompt library write failed')
    }
  }
  const current = (): SavedPrompt[] => store.getSnapshot().prompts
  const face: PromptLibraryInjected = {
    hooks: { promptLibrary: store },
    createPrompt: async (title, body) => {
      sequence += 1
      await persist([...current(), { id: nextPromptId(sequence), title, body }])
    },
    updatePrompt: async (id, title, body) => {
      await persist(current().map(prompt => prompt.id === id ? { ...prompt, title, body } : prompt))
    },
    deletePrompt: async (id) => { await persist(current().filter(prompt => prompt.id !== id)) },
    setOverlayOpen: (open) => { actions.setOverlayOpen(open) },
  }
  const registration = { locale: NS, inject: () => face } as const

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section', id: 'prompt-library', order: 30, label: () => ctx.locale.bind(NS)('nav'), ...registration,
  }, PromptLibrarySettingsSection))
  ctx.slots.inject('conversation.input.left', () => ctx.slots.register({
    name: 'conversation.input.left', id: 'prompt-library', order: 30, ...registration,
  }, PromptLibraryLauncher))
  ctx.slots.inject('conversation.input.overlay', () => ctx.slots.register({
    name: 'conversation.input.overlay', id: 'prompt-library', order: 30, ...registration,
  }, PromptLibraryOverlay))
}
