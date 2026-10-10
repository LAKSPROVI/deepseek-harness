import { writeFileSync } from 'node:fs'
import { expect, it, vi } from 'vitest'
import * as appBoot from '@deepseek-ai/dsh-app-boot'
import { configurationFixture } from './configuration-fixture.ts'


it('projects only the requested configuration before composing unrelated overrides', async () => {
  const { ctx, profile, start } = await configurationFixture({ hmr: false })
  await ctx.fiber.dispose()
  writeFileSync(profile.patchPath, JSON.stringify([{ id: 'second', config: { ordinary: 'second', count: 9 } }]))
  const restored = await start()
  const expected = restored.configEditor.configuration().find(row => row.entry.options.id === 'first')!
  const compose = vi.spyOn(appBoot, 'composeEntries')
  try {
    const rows = restored.configEditor.configuration('first')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toEqual(expected)
    expect(compose).toHaveBeenCalledTimes(1)
    compose.mockClear()
    expect(restored.configEditor.configuration('missing')).toEqual([])
    expect(compose).not.toHaveBeenCalled()
  } finally {
    compose.mockRestore()
  }
})

it('filters Settings reads before ConfigEditor computes unrelated inherited layers', async () => {
  const { ctx, profile, start } = await configurationFixture({ hmr: false })
  await ctx.fiber.dispose()
  writeFileSync(profile.patchPath, JSON.stringify([{ id: 'second', config: { ordinary: 'second', count: 9 } }]))
  const restored = await start()
  const compose = vi.spyOn(appBoot, 'composeEntries')
  try {
    const rows = restored.settings.describe({ ns: 'first', redactSecrets: true })
    expect(rows.map(row => row.ns)).toEqual(['first'])
    expect(rows[0]!.value).toMatchObject({ count: 2 })
    expect(rows[0]!.value).not.toHaveProperty('token')
    expect(compose).toHaveBeenCalledTimes(1)
    compose.mockClear()
    expect(restored.settings.describe({ ns: 'missing' })).toEqual([])
    expect(compose).not.toHaveBeenCalled()
  } finally {
    compose.mockRestore()
  }
})
