/** Runtime invariant companion for the prompt-library settings relation. */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import {
  PROMPT_LIBRARY_SETTINGS_NAMESPACE, type PromptLibrarySettings, validatePromptLibrarySettings,
} from './prompt-settings.ts'

const PACKAGE_NAME = '@deepseek-ai/dsh-client-ui-prompt-library'

/** Cordis companion plugin name. */
export const name = 'client-ui-prompt-library-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/** Assert every committed prompt-library value still satisfies owner-only relations. */
const install: InvariantInstaller = (ctx, fail) => {
  ctx.on('settings/updated', (namespace, next) => {
    if (String(namespace) !== PROMPT_LIBRARY_SETTINGS_NAMESPACE) return
    try {
      validatePromptLibrarySettings(next as PromptLibrarySettings)
    } catch (error) {
      fail(error instanceof Error ? error.message : 'prompt-library settings are invalid')
    }
  })
}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
