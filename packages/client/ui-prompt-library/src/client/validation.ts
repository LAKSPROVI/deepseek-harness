/** Client-side validation for immediate CRUD feedback before Host enforcement. */

import {
  MAX_PROMPT_AGGREGATE_CHARS, MAX_PROMPT_BODY_CHARS, MAX_PROMPT_COUNT, MAX_PROMPT_TITLE_CHARS,
  type SavedPrompt,
} from '../prompt-settings.ts'
import type { PromptLibraryKey } from './locales.ts'

/** Local validation result used by the editor and apply-owned mutations. */
export type PromptValidation =
  | { ok: true }
  | { ok: false; key: Extract<PromptLibraryKey, `error.${string}`>; count: number }

/**
 * Validate a candidate complete list against every user-facing bound.
 * @param prompts - complete ordered list after the proposed CRUD operation.
 * @returns success or the first deterministic validation failure.
 */
export function validatePromptList(prompts: readonly SavedPrompt[]): PromptValidation {
  if (prompts.length > MAX_PROMPT_COUNT) return { ok: false, key: 'error.count', count: MAX_PROMPT_COUNT }
  let aggregate = 0
  for (const prompt of prompts) {
    if (prompt.title.trim() === '' || prompt.title.length > MAX_PROMPT_TITLE_CHARS) {
      return { ok: false, key: 'error.title', count: MAX_PROMPT_TITLE_CHARS }
    }
    if (prompt.body.trim() === '' || prompt.body.length > MAX_PROMPT_BODY_CHARS) {
      return { ok: false, key: 'error.body', count: MAX_PROMPT_BODY_CHARS }
    }
    aggregate += prompt.title.length + prompt.body.length
  }
  if (aggregate > MAX_PROMPT_AGGREGATE_CHARS) {
    return { ok: false, key: 'error.aggregate', count: MAX_PROMPT_AGGREGATE_CHARS }
  }
  return { ok: true }
}
