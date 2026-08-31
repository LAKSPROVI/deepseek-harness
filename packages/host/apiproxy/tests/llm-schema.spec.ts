import { describe, expect, it } from 'vitest'
import {
  discoveredModelViewSchema,
  llmDiscoverModelsValueSchema,
} from '../src/api/llm.schema.ts'

describe('llm.discoverModels schemas', () => {
  it('preserves canonical, empty, and absent modality metadata', () => {
    expect(llmDiscoverModelsValueSchema.parse({
      models: [
        { id: 'multimodal', inputModalities: ['text', 'image', 'file'] },
        { id: 'explicit-none', inputModalities: [] },
        { id: 'unknown' },
      ],
    })).toEqual({
      models: [
        { id: 'multimodal', inputModalities: ['text', 'image', 'file'] },
        { id: 'explicit-none', inputModalities: [] },
        { id: 'unknown' },
      ],
    })
  })

  it('rejects a modality outside the canonical vocabulary', () => {
    expect(() => discoveredModelViewSchema.parse({
      id: 'invalid',
      inputModalities: ['text', 'audio'],
    })).toThrow()
  })
})
