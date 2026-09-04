/**
 * Subagent reference plugin, node half. Pure UI plugin: the empty apply
 * exists so the plugin appears in the host cordis.yml / Loader; the browser
 * half ships via exports["./client"], discovered through the package.json
 * dsh.client declaration.
 */

import type { Context } from '@deepseek-ai/cordis'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import {
  TEAM_TEMPLATE_SETTINGS_NAMESPACE, TeamTemplateSettingsSchema, validateTeamTemplateSettings,
} from './team-settings.ts'

/** Register reusable teammate templates when Host settings are available. */
export function apply(ctx: Context): void {
  ctx.inject(['settings'], (settingsCtx) => {
    settingsCtx.settings.register(
      settingsNamespace(TEAM_TEMPLATE_SETTINGS_NAMESPACE),
      TeamTemplateSettingsSchema,
      { validate: validateTeamTemplateSettings },
    )
  })
}
