import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { expect, it, onTestFinished } from 'vitest'
import * as router from '../src/router-sync.ts'

it('requests one fresh confirmation for an expired model and honors cancellation', async () => {
  const home = await mkdtemp(join(tmpdir(), 'router-revalidate-'))
  onTestFinished(() => rm(home, { recursive: true, force: true }))
  await writeFile(join(home, 'router-live-catalog.enabled'), '1')
  const now = Date.now(); const iso = (n: number) => new Date(n).toISOString()
  const state = { schema: 2, ok: true, scope: { api: 'openai-completions' }, models: [{ model: { id: 'A' }, evidence: { available: true, kind: 'chat', checked_at: iso(now - 1000), expires_at: iso(now - 1), protocols: { openai: 'proved' }, capabilities: { text: 'proved', tools: 'proved', openaiTools: 'proved', openaiStream: 'proved' } } }] }
  const file = join(home, 'sync-9router-models-state.json'); await writeFile(file, JSON.stringify(state))
  const pending = router.confirmRouterModel(home, 'A')
  await expect.poll(async () => { try { return JSON.parse(await readFile(join(home, 'sync-9router-models-request.json'), 'utf8')).requestId } catch { return undefined } }).toBeTruthy()
  state.models[0]!.evidence.expires_at = iso(now + 5000); await writeFile(file, JSON.stringify(state))
  expect(await pending).toBe(true)
  state.models[0]!.evidence.expires_at = iso(now - 1); await writeFile(file, JSON.stringify(state))
  const abort = new AbortController(); const cancelled = router.confirmRouterModel(home, 'A', abort.signal)
  abort.abort()
  await expect(cancelled).rejects.toMatchObject({ name: 'AbortError' })
  expect(JSON.parse(await readFile(file, 'utf8')).models[0].evidence.expires_at).toBe(iso(now - 1))
})
