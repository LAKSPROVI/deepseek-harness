import { promises as fs } from 'fs'
import * as os from 'os'
import * as path from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FileAutomationStore } from '../src/persistence'

const dto = {
  userId: 'user-file',
  title: 'Tarefa em arquivo',
  scheduleType: 'INTERVAL' as const,
  scheduleExpr: '60',
  actionType: 'NOOP',
}

describe('FileAutomationStore loading', () => {
  let dir: string
  let file: string

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-automation-'))
    file = path.join(dir, 'nested', 'automation.json')
  })

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true })
  })

  it('revives every date field, including the optional ones, from a written file', async () => {
    const writer = new FileAutomationStore(file)
    const task = await writer.createTask({
      ...dto,
      endAt: new Date('2030-01-01T00:00:00Z'),
    })
    await writer.updateTask(task.id, { lastRunAt: new Date('2026-01-01T00:00:00Z') })
    const run = await writer.createRun(task.id, new Date('2026-01-01T00:00:00Z'))
    await writer.updateRun(run.id, {
      status: 'SUCCESS',
      startedAt: new Date('2026-01-01T00:00:01Z'),
      finishedAt: new Date('2026-01-01T00:00:02Z'),
    })
    const notification = await writer.createNotification({
      taskId: task.id,
      runId: run.id,
      userId: dto.userId,
      level: 'SUCCESS',
      title: 't',
      message: 'm',
    })
    expect(await writer.markNotificationRead(notification.id)).toBe(true)
    expect(await writer.markNotificationRead('missing')).toBe(false)

    const reader = new FileAutomationStore(file)
    const revived = (await reader.getTask(task.id))!
    expect(revived.endAt).toBeInstanceOf(Date)
    expect(revived.lastRunAt).toBeInstanceOf(Date)
    expect(revived.nextRunAt).toBeInstanceOf(Date)
    const revivedRun = (await reader.getRun(run.id))!
    expect(revivedRun.startedAt).toBeInstanceOf(Date)
    expect(revivedRun.finishedAt).toBeInstanceOf(Date)
    const [revivedNotification] = await reader.listNotificationsByTask(task.id)
    expect(revivedNotification?.readAt).toBeInstanceOf(Date)
    expect(await reader.hasActiveRun(task.id)).toBe(false)
    expect(await reader.findDueTasks(new Date('2999-01-01T00:00:00Z'))).toHaveLength(1)
  })

  it('leaves optional dates unset when the file carries none of them', async () => {
    const writer = new FileAutomationStore(file)
    const task = await writer.createTask(dto)
    await writer.updateTask(task.id, { nextRunAt: null })
    const run = await writer.createRun(task.id, new Date())
    await writer.createNotification({
      taskId: task.id,
      runId: run.id,
      userId: dto.userId,
      level: 'INFO',
      title: 't',
      message: 'm',
    })

    const reader = new FileAutomationStore(file)
    const revived = (await reader.getTask(task.id))!
    expect(revived.endAt).toBeNull()
    expect(revived.lastRunAt).toBeNull()
    expect(revived.nextRunAt).toBeNull()
    const revivedRun = (await reader.getRun(run.id))!
    expect(revivedRun).not.toHaveProperty('startedAt')
    expect(revivedRun).not.toHaveProperty('finishedAt')
    const [revivedNotification] = await reader.listNotificationsByTask(task.id)
    expect(revivedNotification).not.toHaveProperty('readAt')
  })

  it('tolerates a file whose collections are missing', async () => {
    await fs.mkdir(path.dirname(file), { recursive: true })
    await fs.writeFile(file, JSON.stringify({}), 'utf-8')
    const store = new FileAutomationStore(file)
    expect(await store.listTasks()).toEqual([])
  })

  it('surfaces load failures other than a missing file', async () => {
    await fs.mkdir(path.dirname(file), { recursive: true })
    await fs.writeFile(file, '{not json', 'utf-8')
    const store = new FileAutomationStore(file)
    await expect(store.listTasks()).rejects.toThrow(SyntaxError)
  })

  it('does not persist deletes and reads that changed nothing', async () => {
    const store = new FileAutomationStore(file)
    expect(await store.deleteTask('missing')).toBe(false)
    await expect(fs.stat(file)).rejects.toMatchObject({ code: 'ENOENT' })
    const task = await store.createTask(dto)
    expect(await store.deleteTask(task.id)).toBe(true)
    expect(JSON.parse(await fs.readFile(file, 'utf-8'))).toMatchObject({ tasks: [] })
  })
})
