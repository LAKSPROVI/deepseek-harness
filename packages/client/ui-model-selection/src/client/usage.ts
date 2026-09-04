/**
 * Model usage tracking in browser localStorage.
 * Records model selections so frequently used models appear at the beginning of the selection UI.
 */
import type { ModelProviderGroup } from '@deepseek-ai/dsh-api-remotes/client'

export const MODEL_USAGE_KEY = 'dsh.models.usage'

export interface ModelUsageRecord {
  readonly provider: string
  readonly model: string
  readonly count: number
  readonly lastUsed: number
}

export type ModelItem = ModelProviderGroup['models'][number]

export interface FrequentModelItem {
  readonly group: ModelProviderGroup
  readonly model: ModelItem
}

/**
 * Safely load model usage records from localStorage.
 * @returns parsed records sorted by count desc, then lastUsed desc.
 */
export function loadModelUsage(): readonly ModelUsageRecord[] {
  if (typeof localStorage === 'undefined') return []
  try {
    const raw = localStorage.getItem(MODEL_USAGE_KEY)
    if (raw === null) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    const records = parsed.filter((entry): entry is ModelUsageRecord =>
      typeof entry === 'object' && entry !== null
      && typeof (entry as Record<string, unknown>).provider === 'string'
      && typeof (entry as Record<string, unknown>).model === 'string'
      && typeof (entry as Record<string, unknown>).count === 'number'
      && typeof (entry as Record<string, unknown>).lastUsed === 'number',
    )
    return records.sort((a, b) => b.count - a.count || b.lastUsed - a.lastUsed)
  } catch {
    return []
  }
}

/**
 * Record one model usage into localStorage.
 * @param provider - provider id.
 * @param model - model id.
 */
export function recordModelUsage(provider: string, model: string): void {
  if (typeof localStorage === 'undefined') return
  try {
    const existing = loadModelUsage()
    const index = existing.findIndex(e => e.provider === provider && e.model === model)
    const updated: ModelUsageRecord[] = [...existing]
    const current = index >= 0 ? existing[index] : undefined
    if (current !== undefined) {
      updated[index] = {
        provider,
        model,
        count: current.count + 1,
        lastUsed: Date.now(),
      }
    } else {
      updated.push({
        provider,
        model,
        count: 1,
        lastUsed: Date.now(),
      })
    }
    updated.sort((a, b) => b.count - a.count || b.lastUsed - a.lastUsed)
    const trimmed = updated.slice(0, 20)
    localStorage.setItem(MODEL_USAGE_KEY, JSON.stringify(trimmed))
  } catch {
    // Storage quota or policy error silently swallowed
  }
}

/**
 * Resolve most frequently used models against the currently active provider groups.
 * @param groups - loaded provider groups from the directory.
 * @param limit - max number of frequent models to return (defaults to 5).
 * @returns array of resolved group and model pairs.
 */
export function getFrequentModels(
  groups: readonly ModelProviderGroup[],
  limit = 5,
): readonly FrequentModelItem[] {
  const records = loadModelUsage()
  if (records.length === 0) return []

  const result: FrequentModelItem[] = []
  for (const record of records) {
    if (result.length >= limit) break
    const group = groups.find(g => g.id === record.provider)
    if (group === undefined) continue
    const model = group.models.find(m => m.id === record.model)
    if (model === undefined) continue
    result.push({ group, model })
  }
  return result
}
