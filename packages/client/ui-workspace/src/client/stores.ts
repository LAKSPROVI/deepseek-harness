/**
 * The workspace browser's viewing store: the session-list grouping mode,
 * persisted across reloads. Module level exports the factory only (a
 * module-level handle would pin the store identity across plugin reloads);
 * register() receives the factory and the browser derives its PropsStore
 * share from the return type.
 */
import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-store'

/** Browser-local order account for the hierarchy-free flat Session list. */
export const FLAT_SESSION_ORDER_KEY = '__flat_session_order__'

/** Session-list grouping mode: workspace sections or one flat recency list. */
export type SessionGroupBy = 'workspace' | 'flat'
/** Session order: user-arranged only, or user-arranged plus activity promotion. */
export type SessionOrderBy = 'manual' | 'updated'

/** Workspace browser viewing state persisted across surface remounts and reloads. */
type WorkspaceViewState = {
  groupBy: SessionGroupBy
  orderBy: SessionOrderBy
  /** Explicit zero-or-five-session state keyed by Workspace group identity. */
  groupExpansion: Record<string, boolean>
  /** Shared editable order per Workspace group plus the browser-local flat-list account. */
  sessionOrderByAccount: Record<string, string[]>
  /** Last observed update timestamps per order account for one-time promotion events. */
  sessionUpdatedAtByAccount: Record<string, Record<string, number>>
  /** User-marked completed sessions. */
  completedSessions: Record<string, boolean>
  /** User-marked unread sessions. */
  unreadSessions: Record<string, boolean>
}

/**
 * Annotation twin of the actions literal below (the export needs a declared
 * return type); drift fails assignability at the defineStore call.
 */
type WorkspaceViewActions = {
  setGroupBy: (draft: WorkspaceViewState, mode: SessionGroupBy) => void
  setOrderBy: (draft: WorkspaceViewState, mode: SessionOrderBy) => void
  setGroupExpanded: (draft: WorkspaceViewState, key: string, expanded: boolean) => void
  retainAccountKeys: (draft: WorkspaceViewState, workspaceKeys: readonly string[]) => void
  syncSessionOrderAccount: (
    draft: WorkspaceViewState,
    accountKey: string,
    order: string[],
    updatedAt: Record<string, number>,
  ) => void
  setSessionOrder: (draft: WorkspaceViewState, accountKey: string, order: string[]) => void
  toggleCompletedSession: (draft: WorkspaceViewState, sessionId: string) => void
  setSessionCompleted: (draft: WorkspaceViewState, sessionId: string, completed: boolean) => void
  toggleUnreadSession: (draft: WorkspaceViewState, sessionId: string) => void
  setSessionUnread: (draft: WorkspaceViewState, sessionId: string, unread: boolean) => void
}

/**
 * Create the workspace browser viewing store handle.
 * @returns the store handle (spec + type + identity + factory in one).
 */
export function createWorkspaceViewStore(): EngineStoreHandle<WorkspaceViewState, WorkspaceViewActions> {
  return defineStore({
    init: (): WorkspaceViewState => ({
      groupBy: 'workspace',
      orderBy: 'updated',
      groupExpansion: {},
      sessionOrderByAccount: {},
      sessionUpdatedAtByAccount: {},
      completedSessions: {},
      unreadSessions: {},
    }),
    persist: 'dsh.workspace.view.v6',
    actions: {
      setGroupBy: (d, mode: SessionGroupBy) => { d.groupBy = mode },
      setOrderBy: (d, mode: SessionOrderBy) => { d.orderBy = mode },
      setGroupExpanded: (d, key: string, expanded: boolean) => { d.groupExpansion[key] = expanded },
      retainAccountKeys: (d, workspaceKeys: readonly string[]) => {
        const retained = new Set(workspaceKeys)
        d.groupExpansion = Object.fromEntries(
          Object.entries(d.groupExpansion).filter(([key]) => retained.has(key)),
        )
        d.sessionOrderByAccount = Object.fromEntries(
          Object.entries(d.sessionOrderByAccount).filter(([key]) => retained.has(key)),
        )
        d.sessionUpdatedAtByAccount = Object.fromEntries(
          Object.entries(d.sessionUpdatedAtByAccount).filter(([key]) => retained.has(key)),
        )
      },
      syncSessionOrderAccount: (d, accountKey: string, order: string[], updatedAt: Record<string, number>) => {
        d.sessionOrderByAccount[accountKey] = order
        d.sessionUpdatedAtByAccount[accountKey] = updatedAt
      },
      setSessionOrder: (d, accountKey: string, order: string[]) => {
        d.sessionOrderByAccount[accountKey] = order
      },
      toggleCompletedSession: (d, sessionId: string) => {
        d.completedSessions = d.completedSessions ?? {}
        if (d.completedSessions[sessionId]) {
          d.completedSessions[sessionId] = false
        } else {
          d.completedSessions[sessionId] = true
          if (d.unreadSessions) d.unreadSessions[sessionId] = false
        }
      },
      setSessionCompleted: (d, sessionId: string, completed: boolean) => {
        d.completedSessions = d.completedSessions ?? {}
        d.completedSessions[sessionId] = completed
        if (completed && d.unreadSessions) {
          d.unreadSessions[sessionId] = false
        }
      },
      toggleUnreadSession: (d, sessionId: string) => {
        d.unreadSessions = d.unreadSessions ?? {}
        if (d.unreadSessions[sessionId]) {
          d.unreadSessions[sessionId] = false
        } else {
          d.unreadSessions[sessionId] = true
          if (d.completedSessions) d.completedSessions[sessionId] = false
        }
      },
      setSessionUnread: (d, sessionId: string, unread: boolean) => {
        d.unreadSessions = d.unreadSessions ?? {}
        d.unreadSessions[sessionId] = unread
        if (unread && d.completedSessions) {
          d.completedSessions[sessionId] = false
        }
      },
    },
  })
}
