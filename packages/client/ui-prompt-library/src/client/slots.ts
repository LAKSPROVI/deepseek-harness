/** Four-share component contracts for the prompt-library entries. */

import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import type { SavedPrompt } from '../prompt-settings.ts'
import type { PromptLibraryState } from './store.ts'
import type { NS } from './locales.ts'

/** Shared business face over the one apply-owned store. */
export interface PromptLibraryInjected {
  hooks: {
    /** Shared state bound by the renderer as usePromptLibrary. */
    promptLibrary: ObservableSnapshot<PromptLibraryState>
  }
  /** Persist a new prompt at the end of the ordered list. */
  createPrompt: (title: string, body: string) => Promise<void>
  /** Persist an edited prompt without changing its position. */
  updatePrompt: (id: string, title: string, body: string) => Promise<void>
  /** Remove one prompt. */
  deletePrompt: (id: string) => Promise<void>
  /** Open or close the shared composer overlay. */
  setOverlayOpen: (open: boolean) => void
}

/** Full settings-section props. */
export type PromptLibrarySettingsProps = PropsRuntime<'settings.section'>
  & PropsLocale<typeof NS> & InjectFace<PromptLibraryInjected>

/** Full compact-launcher props. */
export type PromptLibraryLauncherProps = PropsRuntime<'conversation.input.left'>
  & PropsLocale<typeof NS> & InjectFace<PromptLibraryInjected>

/** Full searchable-overlay props. */
export type PromptLibraryOverlayProps = PropsRuntime<'conversation.input.overlay'>
  & PropsLocale<typeof NS> & InjectFace<PromptLibraryInjected>

/** Editable fields kept local to the settings component. */
export type PromptDraft = Pick<SavedPrompt, 'title' | 'body'>
