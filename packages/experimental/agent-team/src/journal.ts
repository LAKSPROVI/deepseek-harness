/** Team Lead journal and committed state reader. */

import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Context } from '@deepseek-ai/cordis'
import type { SessionEventMap } from '@deepseek-ai/dsh-session'
import { foldTeam } from './fold.ts'
import type { TeamEventType, TeamFoldState } from './fold.ts'

type AppendTeamEvent = <T extends TeamEventType>(type: T, data: SessionEventMap[T]) => void
type MutableTeamEventType = 'team/member' | 'team/task' | 'team/debate' | 'team/message/queued' | 'team/message/delivered'

/** Owns per-Lead transaction order and committed Team event publication. */
export class TeamJournal {
  private readonly transactions = new Map<string, Promise<unknown>>()

  /**
   * @param ctx - Context carrying Session persistence and transaction coordinator.
   * @param onCommitted - observer notified when any Team event commits.
   */
  constructor(
    private readonly ctx: Context,
    private readonly onCommitted: (root: Agent) => void,
  ) {}

  /**
   * Fold authoritative Team state for one exact live Lead.
   * @param root - exact live Team Lead.
   * @returns current replay state selected by the Lead Team id.
   */
  state(root: Agent): TeamFoldState {
    return foldTeam(root.id, root.session.snapshotEvents())
  }

  /**
   * Serialize operations targeting one Team Lead's Session log.
   * @param rootId - exact root Session identity.
   * @param operation - async callback executed under the exclusive lock.
   * @returns the operation's resolved value.
   */
  async transact<T>(rootId: string, operation: () => Promise<T>): Promise<T> {
    const prior = this.transactions.get(rootId) ?? Promise.resolve()
    const current = (async () => {
      await prior
      return await operation()
    })()
    const tracked = current.then(() => undefined, () => undefined)
    this.transactions.set(rootId, tracked)
    try {
      return await current
    } finally {
      if (this.transactions.get(rootId) === tracked) {
        this.transactions.delete(rootId)
      }
    }
  }

  /**
   * Append one Team event, flush durability, and notify observers synchronously.
   * @param root - exact live Team Lead Session receiving the event.
   * @param type - Team event discriminant.
   * @param data - matching version-tagged payload.
   */
  async appendAndFlush<T extends MutableTeamEventType>(
    root: Agent,
    type: T,
    data: SessionEventMap[T],
  ): Promise<void> {
    (root.session.append as AppendTeamEvent)(type, data)
    await this.ctx.sessions.flush(root.session)
    this.onCommitted(root)
  }
}
