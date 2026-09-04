import { describe, it, expect } from 'vitest'
import { InMemoryAutomationStore } from '../src/store'
import { NotificationService } from '../src/notifier'
import { TaskWorker } from '../src/worker'
import { AutomationScheduler } from '../src/scheduler'
import { TaskNotification } from '../src/types'

describe('Automation Engine Full Lifecycle & Notifications', () => {
  it('executes a task, records logs, marks completion, and fires notification', async () => {
    const store = new InMemoryAutomationStore()
    const notifier = new NotificationService(store)
    const worker = new TaskWorker(store, notifier)
    const scheduler = new AutomationScheduler(store, worker, 100)

    const receivedNotifications: TaskNotification[] = []
    notifier.subscribe(n => receivedNotifications.push(n))

    // Register a business activity handler
    worker.registerHandler('PROCESS_SYNCHRONIZATION', async (payload, ctx) => {
      ctx.log('Etapa 1: Conectando à fonte externa...')
      ctx.log(`Etapa 2: Processando item ${payload.itemCode}...`)
      return { syncedCount: 42, status: 'OK' }
    })

    // 1. Create a task with INTERVAL of 60 seconds
    const task = await store.createTask({
      userId: 'user-123',
      title: 'Sincronizar Processos e Prazos',
      scheduleType: 'INTERVAL',
      scheduleExpr: '60',
      actionType: 'PROCESS_SYNCHRONIZATION',
      actionPayload: { itemCode: 'PROC-999' },
      maxRuns: 2,
    })

    expect(task.status).toBe('ACTIVE')
    expect(task.totalRunsCompleted).toBe(0)

    // Explicitly set nextRunAt to past/now to trigger execution
    const now = new Date()
    await store.updateTask(task.id, { nextRunAt: now })

    // 2. Trigger scheduler tick
    const dispatched = await scheduler.tick(now)
    expect(dispatched).toBe(1)

    // Give worker time to settle async execution
    await new Promise(r => setTimeout(r, 100))

    // 3. Verify task runs
    const runs = await store.listRunsByTask(task.id)
    expect(runs).toHaveLength(1)
    const run = runs[0]
    expect(run.status).toBe('SUCCESS')
    expect(run.outputData).toEqual({ syncedCount: 42, status: 'OK' })
    expect(run.executionLogs.length).toBeGreaterThanOrEqual(3)

    // 4. Verify Task updated status
    const updatedTask = await store.getTask(task.id)
    expect(updatedTask?.totalRunsCompleted).toBe(1)
    expect(updatedTask?.lastRunStatus).toBe('SUCCESS')
    expect(updatedTask?.nextRunAt).not.toBeNull()

    // 5. Verify Notification was created and dispatched
    expect(receivedNotifications).toHaveLength(1)
    const notif = receivedNotifications[0]
    expect(notif.taskId).toBe(task.id)
    expect(notif.runId).toBe(run.id)
    expect(notif.level).toBe('SUCCESS')
    expect(notif.title).toContain('Sincronizar Processos e Prazos')
    expect(notif.message).toContain('executada com sucesso')

    // 6. Test second execution reaching maxRuns limit
    const futureTime = new Date(Date.now() + 120 * 1000)
    await store.updateTask(task.id, { nextRunAt: futureTime })
    await scheduler.tick(futureTime)
    await new Promise(r => setTimeout(r, 100))

    const finalTask = await store.getTask(task.id)
    expect(finalTask?.totalRunsCompleted).toBe(2)
    expect(finalTask?.status).toBe('COMPLETED') // Reached maxRuns=2
    expect(finalTask?.nextRunAt).toBeNull()
  })

  it('handles execution failure and dispatches error notification', async () => {
    const store = new InMemoryAutomationStore()
    const notifier = new NotificationService(store)
    const worker = new TaskWorker(store, notifier)
    const scheduler = new AutomationScheduler(store, worker, 100)

    const receivedNotifications: TaskNotification[] = []
    notifier.subscribe(n => receivedNotifications.push(n))

    // Handler that deliberately throws
    worker.registerHandler('FAILING_TASK', async () => {
      throw new Error('Falha de conexão com a API externa')
    })

    const targetTime = new Date(Date.now() + 5000)
    const task = await store.createTask({
      userId: 'user-456',
      title: 'Tarefa com Falha',
      scheduleType: 'ONCE',
      scheduleExpr: targetTime.toISOString(),
      actionType: 'FAILING_TASK',
    })

    // Advance time to targetTime to trigger
    await scheduler.tick(targetTime)
    await new Promise(r => setTimeout(r, 100))

    const runs = await store.listRunsByTask(task.id)
    expect(runs).toHaveLength(1)
    expect(runs[0].status).toBe('FAILED')
    expect(runs[0].errorMessage).toContain('Falha de conexão')

    expect(receivedNotifications).toHaveLength(1)
    expect(receivedNotifications[0].level).toBe('ERROR')
    expect(receivedNotifications[0].title).toContain('Falha na Atividade')
  })

  it('handles timeout correctly when execution exceeds timeoutSeconds', async () => {
    const store = new InMemoryAutomationStore()
    const notifier = new NotificationService(store)
    const worker = new TaskWorker(store, notifier)
    const scheduler = new AutomationScheduler(store, worker, 100)

    // Handler that hangs longer than timeout
    worker.registerHandler('HANGING_TASK', async () => {
      return new Promise(resolve => setTimeout(resolve, 500))
    })

    const targetTime = new Date(Date.now() + 5000)
    const task = await store.createTask({
      userId: 'user-789',
      title: 'Tarefa Demorada',
      scheduleType: 'ONCE',
      scheduleExpr: targetTime.toISOString(),
      actionType: 'HANGING_TASK',
      timeoutSeconds: 0.1, // 100ms timeout
    })

    await scheduler.tick(targetTime)
    await new Promise(r => setTimeout(r, 200))

    const runs = await store.listRunsByTask(task.id)
    expect(runs).toHaveLength(1)
    expect(runs[0].status).toBe('TIMED_OUT')
    expect(runs[0].errorMessage).toContain('excedeu o tempo limite')
  })
})
