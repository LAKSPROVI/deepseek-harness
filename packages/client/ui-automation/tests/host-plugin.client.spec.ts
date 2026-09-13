import { describe, expect, it } from 'vitest'
import { apply } from '../src/index.ts'

describe('automation panel host entry', () => {
  it('exports an applicable Cordis plugin body', () => {
    expect(() => {
      apply()
    }).not.toThrow()
  })
})
