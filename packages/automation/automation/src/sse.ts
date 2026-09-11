import { IncomingMessage, ServerResponse } from 'http'
import { NotificationService } from './notifier'
import { TaskNotification } from './types'

/**
 * Server-Sent Events (SSE) Streamer for delivering real-time task notifications
 * directly to the user's browser without requiring third-party WebSocket gateways.
 */
export class AutomationSseStreamer {
  private activeClients = new Map<ServerResponse, string>() // res -> userId

  constructor(private readonly notifier: NotificationService) {
    // Hook to the NotificationService events
    this.notifier.subscribe((notification: TaskNotification) => {
      this.broadcastToUser(notification.userId, 'notification', notification)
    })
  }

  /**
   * Upgrade one HTTP request into a long-lived event stream scoped to the `userId` query parameter.
   * @param req - incoming request; `close` unregisters the client.
   * @param res - response kept open as the SSE channel.
   */
  public handleSseConnection(req: IncomingMessage, res: ServerResponse): void {
    const parsedUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`)
    const userId = parsedUrl.searchParams.get('userId') || 'default'

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    })

    res.write(`event: connected\ndata: ${JSON.stringify({ userId, timestamp: new Date() })}\n\n`)

    this.activeClients.set(res, userId)

    req.on('close', () => {
      this.activeClients.delete(res)
    })
  }

  /**
   * Write one event to every client of a user (and to clients subscribed as `all`); a failed write drops that client.
   * @param userId - owner whose clients receive the event.
   * @param eventName - SSE `event:` name.
   * @param payload - JSON-serialized as the event data.
   */
  public broadcastToUser(userId: string, eventName: string, payload: unknown): void {
    const message = `event: ${eventName}\ndata: ${JSON.stringify(payload)}\n\n`

    for (const [res, clientUserId] of this.activeClients.entries()) {
      if (clientUserId === userId || clientUserId === 'all') {
        try {
          res.write(message)
        } catch {
          this.activeClients.delete(res)
        }
      }
    }
  }

  /**
   * Number of open SSE connections.
   * @returns current client count.
   */
  public getConnectedClientsCount(): number {
    return this.activeClients.size
  }
}
