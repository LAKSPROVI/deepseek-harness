/** Durable reusable teammate templates shared by the Host and browser. */

import z from '@deepseek-ai/schemastery'

/** Settings namespace owned by the Agent Teams UI. */
export const TEAM_TEMPLATE_SETTINGS_NAMESPACE = 'agent-team-templates'
/** Maximum reusable teammate templates. */
export const MAX_TEAM_TEMPLATE_COUNT = 50

/** One reusable teammate configuration; attachments remain action-local. */
export interface SavedTeamTemplate {
  id: string
  title: string
  name: string
  description: string
  prompt: string
  context: 'fresh' | 'fork'
  llmProvider?: string
  model?: string
  persona?: string
}

/** Complete settings value for reusable teammate templates. */
export interface TeamTemplateSettings {
  templates: SavedTeamTemplate[]
}

/** Serialized validation for the reusable template namespace. */
export const TeamTemplateSettingsSchema: z<TeamTemplateSettings> = z.object({
  templates: z.array(z.object({
    id: z.string().min(1).max(80).required(),
    title: z.string().min(1).max(120).required(),
    name: z.string().min(1).max(120).required(),
    description: z.string().min(1).max(1_000).required(),
    prompt: z.string().min(1).max(20_000).required(),
    context: z.union(['fresh', 'fork']).required(),
    llmProvider: z.string().max(200),
    model: z.string().max(300),
    persona: z.string().max(12_000),
  })).max(MAX_TEAM_TEMPLATE_COUNT).default([]),
})

/**
 * Reject duplicate ids and incomplete explicit model routes.
 * @param value - schema-valid namespace value.
 */
export function validateTeamTemplateSettings(value: TeamTemplateSettings): void {
  const ids = new Set<string>()
  for (const template of value.templates) {
    if (ids.has(template.id)) throw new TypeError(`duplicate teammate template id: ${template.id}`)
    ids.add(template.id)
    if ((template.llmProvider === undefined) !== (template.model === undefined)) {
      throw new TypeError(`teammate template "${template.id}" must define provider and model together`)
    }
  }
}
