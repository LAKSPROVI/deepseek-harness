import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { main } from '../sync-router-live-models.mjs'

async function fixture(t, lifetime = 60000) {
  const home = await mkdtemp(join(tmpdir(), 'dsh-publication-sharing-'))
  await mkdir(join(home, 'profiles/web'), { recursive: true })
  await writeFile(join(home, 'profiles/web/cordis.patch.yml'), 'fixture profile')
  const stateFile = join(home, 'sync-9router-models-state.json')
  const previous = { ok: false, marker: 'original fixture' }
  await writeFile(stateFile, JSON.stringify(previous))
  const route = { api: 'openai-completions', baseURL: '', models: [] }
  const server = createServer(async (request, response) => {
    const url = new URL(request.url, route.baseURL)
    if (url.pathname === '/' && url.searchParams.get('token') === 'fixture') {
      response.writeHead(303, { 'set-cookie': 'fixture=fixture', location: '/' }); response.end(); return
    }
    if (url.pathname === '/v1/models') {
      const now = Date.now()
      response.end(JSON.stringify({ x_9r_catalog: { availability_mode: 'strict' }, data: [{ id: 'fixture/model', x_9r: { available: true, kind: 'chat', checked_at: new Date(now - 1).toISOString(), expires_at: new Date(now + lifetime).toISOString(), protocols: { openai: 'proved' }, capabilities: { text: 'proved', tools: 'proved', openaiTools: 'proved', openaiStream: 'proved' } } }] })); return
    }
    const chunks = []; for await (const chunk of request) chunks.push(chunk)
    const body = JSON.parse(Buffer.concat(chunks).toString())
    if (body.method === 'settings/mutate') route.models = body.payload.args.ops[0].value
    response.end(JSON.stringify({ type: 'server-response', result: { ok: true, value: { writable: true, namespaces: [{ ns: 'llm-pi-ai', revision: 1, value: { providers: { '9router': route } } }] } } }))
  })
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  t.after(() => new Promise(resolve => server.close(resolve)))
  route.baseURL = `http://127.0.0.1:${server.address().port}/v1`
  const launchLog = join(home, 'launch.log')
  await writeFile(launchLog, `${route.baseURL.replace('/v1', '')}/?token=fixture`)
  const keyName = 'DSH_PUBLICATION_FIXTURE_KEY', previousKey = process.env[keyName]
  process.env[keyName] = 'fixture'
  t.after(() => { if (previousKey === undefined) delete process.env[keyName]; else process.env[keyName] = previousKey })
  const run = () => main({ home, 'app-url': route.baseURL.replace('/v1', ''), 'catalog-url': route.baseURL, 'launch-log': launchLog, 'api-key-env': keyName }, [])
  return { home, stateFile, previous, run, cleanup: () => rm(home, { recursive: true, force: true }) }
}

async function sharingReader(t, file) {
  const code = "$ErrorActionPreference='Stop'; $s=[IO.File]::Open($env:DSH_SHARING_FIXTURE,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read); try{[Console]::Out.WriteLine('ready'); [Console]::Out.Flush(); [Console]::In.ReadLine()|Out-Null}finally{$s.Dispose()}"
  const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', code], { windowsHide: true, env: { ...process.env, DSH_SHARING_FIXTURE: file }, stdio: ['pipe', 'pipe', 'pipe'] })
  const closed = once(child, 'close')
  let ready = ''
  for await (const chunk of child.stdout) { ready += chunk.toString(); if (ready.includes('ready')) break }
  assert.ok(ready.includes('ready'), 'fixture reader started')
  let released = false
  const release = async () => { if (!released) { released = true; child.stdin.end('\n') }; await closed }
  t.after(release)
  return release
}

test('Windows publication survives a real reader denying rename and retains valid JSON until replacement', { skip: process.platform !== 'win32' }, async t => {
  const f = await fixture(t); const release = await sharingReader(t, f.stateFile)
  t.after(f.cleanup)
  const pending = f.run().then(result => ({ result }), error => ({ error }))
  await new Promise(resolve => setTimeout(resolve, 200))
  assert.deepEqual(JSON.parse(await readFile(f.stateFile, 'utf8')), f.previous)
  await new Promise(resolve => setTimeout(resolve, 450)); await release()
  const outcome = await pending
  if (outcome.error) throw outcome.error
  const result = outcome.result
  assert.equal(result.ok, true)
  assert.deepEqual(result.catalogModelIds, ['fixture/model'])
  assert.equal(JSON.parse(await readFile(f.stateFile, 'utf8')).ok, true)
  assert.equal((await readdir(f.home)).some(name => name.endsWith('.tmp')), false)
})

test('Windows permanent sharing denial fails within a bound and preserves the previous state without temporary files', { skip: process.platform !== 'win32' }, async t => {
  const f = await fixture(t); await sharingReader(t, f.stateFile); t.after(f.cleanup)
  const started = Date.now()
  await assert.rejects(f.run(), error => error.code === 'EPERM' && error.syscall === 'rename')
  assert.ok(Date.now() - started < 3000)
  assert.deepEqual(JSON.parse(await readFile(f.stateFile, 'utf8')), f.previous)
  assert.equal((await readdir(f.home)).some(name => name.endsWith('.tmp')), false)
  const failure = JSON.parse(await readFile(join(f.home, 'sync-9router-models-failure.json'), 'utf8'))
  assert.equal(failure.phase, 'state/write'); assert.equal(failure.reason, 'EPERM')
})

test('Windows sharing retry never publishes evidence that expired while the reader held the state', { skip: process.platform !== 'win32' }, async t => {
  const f = await fixture(t, 200); await sharingReader(t, f.stateFile); t.after(f.cleanup)
  await assert.rejects(f.run(), error => error.code === 'state_expired')
  assert.deepEqual(JSON.parse(await readFile(f.stateFile, 'utf8')), f.previous)
  assert.equal((await readdir(f.home)).some(name => name.endsWith('.tmp')), false)
})
