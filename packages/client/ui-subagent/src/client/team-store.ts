/** Apply-owned projection of reusable teammate template settings. */

import { defineStore, type SettingsScopeSnapshot } from '@deepseek-ai/dsh-client-runtime/client'
import type { SavedTeamTemplate, TeamTemplateSettings } from '../team-settings.ts'

/** Browser state for reusable teammate templates. */
export interface TeamTemplateState {
  status: 'loading' | 'ready' | 'unavailable'
  templates: SavedTeamTemplate[]
  writable: boolean
  saving: boolean
  error: string | null
}

/** Create the store mounted by the Agent Teams view registration. */
export function createTeamTemplateStore() {
  return defineStore({
    init: (): TeamTemplateState => ({
      status: 'loading', templates: [], writable: false, saving: false, error: null,
    }),
    actions: {
      sync: (draft, snapshot: SettingsScopeSnapshot<TeamTemplateSettings>) => {
        draft.status = snapshot.status
        draft.writable = snapshot.writable
        if (snapshot.value !== undefined) draft.templates = snapshot.value.templates
        draft.saving = false
        draft.error = null
      },
      beginSave: (draft) => { draft.saving = true; draft.error = null },
      failSave: (draft, message: string) => { draft.saving = false; draft.error = message },
    },
  })
}
