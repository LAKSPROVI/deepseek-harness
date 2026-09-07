/** Apply-owned prompt-library store shared by all three slot entries. */

import {
  defineStore, type EngineStoreHandle, type SettingsScopeSnapshot,
} from '@deepseek-ai/dsh-client-runtime/client'
import type { PromptLibrarySettings, SavedPrompt } from '../prompt-settings.ts'

/** Browser state projected from the settings namespace plus overlay interaction state. */
export interface PromptLibraryState {
  status: 'loading' | 'ready' | 'unavailable'
  prompts: SavedPrompt[]
  writable: boolean
  mode: 'host' | 'memory'
  saving: boolean
  error: string | null
  overlayOpen: boolean
}

type PromptLibraryActions = {
  sync: (draft: PromptLibraryState, snapshot: SettingsScopeSnapshot<PromptLibrarySettings>) => void
  setOverlayOpen: (draft: PromptLibraryState, open: boolean) => void
  beginSave: (draft: PromptLibraryState) => void
  failSave: (draft: PromptLibraryState, message: string) => void
}

/**
 * Declare the one apply-owned store shared by settings, launcher, and overlay entries.
 * @returns the store handle registered by each prompt-library slot entry.
 */
export function createPromptLibraryStore(): EngineStoreHandle<PromptLibraryState, PromptLibraryActions> {
  return defineStore({
    init: (): PromptLibraryState => ({
      status: 'loading', prompts: [], writable: false, mode: 'host', saving: false, error: null, overlayOpen: false,
    }),
    actions: {
      sync: (draft, snapshot: SettingsScopeSnapshot<PromptLibrarySettings>) => {
        draft.status = snapshot.status
        draft.writable = snapshot.writable
        draft.mode = snapshot.mode
        if (snapshot.value !== undefined) draft.prompts = snapshot.value.prompts
        draft.saving = false
        draft.error = null
      },
      setOverlayOpen: (draft, open: boolean) => { draft.overlayOpen = open },
      beginSave: (draft) => { draft.saving = true; draft.error = null },
      failSave: (draft, message: string) => { draft.saving = false; draft.error = message },
    },
  })
}
