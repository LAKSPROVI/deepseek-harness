// @vitest-environment jsdom
/**
 * client-ui-automation browser half on a real cordis Context with fake slots
 * and Remote faces: the plugin mounts the automations namespace, registers the
 * header action with its documented id and order, and every injected callback
 * reaches the namespace through the injected scope — the outer Context never
 * carries `remote.automations`, so reading it there fails at first use.
 */
import { Context, Service } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup } from '@testing-library/react'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { AutomationActionProps } from '../src/client/types.ts'
import { apply, inject } from '../src/client/index.ts'

afterEach(cleanup)

const task = {
  id: 'task-1',
  title: 'Atualizar prazos',
  status: 'ACTIVE' as const,
  scheduleType: 'INTERVAL' as const,
  nextRunAt: null,
  lastRunAt: null,
  totalRunsCompleted: 0,
  maxRuns: null,
  createdAt: '2026-09-10T10:00:00.000Z',
  updatedAt: '2026-09-10T10:00:00.000Z',
}

/** Boot the plugin over fake faces; `$mount` provides the namespace the way api-remotes does. */
async function bench() {
  const ctx = new Context()
  const calls: string[] = []
  const automations = {
    list: () => { calls.push('list'); return Promise.resolve({ ok: true as const, value: [task] }) },
    trigger: (id: string) => { calls.push(`trigger:${id}`); return Promise.resolve({ ok: true as const, value: { runId: 'run-1' } }) },
    pause: (id: string) => { calls.push(`pause:${id}`); return Promise.resolve({ ok: true as const, value: { ...task, status: 'PAUSED' as const } }) },
    resume: (id: string) => { calls.push(`resume:${id}`); return Promise.resolve({ ok: true as const, value: task }) },
  }
  class RemoteService extends Service {
    constructor(serviceCtx: Context) {
      super(serviceCtx, 'remote')
    }

    $mount(): Promise<() => Promise<void>> {
      ctx.provide('remote.automations', automations)
      return Promise.resolve(async () => {})
    }
  }
  new RemoteService(ctx)
  ctx.provide('locale', new LocaleRuntime(ctx))
  await ctx.plugin(SlotRegistry).await()
  ctx.slots.register({
    name: 'root',
    children: { 'conversation.session.header.actions': { kind: 'list', scope: 'session' } },
  } as never, (() => null) as never)
  const fiber = ctx.plugin({ inject: [...inject], apply })
  await fiber.await()
  const entry = ctx.slots.entries('conversation.session.header.actions')[0]
  return { ctx, fiber, calls, entry, face: entry?.inject as unknown as (() => AutomationActionProps) | undefined }
}

describe('client-ui-automation browser plugin', () => {
  it('registers the header action with the documented id and order', async () => {
    const b = await bench()
    expect(inject).toEqual(['remote', 'slots', 'locale'])
    expect(b.entry?.options).toMatchObject({ id: 'automation', order: 30 })
    expect(b.face).toBeTypeOf('function')
  })

  it('reaches the automations namespace from every injected callback', async () => {
    const b = await bench()
    const face = b.face!()
    await expect(face.list()).resolves.toEqual([task])
    await expect(face.trigger('task-1')).resolves.toEqual({ runId: 'run-1' })
    await expect(face.pause('task-1')).resolves.toMatchObject({ status: 'PAUSED' })
    await expect(face.resume('task-1')).resolves.toEqual(task)
    expect(b.calls).toEqual(['list', 'trigger:task-1', 'pause:task-1', 'resume:task-1'])
  })

  it('takes the header action away when the plugin fiber is disposed', async () => {
    const b = await bench()
    expect(b.ctx.slots.entries('conversation.session.header.actions')).toHaveLength(1)
    await b.fiber.dispose()
    expect(b.ctx.slots.entries('conversation.session.header.actions')).toHaveLength(0)
  })
})
