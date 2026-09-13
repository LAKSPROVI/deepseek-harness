/** Real Loader composition coverage for the prompt-library Host registration. */

import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import {
  SettingsProvider, type SettingsNamespace,
} from '@deepseek-ai/dsh-settings'
import * as PromptLibrary from '../src/index.ts'

class MemorySettings extends SettingsProvider {
  readonly writable = true
  protected load(): Promise<Record<string, unknown>> { return Promise.resolve({}) }
  protected persist(_ns: SettingsNamespace, _section: Record<string, unknown>): Promise<void> {
    return Promise.resolve()
  }
}

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

async function loadComposition(): Promise<Context> {
  root = await mkdtemp(join(tmpdir(), 'dsh-prompt-library-composition-'))
  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, [
    '- id: settings',
    '  name: test-memory-settings',
    '- id: prompt-library',
    "  name: '@deepseek-ai/dsh-client-ui-prompt-library'",
    '',
  ].join('\n'))

  const ctx = new Context()
  context = ctx
  ctx.baseUrl = pathToFileURL(root).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['test-memory-settings', MemorySettings],
    ['@deepseek-ai/dsh-client-ui-prompt-library', PromptLibrary],
  ])
  ctx.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
      return modules.get(specifier)
    },
  } as unknown as NonNullable<typeof ctx.loader.internal>
  await ctx.loader.create({
    name: 'cordis:include',
    config: { path: pathToFileURL(configPath).href },
  })
  await ctx.loader.await()
  return ctx
}

describe('prompt-library real Loader composition', () => {
  it('boots from cordis.yml and exposes durable settings CRUD', { timeout: 60_000 }, async () => {
    const ctx = await loadComposition()
    const unloaded = [...ctx.loader.entries()]
      .filter(entry => entry.fiber === undefined && !entry.disabled)
      .map(entry => entry.options.name)
    expect(unloaded).toEqual([])

    const namespace = 'prompt-library' as SettingsNamespace
    expect(ctx.settings.get(namespace)).toEqual({ prompts: [] })
    await ctx.settings.update(namespace, {
      prompts: [{ id: 'review', title: 'Review', body: 'Review this change.' }],
    })
    expect(ctx.settings.get(namespace)).toEqual({
      prompts: [{ id: 'review', title: 'Review', body: 'Review this change.' }],
    })
  })
})
