import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { InMemoryAutomationStore } from '../src/store.ts'
import { AutomationController } from '../src/controller.ts'
import AutomationService from '../src/service.ts'

describe('AutomationController', () => {
  it('lists only the configured owner through JSON-safe task views', async () => {
    const store = new InMemoryAutomationStore()
    const own = await store.createTask({
      userId: 'host',
      title: 'Verificar prazos',
      scheduleType: 'INTERVAL',
      scheduleExpr: '60000',
      actionType: 'CUSTOM_PROMPT',
    })
    await store.createTask({
      userId: 'another-user',
      title: 'Privada',
      scheduleType: 'INTERVAL',
      scheduleExpr: '60000',
      actionType: 'CUSTOM_PROMPT',
    })
    const service = new AutomationController(store, { userId: 'host' })

    await expect(service.list()).resolves.toEqual([
      expect.objectContaining({
        id: own.id,
        title: 'Verificar prazos',
        createdAt: expect.any(String),
        nextRunAt: expect.any(String),
      }),
    ])
  })

  it('rejects a control action for a task outside the configured owner', async () => {
    const store = new InMemoryAutomationStore()
    const foreign = await store.createTask({
      userId: 'another-user',
      title: 'Privada',
      scheduleType: 'INTERVAL',
      scheduleExpr: '60000',
      actionType: 'CUSTOM_PROMPT',
    })
    const service = new AutomationController(store, { userId: 'host' })

    await expect(service.pause(foreign.id)).rejects.toThrow('not found')
  })

  it('binds the host service to the automations Remote namespace', () => {
    const ctx = new Context()
    const service = new AutomationService(ctx, {
      storePath: 'automation-test-store.json',
      enabled: false,
    })

    expect(service.typertRemote).toMatchObject({ serviceKey: 'automation', namespace: 'automations' })
  })
})

describe('resolveStorePath', () => {
  it('anchors a relative store path to the Harness home, not the process cwd', async () => {
    const { resolveStorePath } = await import('../src/service.ts')
    const { resolveDshHome } = await import('@deepseek-ai/dsh-home-paths')
    const { isAbsolute, join, resolve } = await import('node:path')
    const relative = resolveStorePath('./data/automation/store.json')
    expect(relative).toBe(join(resolveDshHome(), 'data/automation/store.json'))
    expect(relative).not.toBe(resolve('./data/automation/store.json'))
    const absolute = resolve('elsewhere/store.json')
    expect(resolveStorePath(absolute)).toBe(absolute)
    expect(isAbsolute(resolveStorePath('~/store.json'))).toBe(true)
  })
})
