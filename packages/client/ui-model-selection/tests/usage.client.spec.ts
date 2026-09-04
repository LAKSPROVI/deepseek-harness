// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ModelProviderGroup } from '@deepseek-ai/dsh-api-remotes/client'
import {
  getFrequentModels, loadModelUsage, MODEL_USAGE_KEY, recordModelUsage,
} from '../src/client/usage.ts'

const GROUPS: ModelProviderGroup[] = [
  {
    id: 'deepseek-official',
    name: 'DeepSeek',
    models: [
      { id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash' },
      { id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro', description: 'Advanced coding model' },
    ],
  },
  {
    id: 'openai',
    name: 'OpenAI',
    models: [
      { id: 'gpt-5', name: 'GPT-5' },
      { id: 'gpt-5-mini', name: 'GPT-5 Mini' },
    ],
  },
]

describe('usage model tracking', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => {
    localStorage.clear()
  })

  it('loads empty list when localStorage is empty or corrupt', () => {
    expect(loadModelUsage()).toEqual([])

    localStorage.setItem(MODEL_USAGE_KEY, 'invalid json')
    expect(loadModelUsage()).toEqual([])

    localStorage.setItem(MODEL_USAGE_KEY, JSON.stringify({ not: 'an array' }))
    expect(loadModelUsage()).toEqual([])

    localStorage.setItem(MODEL_USAGE_KEY, JSON.stringify([
      { provider: 123, model: 'gpt' },
      { provider: 'deepseek-official' },
      'string',
    ]))
    expect(loadModelUsage()).toEqual([])
  })

  it('records new and repeated model usage with count and recency sorting', () => {
    recordModelUsage('deepseek-official', 'deepseek-v4-flash')
    let records = loadModelUsage()
    expect(records).toHaveLength(1)
    expect(records[0]).toMatchObject({
      provider: 'deepseek-official',
      model: 'deepseek-v4-flash',
      count: 1,
    })

    // Record same model again -> count becomes 2
    recordModelUsage('deepseek-official', 'deepseek-v4-flash')
    records = loadModelUsage()
    expect(records[0]?.count).toBe(2)

    // Record another model 3 times -> becomes the top record
    recordModelUsage('openai', 'gpt-5')
    recordModelUsage('openai', 'gpt-5')
    recordModelUsage('openai', 'gpt-5')

    records = loadModelUsage()
    expect(records).toHaveLength(2)
    expect(records[0]).toMatchObject({ provider: 'openai', model: 'gpt-5', count: 3 })
    expect(records[1]).toMatchObject({ provider: 'deepseek-official', model: 'deepseek-v4-flash', count: 2 })
  })

  it('trims storage to maximum 20 records', () => {
    for (let i = 0; i < 25; i++) {
      recordModelUsage(`provider-${i}`, `model-${i}`)
    }
    const records = loadModelUsage()
    expect(records).toHaveLength(20)
  })

  it('resolves frequent models against active provider groups', () => {
    recordModelUsage('openai', 'gpt-5')
    recordModelUsage('deepseek-official', 'deepseek-v4-pro')
    recordModelUsage('deleted-provider', 'old-model')

    const frequent = getFrequentModels(GROUPS, 5)
    expect(frequent).toHaveLength(2)
    expect(frequent[0]?.group.id).toBe('openai')
    expect(frequent[0]?.model.id).toBe('gpt-5')
    expect(frequent[1]?.group.id).toBe('deepseek-official')
    expect(frequent[1]?.model.id).toBe('deepseek-v4-pro')
  })

  it('respects the limit parameter in getFrequentModels', () => {
    recordModelUsage('openai', 'gpt-5')
    recordModelUsage('deepseek-official', 'deepseek-v4-pro')
    recordModelUsage('deepseek-official', 'deepseek-v4-flash')

    const frequent = getFrequentModels(GROUPS, 2)
    expect(frequent).toHaveLength(2)
  })
})
