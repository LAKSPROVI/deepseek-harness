/** Durable reusable teammate templates and identifier normalization. */

import z from '@deepseek-ai/schemastery'

/** Settings namespace owned by the Agent Teams capability. */
export const TEAM_TEMPLATE_SETTINGS_NAMESPACE = 'agent-team-templates'
/** Maximum reusable teammate templates. */
export const MAX_TEAM_TEMPLATE_COUNT = 50
/** Maximum reusable team squads. */
export const MAX_TEAM_SQUAD_COUNT = 20

/** One reusable teammate configuration. */
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

/** One member role inside a reusable squad preset. */
export interface SavedSquadMember {
  name: string
  description: string
  prompt: string
  context: 'fresh' | 'fork'
  llmProvider?: string
  model?: string
  persona?: string
}

/** One multi-agent squad preset configuration. */
export interface SavedTeamSquad {
  id: string
  title: string
  description: string
  members: SavedSquadMember[]
}

/** Complete settings value for reusable teammate templates and squads. */
export interface TeamTemplateSettings {
  templates: SavedTeamTemplate[]
  squads?: SavedTeamSquad[]
}

const SquadMemberSchema = z.object({
  name: z.string().min(1).max(120).required(),
  description: z.string().min(1).max(1_000).required(),
  prompt: z.string().min(1).max(20_000).required(),
  context: z.union(['fresh', 'fork']).required(),
  llmProvider: z.string().max(200),
  model: z.string().max(300),
  persona: z.string().max(12_000),
})

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
  squads: z.array(z.object({
    id: z.string().min(1).max(80).required(),
    title: z.string().min(1).max(120).required(),
    description: z.string().min(1).max(1_000).required(),
    members: z.array(SquadMemberSchema).min(1).max(9).required(),
  })).max(MAX_TEAM_SQUAD_COUNT).default([]),
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

  if (value.squads !== undefined) {
    const squadIds = new Set<string>()
    for (const squad of value.squads) {
      if (squadIds.has(squad.id)) throw new TypeError(`duplicate squad preset id: ${squad.id}`)
      squadIds.add(squad.id)
      for (const member of squad.members) {
        if ((member.llmProvider === undefined) !== (member.model === undefined)) {
          throw new TypeError(`squad member "${member.name}" in "${squad.id}" must define provider and model together`)
        }
      }
    }
  }
}

/**
 * Convert a natural teammate label or name to the durable lower-kebab identity.
 * @param value - operator-entered or model-provided natural name.
 * @returns a lower-kebab id capped at 64 characters.
 */
export function normalizeTeamMemberName(value: string): string {
  return value.normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-+/g, '-')
    .slice(0, 64)
    .replace(/-+$/g, '')
}
