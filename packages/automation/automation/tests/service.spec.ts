import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import { StaleTaskReaper } from '../src/reaper.ts'
import { AutomationScheduler } from '../src/scheduler.ts'
import AutomationService from '../src/service.ts'

let root: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'dsh-automation-service-'))
})

afterEach(async () => {
  vi.restoreAllMocks()
  await rm(root, { recursive: true, force: true })
})

const dto = {
  userId: 'host',
  title: 'Tarefa do serviço',
  scheduleType: 'INTERVAL' as const,
  scheduleExpr: '3600',
  actionType: 'NOOP',
}

function silentEngine() {
  return {
    schedulerStart: vi.spyOn(AutomationScheduler.prototype, 'start').mockImplementation(() => {}),
    schedulerStop: vi.spyOn(AutomationScheduler.prototype, 'stop').mockImplementation(() => {}),
    reaperStart: vi.spyOn(StaleTaskReaper.prototype, 'start').mockImplementation(() => {}),
    reaperStop: vi.spyOn(StaleTaskReaper.prototype, 'stop').mockImplementation(() => {}),
  }
}

describe('AutomationService lifecycle', () => {
  it('starts the scheduler and reaper by default and stops both when the plugin unloads', async () => {
    const spies = silentEngine()
    const ctx = new Context()
    const fiber = ctx.plugin(AutomationService, { storePath: join(root, 'store.json') })
    await fiber
    expect(spies.schedulerStart).toHaveBeenCalledOnce()
    expect(spies.reaperStart).toHaveBeenCalledOnce()
    expect(ctx.automation.owner).toBe('host')

    await fiber.dispose()
    expect(spies.schedulerStop).toHaveBeenCalledOnce()
    expect(spies.reaperStop).toHaveBeenCalledOnce()
  })
})

describe('AutomationService Remote controls', () => {
  function build() {
    silentEngine()
    const ctx = new Context()
    return { ctx, service: new AutomationService(ctx, { storePath: join(root, 'store.json'), userId: 'owner' }) }
  }

  it('lists, pauses and resumes owned tasks through the Remote methods', async () => {
    const { service } = build()
    const task = await service.store.createTask({ ...dto, userId: 'owner' })
    expect((await service.list()).map(view => view.id)).toEqual([task.id])
    expect((await service.pause(task.id)).status).toBe('PAUSED')
    expect((await service.resume(task.id)).status).toBe('ACTIVE')
    expect((await service.pauseTask(task.id)).status).toBe('PAUSED')
    expect((await service.resumeTask(task.id)).status).toBe('ACTIVE')
    expect((await service.taskView(task.id)).id).toBe(task.id)

    // A task without model fields queues a job that carries none of them.
    const executeJob = vi.spyOn(service.worker, 'executeJob').mockResolvedValue(undefined)
    const receipt = await service.trigger(task.id)
    expect(executeJob).toHaveBeenCalledWith(expect.objectContaining({ runId: receipt.runId }))
    const [job] = executeJob.mock.calls[0]!
    expect(job).not.toHaveProperty('model')
    expect(job).not.toHaveProperty('modelProvider')
    expect(job).not.toHaveProperty('promptTemplate')
  })

  it('converts an owner check failure into the automation/not-found Remote error', async () => {
    const { service } = build()
    const foreign = await service.store.createTask({ ...dto, userId: 'someone-else' })
    for (const call of [service.trigger(foreign.id), service.pause(foreign.id), service.resume('missing')]) {
      const error = await call.catch((caught: unknown) => caught)
      expect(error).toBeInstanceOf(RemoteError)
      expect((error as RemoteError).code).toBe('automation/not-found')
    }
  })

  it('lets unexpected failures through the Remote methods untouched', async () => {
    const { service } = build()
    const task = await service.store.createTask({ ...dto, userId: 'owner' })
    vi.spyOn(service.store, 'updateTask').mockRejectedValue(new Error('disco cheio'))
    await expect(service.pause(task.id)).rejects.toThrow('disco cheio')
  })

  it('queues a manual run carrying the model fields and logs a worker failure', async () => {
    const { ctx, service } = build()
    const task = await service.store.createTask({
      ...dto,
      userId: 'owner',
      model: 'deepseek-chat',
      modelProvider: 'deepseek',
      promptTemplate: 'Faça X',
    })
    let settled: () => void = () => {}
    const failed = new Promise<void>((resolve) => {
      settled = resolve
    })
    const executeJob = vi.spyOn(service.worker, 'executeJob').mockImplementation(() => {
      const failure = Promise.reject(new Error('worker quebrou'))
      void failure.catch(() => { queueMicrotask(settled) })
      return failure
    })
    const logError = vi.spyOn(ctx.logger, 'error').mockImplementation(() => {})

    const receipt = await service.trigger(task.id)
    expect((await service.store.getRun(receipt.runId))?.taskId).toBe(task.id)
    expect(executeJob).toHaveBeenCalledWith(expect.objectContaining({
      runId: receipt.runId,
      model: 'deepseek-chat',
      modelProvider: 'deepseek',
      promptTemplate: 'Faça X',
    }))
    await failed
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(logError).toHaveBeenCalledWith('automation manual run failed', expect.any(Error))
  })

  it('deletes an owned task only after the ownership check', async () => {
    const { service } = build()
    const task = await service.store.createTask({ ...dto, userId: 'owner' })
    const foreign = await service.store.createTask({ ...dto, userId: 'someone-else' })
    await expect(service.deleteTask(foreign.id)).rejects.toThrow('not found')
    expect(await service.deleteTask(task.id)).toBe(true)
    expect(await service.store.getTask(foreign.id)).not.toBeNull()
  })
})
