/**
 * 9Router synchronization: home resolution, degraded state files, and the
 * script trigger over a mocked child process.
 */

import { randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'

const fsMock = vi.hoisted(() => ({
  /** Paths `existsSync` reports as present on top of the real filesystem. */
  present: new Set<string>(),
  /** The Windows install path is answered from `present` alone, whatever this machine has. */
  winDefault: 'D:\\APLICATIVOS\\DeepSeek Harness\\home',
  /** When set, the next `readFile` rejects with this value instead of reading. */
  readFileRejection: undefined as unknown,
}))

const childProcessMock = vi.hoisted(() => ({
  /** Called with the requested file and args; return the value the callback receives as its error. */
  execFile: vi.fn<(file: string, args: readonly string[]) => unknown>(() => undefined),
}))

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return {
    ...actual,
    existsSync: (path: string) =>
      path === fsMock.winDefault ? fsMock.present.has(path) : fsMock.present.has(path) || actual.existsSync(path),
  }
})

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...actual,
    readFile: (...args: Parameters<typeof actual.readFile>) => {
      if (fsMock.readFileRejection !== undefined) {
        const rejection = fsMock.readFileRejection
        fsMock.readFileRejection = undefined
        // oxlint-disable-next-line typescript/prefer-promise-reject-errors -- the String(error) branch needs a non-Error reason.
        return Promise.reject(rejection)
      }
      return actual.readFile(...args)
    },
  }
})

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>()
  return {
    ...actual,
    execFile: (
      file: string,
      args: readonly string[],
      _options: unknown,
      callback: (error: unknown, stdout: string, stderr: string) => void,
    ) => {
      const error = childProcessMock.execFile(file, args)
      queueMicrotask(() => { callback(error, '', '') })
      return {} as import('node:child_process').ChildProcess
    },
  }
})

const { executeRouterSync, readRouterSyncStatus, resolveDshHome } = await import('../src/router-sync.ts')
const { default: LlmRuntime } = await import('../src/index.ts')

async function freshHome(): Promise<string> {
  const dir = join(tmpdir(), `dsh-router-sync-${randomUUID()}`)
  await mkdir(join(dir, 'scripts'), { recursive: true })
  return dir
}

const WIN_DEFAULT = fsMock.winDefault

function setPlatform(platform: NodeJS.Platform) {
  Object.defineProperty(process, 'platform', { value: platform, configurable: true })
}

describe('resolveDshHome', () => {
  const realPlatform = process.platform

  afterEach(() => {
    setPlatform(realPlatform)
    vi.unstubAllEnvs()
    fsMock.present.clear()
  })

  it('prefers an explicit override, then DSH_HOME, then the Windows install, then ~/.dsh', () => {
    vi.stubEnv('DSH_HOME', 'C:\\from-env')
    expect(resolveDshHome('C:\\override')).toBe('C:\\override')
    expect(resolveDshHome('')).toBe('C:\\from-env')

    vi.stubEnv('DSH_HOME', '')
    setPlatform('win32')
    fsMock.present.add(WIN_DEFAULT)
    expect(resolveDshHome()).toBe(WIN_DEFAULT)

    fsMock.present.clear()
    expect(resolveDshHome()).toBe(join(homedir(), '.dsh'))

    setPlatform('linux')
    fsMock.present.add(WIN_DEFAULT)
    expect(resolveDshHome()).toBe(join(homedir(), '.dsh'))
  })
})

describe('readRouterSyncStatus degraded inputs', () => {
  it('keeps defaults for fields of the wrong type and an unparsable timestamp', async () => {
    const home = await freshHome()
    await writeFile(join(home, 'sync-9router-models-state.json'), JSON.stringify({
      synchronizedAt: 'not-a-date',
      monitorUpdatedAt: 7,
      totalRoutes: '1',
      availableRoutes: null,
      publishedChatModels: [],
    }), 'utf8')
    const status = await readRouterSyncStatus(home)
    expect(status).toEqual({
      synchronizedAt: 'not-a-date',
      totalRoutes: 0,
      availableRoutes: 0,
      publishedChatModels: 0,
      isStale: true,
    })

    await writeFile(join(home, 'sync-9router-models-state.json'), JSON.stringify({ totalRoutes: 5 }), 'utf8')
    expect(await readRouterSyncStatus(home)).toEqual({ totalRoutes: 5, availableRoutes: 0, publishedChatModels: 0, isStale: true })
  })

  it('reports an unreadable state file and ignores a log without a failure line', async () => {
    const home = await freshHome()
    await writeFile(join(home, 'sync-9router-models-state.json'), '{not json', 'utf8')
    await mkdir(join(home, 'logs'), { recursive: true })
    await writeFile(join(home, 'logs', 'sync-9router-models.log'), 'sync start\nsync done\n', 'utf8')
    const status = await readRouterSyncStatus(home)
    expect(status.error).toMatch(/JSON/)
    expect(status.totalRoutes).toBe(0)
  })

  it('stringifies a non-Error state read failure', async () => {
    const home = await freshHome()
    await writeFile(join(home, 'sync-9router-models-state.json'), '{}', 'utf8')
    fsMock.readFileRejection = 'permission denied'
    const status = await readRouterSyncStatus(home)
    expect(status.error).toBe('permission denied')
  })
})

describe('executeRouterSync', () => {
  const realPlatform = process.platform

  afterEach(() => {
    setPlatform(realPlatform)
    childProcessMock.execFile.mockReset()
    childProcessMock.execFile.mockImplementation(() => undefined)
  })

  it('runs the Node script under the resolved home and returns the refreshed status', async () => {
    const home = await freshHome()
    const script = join(home, 'scripts', 'sync-9router-models.mjs')
    await writeFile(script, '', 'utf8')
    const status = await executeRouterSync(home)
    expect(childProcessMock.execFile).toHaveBeenCalledWith(process.execPath, [script])
    expect(status).not.toHaveProperty('error')
    expect(status.isStale).toBe(true)
  })

  it('reports a failing Node script, whether it fails with an Error or a bare value', async () => {
    const home = await freshHome()
    await writeFile(join(home, 'scripts', 'sync-9router-models.mjs'), '', 'utf8')
    childProcessMock.execFile.mockImplementationOnce(() => new Error('exit 1'))
    expect((await executeRouterSync(home)).error).toBe('exit 1')
    childProcessMock.execFile.mockImplementationOnce(() => 'timeout')
    expect((await executeRouterSync(home)).error).toBe('timeout')
  })

  it('falls back to the PowerShell script on Windows only', async () => {
    const home = await freshHome()
    const script = join(home, 'scripts', 'sync-9router-models.ps1')
    await writeFile(script, '', 'utf8')

    setPlatform('linux')
    expect((await executeRouterSync(home)).error).toBe('Synchronization script not found in DSH_HOME/scripts')
    expect(childProcessMock.execFile).not.toHaveBeenCalled()

    setPlatform('win32')
    expect((await executeRouterSync(home))).not.toHaveProperty('error')
    expect(childProcessMock.execFile).toHaveBeenCalledWith('powershell.exe', expect.arrayContaining(['-File', script]))

    childProcessMock.execFile.mockImplementationOnce(() => new Error('ps1 failed'))
    expect((await executeRouterSync(home)).error).toBe('ps1 failed')
    childProcessMock.execFile.mockImplementationOnce(() => 'ps1 timeout')
    expect((await executeRouterSync(home)).error).toBe('ps1 timeout')
  })

  it('reports a missing script when neither variant exists', async () => {
    const home = await freshHome()
    expect((await executeRouterSync(home)).error).toBe('Synchronization script not found in DSH_HOME/scripts')
  })
})

describe('LlmService Remote methods', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('read and trigger the synchronization under the process home', async () => {
    const home = await freshHome()
    vi.stubEnv('DSH_HOME', home)
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    expect((await ctx.llm.routerSyncStatus()).totalRoutes).toBe(0)
    expect((await ctx.llm.triggerRouterSync()).error).toBe('Synchronization script not found in DSH_HOME/scripts')
  })
})
