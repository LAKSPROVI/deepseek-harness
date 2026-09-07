/** Durable prompt-library settings shared by the Host registration and browser client. */

import z from '@deepseek-ai/schemastery'

/** Settings namespace owned by this package. */
export const PROMPT_LIBRARY_SETTINGS_NAMESPACE = 'prompt-library'
/** Maximum saved prompt count. */
export const MAX_PROMPT_COUNT = 100
/** Maximum title length in UTF-16 code units. */
export const MAX_PROMPT_TITLE_CHARS = 120
/** Maximum body length in UTF-16 code units. */
export const MAX_PROMPT_BODY_CHARS = 12_000
/** Maximum combined title and body length across the complete library. */
export const MAX_PROMPT_AGGREGATE_CHARS = 200_000
/** Maximum stable prompt id length. */
export const MAX_PROMPT_ID_CHARS = 80

/** One ordered saved prompt. */
export interface SavedPrompt {
  /** Stable identity retained across edits and ordering changes. */
  id: string
  /** Human-facing prompt name. */
  title: string
  /** Text inserted into the conversation draft. */
  body: string
}

/** Complete durable namespace section. Array order is display order. */
export interface PromptLibrarySettings {
  prompts: SavedPrompt[]
}

/** Durable prompt-library schema. Aggregate and uniqueness limits use the namespace validator. */
export const PromptLibrarySettingsSchema: z<PromptLibrarySettings> = z.object({
  prompts: z.array(z.object({
    id: z.string().min(1).max(MAX_PROMPT_ID_CHARS).required(),
    title: z.string().min(1).max(MAX_PROMPT_TITLE_CHARS).required(),
    body: z.string().min(1).max(MAX_PROMPT_BODY_CHARS).required(),
  })).max(MAX_PROMPT_COUNT).default([]),
})

/**
 * Validate constraints that the serialized schema cannot express.
 * @param value - schema-valid resolved namespace section.
 */
export function validatePromptLibrarySettings(value: PromptLibrarySettings): void {
  const ids = new Set<string>()
  let aggregate = 0
  for (const prompt of value.prompts) {
    if (prompt.id.trim() === '') throw new TypeError('prompt id must not be blank')
    if (prompt.title.trim() === '') throw new TypeError('prompt title must not be blank')
    if (prompt.body.trim() === '') throw new TypeError('prompt body must not be blank')
    if (ids.has(prompt.id)) throw new TypeError(`duplicate prompt id: ${prompt.id}`)
    ids.add(prompt.id)
    aggregate += prompt.title.length + prompt.body.length
  }
  if (aggregate > MAX_PROMPT_AGGREGATE_CHARS) {
    throw new TypeError(`prompt library exceeds ${String(MAX_PROMPT_AGGREGATE_CHARS)} aggregate characters`)
  }
}

/**
 * Whether insertion should warn that the body begins with a slash command.
 * @param body - saved prompt body.
 * @returns whether the first non-whitespace character is `/`.
 */
export function beginsWithSlashCommand(body: string): boolean {
  return body.trimStart().startsWith('/')
}

/**
 * Compose one saved body into the current draft without submitting it.
 * @param draft - current unsent composer text.
 * @param body - selected saved prompt body.
 * @returns the replacement draft text.
 */
export function insertPromptBody(draft: string, body: string): string {
  return draft === '' ? body : `${draft}\n\n${body}`
}
