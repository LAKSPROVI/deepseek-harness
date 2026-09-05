/** Client-safe Agent Teams data and projection types. */

export type * from './types.ts'
export type { SavedTeamTemplate, TeamTemplateSettings } from './templates.ts'
export {
  MAX_TEAM_TEMPLATE_COUNT,
  normalizeTeamMemberName,
  TEAM_TEMPLATE_SETTINGS_NAMESPACE,
  TeamTemplateSettingsSchema,
  validateTeamTemplateSettings,
} from './templates.ts'
