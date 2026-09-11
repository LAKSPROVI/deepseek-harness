import { describe, it, expect } from 'vitest'
import { InMemoryAutomationStore } from '../src/store'
import { NotificationService } from '../src/notifier'
import { TaskWorker } from '../src/worker'
import { AutomationScheduler } from '../src/scheduler'

describe('Advanced Concurrency, Overlap Policy and Notifications', () => {
  it('respects SKIP overlap policy when previous run is still RUNNING', async () => {
    const store = new InMemoryAutomationStore()
    const notifier = new NotificationService(store)
    const worker = new TaskWorker(store, notifier)
    const scheduler = new AutomationScheduler(store, worker, 100)

    let resolveSlowTask: () => void = () => {}
    worker.registerHandler('SLOW_ASYNC_TASK', () => {
      return new Promise((resolve) => {
        resolveSlowTask = () => resolve({ completed: true })
      })
    })

    const targetTime = new Date()
    const task = await store.createTask({
      userId: 'user-overlap',
      title: 'Tarefa Lenta com Proteção de Sobreposição',
      scheduleType: 'INTERVAL',
      scheduleExpr: '10',
      actionType: 'SLOW_ASYNC_TASK',
      overlapPolicy: 'SKIP',
    })

    await store.updateTask(task.id, { nextRunAt: targetTime })

    // First tick dispatches
    const firstDispatch = await scheduler.tick(targetTime)
    expect(firstDispatch).toBe(1)

    // Wait slightly so worker marks as RUNNING
    await new Promise(r => setTimeout(r, 50))
    expect(await store.hasActiveRun(task.id)).toBe(true)

    // Second tick while still running should NOT dispatch a new run
    await store.updateTask(task.id, { nextRunAt: targetTime })
    const secondDispatch = await scheduler.tick(targetTime)
    expect(secondDispatch).toBe(0)

    // Resolve slow task
    resolveSlowTask()
    await new Promise(r => setTimeout(r, 50))

    expect(await store.hasActiveRun(task.id)).toBe(false)
    const runs = await store.listRunsByTask(task.id)
    expect(runs).toHaveLength(1)
    expect(runs[0]!.status).toBe('SUCCESS')
  })

  it('correctly lists and marks notifications as read', async () => {
    const store = new InMemoryAutomationStore()
    const notifier = new NotificationService(store)

    const notif = await notifier.notifyTaskFinished({
      taskId: 't-1',
      runId: 'r-1',
      userId: 'user-notifications',
      level: 'SUCCESS',
      title: 'Tarefa Pronta',
      message: 'A tarefa foi concluída com sucesso.',
    })

    const unread = await store.listNotifications('user-notifications', true)
    expect(unread).toHaveLength(1)
    expect(unread[0]!.isRead).toBe(false)

    const marked = await store.markNotificationRead(notif.id)
    expect(marked).toBe(true)

    const unreadAfter = await store.listNotifications('user-notifications', true)
    expect(unreadAfter).toHaveLength(0)

    const all = await store.listNotifications('user-notifications')
    expect(all).toHaveLength(1)
    expect(all[0]!.isRead).toBe(true)
  })
})
