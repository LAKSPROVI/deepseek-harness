import { IAutomationStore } from './store'
import { TaskNotification, NotificationLevel } from './types'

export type NotificationEventListener = (notification: TaskNotification) => void

/**
 * Handles persistent notifications and real-time pub/sub delivery.
 */
export class NotificationService {
  private listeners: Set<NotificationEventListener> = new Set()

  constructor(private readonly store: IAutomationStore) {}

  public subscribe(listener: NotificationEventListener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  public async notifyTaskFinished(params: {
    taskId: string
    runId: string
    userId: string
    level: NotificationLevel
    title: string
    message: string
    summaryData?: Record<string, unknown>
  }): Promise<TaskNotification> {
    const notification = await this.store.createNotification({
      taskId: params.taskId,
      runId: params.runId,
      userId: params.userId,
      level: params.level,
      title: params.title,
      message: params.message,
      // Optional under `exactOptionalPropertyTypes`: omit rather than pass an
      // explicit `undefined`, which is a different type from an absent field.
      ...params.summaryData !== undefined ? { summaryData: params.summaryData } : {},
    })

    // Notify all active listeners/subscribers (e.g. WebSockets, UI channels)
    for (const listener of this.listeners) {
      try {
        listener(notification)
      } catch (err) {
        console.error('[NotificationService] Error in listener:', err)
      }
    }

    return notification
  }
}
