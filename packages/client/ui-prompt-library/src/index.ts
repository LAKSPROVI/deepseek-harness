/** Host registration for the durable prompt-library settings namespace. */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-settings'
import {
  PROMPT_LIBRARY_SETTINGS_NAMESPACE, PromptLibrarySettingsSchema, validatePromptLibrarySettings,
} from './prompt-settings.ts'

export {
  MAX_PROMPT_AGGREGATE_CHARS, MAX_PROMPT_BODY_CHARS, MAX_PROMPT_COUNT, MAX_PROMPT_TITLE_CHARS,
  PROMPT_LIBRARY_SETTINGS_NAMESPACE, type PromptLibrarySettings, type SavedPrompt,
} from './prompt-settings.ts'

/**
 * Register the prompt library when the optional settings service is composed.
 * @param ctx - Host context whose settings provider owns persistence.
 */
export function apply(ctx: Context): void {
  ctx.inject(['settings'], (settingsCtx) => {
    settingsCtx.settings.register(
      PROMPT_LIBRARY_SETTINGS_NAMESPACE,
      PromptLibrarySettingsSchema,
      { validate: validatePromptLibrarySettings },
    )
  })
}
