/**
 * Derives the workspace browser tree from Host Workspace order and membership.
 * Unassigned Sessions trail under Ungrouped; only the selected blank Session
 * remains visible.
 */
import {
  indexSubagentDescendants, type PendingInteractionStatus, type SessionId, type SessionListState,
  type SessionSearchResultItem, type SessionSummary, type SubagentDescendantSummary,
  type WorkspaceId, type WorkspaceView,
} from '@deepseek-ai/dsh-client-runtime/client'
import type { CustomSessionStatus } from './stores.ts'

/** Group key for Sessions outside every Workspace. */
export const UNGROUPED_KEY = ''

/** Display label for the ungrouped bucket row. */
export const UNGROUPED_LABEL = 'Ungrouped'

/** One top-level session row in a group or the flat list. */
export interface SessionNode {
  id: SessionId
  /** Stored display title; the renderer substitutes the localized New Session label for blank rows. */
  title: string
  /** The provisional blank session (renderer shows the localized New Session title). */
  blank: boolean
  /** The runtime Session list reports an interaction awaiting this user. */
  pendingInteraction?: PendingInteractionStatus
  running: boolean
  /** Running descendants connected through uninterrupted subagent-origin lineage. */
  runningSubagentCount: number
  /** Finished running while not selected and not yet opened (the green "done" reminder dot), or user-marked completed. */
  completed: boolean
  /** User-marked or notification unread status. */
  unread?: boolean
  /** User-assigned custom status. */
  customStatus?: CustomSessionStatus
  updatedAt: number
}

/** Session order selected by the Workspace browser. */
export type SessionOrderBy = 'manual' | 'updated'

/** One workspace group section: header row facts + visible top-level session rows. */
export interface GroupNode {
  /** Group key: the workspace id or {@link UNGROUPED_KEY}. */
  key: string
  /** Backing Workspace id; absent only for the ungrouped bucket. */
  workspaceId: WorkspaceId | undefined
  cwd: string | undefined
  /** Workspace creation time (epoch ms); absent only for the ungrouped bucket. */
  createdAt: number | undefined
  label: string
  /** Total visible sessions in the group. */
  sessionCount: number
  expanded: boolean
  /** The group contains the selected session (active folder tint; supplied here so the renderer never scans). */
  containsCurrent: boolean
  /** Visible session rows (empty while the group is folded). */
  sessions: readonly SessionNode[]
}

/** One flat search row combining list metadata with an optional content match. */
export interface SearchResultNode {
  id: SessionId
  title: string
  workspace: string
  /** The runtime Session list reports an interaction awaiting this user. */
  pendingInteraction?: PendingInteractionStatus
  running: boolean
  /** Running descendants connected through uninterrupted subagent-origin lineage. */
  runningSubagentCount: number
  /** Finished running while not selected and not yet opened (the green "done" reminder dot). */
  completed: boolean
  unread?: boolean
  customStatus?: CustomSessionStatus
  snippet?: string
}

/** Bounded merged search projection plus the refine-query hint bit. */
export interface SearchResultSet {
  items: readonly SearchResultNode[]
  hasMore: boolean
}

/** Viewing state consumed by the derivation. */
export interface TreeView {
  expandedGroups: readonly string[]
  /** Browser-local order for Sessions without a backing Workspace account. */
  ungroupedOrder?: readonly string[]
  completedSessions?: Readonly<Record<string, boolean>>
  unreadSessions?: Readonly<Record<string, boolean>>
  customSessionStatuses?: Readonly<Record<string, CustomSessionStatus | undefined>>
}

interface Group {
  key: string
  workspaceId: WorkspaceId | undefined
  cwd: string | undefined
  createdAt: number | undefined
  label: string
  sessions: SessionSummary[]
}

/**
 * Directory display label: basename of the path (both separators accepted).
 * Ungrouped-bucket fallback for surfaces without a workspace title.
 * @param cwd - directory path, or undefined for the ungrouped bucket.
 * @returns basename, the raw cwd when it has no basename, or the ungrouped label.
 */
export function workspaceLabel(cwd: string | undefined): string {
  if (cwd === undefined || cwd === '') return UNGROUPED_LABEL
  const base = cwd.replace(/[/\\]+$/, '').split(/[/\\]/).pop()
  return base !== undefined && base !== '' ? base : cwd
}

/** Recency comparator: newest first, id as the deterministic tiebreak (ids are unique per group). */
function byRecency(a: SessionSummary, b: SessionSummary): number {
  if (b.updatedAt !== a.updatedAt) return b.updatedAt - a.updatedAt
  return a.id < b.id ? -1 : 1
}

/**
 * Ordinary sessions are visible; among blank sessions, only the current one
 * is visible. Subagent children use their parent header catalog; archived
 * sessions are visible nowhere, while their accounting slots remain so
 * unarchiving restores position.
 */
function sessionVisible(session: SessionSummary, current: SessionId | undefined, archived: ReadonlySet<SessionId>): boolean {
  return session.origin !== 'subagent'
    && !archived.has(session.id)
    && (!session.blank || session.id === current)
}

/**
 * A blank session is the selected Workspace's provisional New Session row;
 * its canonical title never enters search (blank rows are query-excluded)
 * and the renderer localizes its display label.
 */
function sessionTitle(session: SessionSummary): string {
  return session.blank ? 'New Session' : session.displayTitle
}

/** Build one group without projecting session lineage into presentation. */
function buildGroup(
  key: string,
  workspaceId: WorkspaceId | undefined,
  cwd: string | undefined,
  createdAt: number | undefined,
  label: string,
  members: readonly SessionSummary[],
  order: 'account' | 'recency',
): Group {
  const sessions = [...members]
  // Real Workspace order comes from sessionIds. Ungrouped falls back to
  // recency until the browser supplies its persisted local order.
  if (order === 'recency') sessions.sort(byRecency)
  return { key, workspaceId, cwd, createdAt, label, sessions }
}

/** Apply a stored Ungrouped order and append newly loose Sessions by recency. */
function orderedUngrouped(members: readonly SessionSummary[], stored: readonly string[]): SessionSummary[] {
  const byId = new Map(members.map(session => [session.id as string, session]))
  const included = new Set<string>()
  const ordered: SessionSummary[] = []
  for (const key of stored) {
    const session = byId.get(key)
    if (session === undefined || included.has(key)) continue
    ordered.push(session)
    included.add(key)
  }
  for (const session of [...members].sort(byRecency)) {
    if (included.has(session.id)) continue
    ordered.push(session)
  }
  return ordered
}

/**
 * Group Sessions by Host Workspace: one group per entity in stable Host
 * order, followed by the Ungrouped bucket whenever any unassigned session
 * exists. Blank New Sessions are excluded except for the selected one, so a
 * draft row shows only in the group that owns the current selection.
 */
function groupByWorkspace(
  list: SessionListState,
  workspaces: readonly WorkspaceView[],
  archived: ReadonlySet<SessionId>,
  ungroupedOrder?: readonly string[],
): Group[] {
  const byId = list.byId
  const current = list.current
  const accounted = new Set<SessionId>()
  const groups: Group[] = []

  for (const workspace of workspaces) {
    const members: SessionSummary[] = []
    for (const sessionId of workspace.sessionIds) {
      accounted.add(sessionId)
      const session = byId[sessionId]
      if (session === undefined || !sessionVisible(session, current, archived)) continue
      members.push(session)
    }
    // Creation time rides the RFC 3339 wire string; parse to epoch ms so the
    // presentation layer works with numbers only.
    const createdAt = Date.parse(workspace.createdAt)
    groups.push(buildGroup(
      workspace.workspaceId,
      workspace.workspaceId,
      workspace.path,
      Number.isNaN(createdAt) ? undefined : createdAt,
      workspace.title,
      members,
      'account',
    ))
  }

  // Trailing ungrouped bucket: any session whose id is not accounted for in
  // any Host Workspace's sessionIds array. Blank rows follow the same rule:
  // only the selected one shows.
  const stray: SessionSummary[] = []
  for (const sessionId of list.ids) {
    if (accounted.has(sessionId)) continue
    const session = byId[sessionId]
    if (session === undefined || !sessionVisible(session, current, archived)) continue
    stray.push(session)
  }

  if (stray.length > 0) {
    const sessions = ungroupedOrder === undefined
      ? (() => { const copy = [...stray]; copy.sort(byRecency); return copy })()
      : orderedUngrouped(stray, ungroupedOrder)
    groups.push({
      key: UNGROUPED_KEY,
      workspaceId: undefined,
      cwd: undefined,
      createdAt: undefined,
      label: UNGROUPED_LABEL,
      sessions,
    })
  }

  return groups
}

function sessionNode(
  s: SessionSummary,
  descendants: ReadonlyMap<SessionId, SubagentDescendantSummary>,
  completedMap?: Readonly<Record<string, boolean>>,
  unreadMap?: Readonly<Record<string, boolean>>,
  customStatuses?: Readonly<Record<string, CustomSessionStatus | undefined>>,
): SessionNode {
  const custom = customStatuses?.[s.id]
  const isCompleted = custom === 'completed' || completedMap?.[s.id] === true
  const isUnread = custom === 'unread' || unreadMap?.[s.id] === true
  const isRunning = custom === 'ongoing' || s.running
  const customWarning = custom === 'warning' ? ('question' as PendingInteractionStatus) : undefined
  const effectivePending = s.pendingInteraction ?? customWarning
  const effectiveCustom = custom === 'idle' ? undefined : custom

  return {
    id: s.id,
    title: sessionTitle(s),
    blank: s.blank,
    running: isRunning,
    runningSubagentCount: descendants.get(s.id)?.runningCount ?? 0,
    completed: isCompleted,
    unread: isUnread,
    updatedAt: s.updatedAt,
    ...(effectiveCustom === undefined ? {} : { customStatus: effectiveCustom }),
    ...(effectivePending === undefined ? {} : { pendingInteraction: effectivePending }),
  }
}

/**
 * Derive the workspace browser groups with every session as a top-level row.
 *
 * Every group shows; sessions populate under expanded groups in the selected
 * local order. Blank sessions are excluded except for the selected
 * provisional New Session row; archived sessions are excluded everywhere.
 * Content search lives outside this derivation
 * (see {@link deriveSearchResults}).
 * @param list - sessions list snapshot (`current` feeds containsCurrent).
 * @param workspaces - real workspaces in stable Host order.
 * @param archivedSessionIds - registry-global archive set.
 * @param view - local expansion arrays and status overrides.
 * @returns group sections in render order.
 */
export function deriveGroups(
  list: SessionListState,
  workspaces: readonly WorkspaceView[],
  archivedSessionIds: readonly SessionId[],
  view: TreeView,
): GroupNode[] {
  const archived = new Set(archivedSessionIds)
  const expandedGroups = new Set(view.expandedGroups)
  const descendants = indexSubagentDescendants(list.byId)
  const currentGroup = list.current === undefined
    ? undefined
    : (workspaces.find(w => w.sessionIds.includes(list.current as SessionId))?.workspaceId as string | undefined)
        ?? UNGROUPED_KEY
  const groups: GroupNode[] = []
  for (const g of groupByWorkspace(list, workspaces, archived, view.ungroupedOrder)) {
    const expanded = expandedGroups.has(g.key)
    groups.push({
      key: g.key,
      workspaceId: g.workspaceId,
      cwd: g.cwd,
      createdAt: g.createdAt,
      label: g.label,
      sessionCount: g.sessions.length,
      expanded,
      containsCurrent: g.key === currentGroup,
      sessions: expanded
        ? g.sessions.map(session => sessionNode(
          session,
          descendants,
          view.completedSessions,
          view.unreadSessions,
          view.customSessionStatuses,
        ))
        : [],
    })
  }
  return groups
}

/**
 * Derive the flat session list ("In one list" mode): every session — fork
 * children included — as a top-level row, strictly newest-first. No grouping,
 * no parent/child adjacency. Content search lives outside this derivation
 * (see {@link deriveSearchResults}).
 * @param list - sessions list snapshot.
 * @param archivedSessionIds - registry-global archive set.
 * @param view - optional status maps.
 * @returns flat rows in render order.
 */
export function deriveFlat(
  list: SessionListState,
  archivedSessionIds: readonly SessionId[],
  view?: {
    completedSessions?: Readonly<Record<string, boolean>>
    unreadSessions?: Readonly<Record<string, boolean>>
    customSessionStatuses?: Readonly<Record<string, CustomSessionStatus | undefined>>
  },
): SessionNode[] {
  const archived = new Set(archivedSessionIds)
  const descendants = indexSubagentDescendants(list.byId)
  const rows: SessionSummary[] = []
  for (const id of list.ids) {
    const s = list.byId[id]
    if (s === undefined || !sessionVisible(s, list.current, archived)) continue
    rows.push(s)
  }
  rows.sort(byRecency)
  return rows.map(session => sessionNode(session, descendants, view?.completedSessions, view?.unreadSessions, view?.customSessionStatuses))
}

/**
 * Derive recent and in-progress sessions for the top highlight section.
 * Active sessions (running, pending interaction, unread) lead, followed by
 * recently completed or updated sessions up to a limit.
 */
export function deriveRecentAndInProgress(
  list: SessionListState,
  archivedSessionIds: readonly SessionId[],
  completedSessions?: Readonly<Record<string, boolean>>,
  unreadSessions?: Readonly<Record<string, boolean>>,
  customStatuses?: Readonly<Record<string, CustomSessionStatus | undefined>>,
  limit = 5,
): SessionNode[] {
  const archived = new Set(archivedSessionIds)
  const descendants = indexSubagentDescendants(list.byId)
  const candidates: SessionSummary[] = []
  for (const id of list.ids) {
    const s = list.byId[id]
    if (s === undefined || !sessionVisible(s, list.current, archived) || (s.blank && s.id !== list.current)) continue
    candidates.push(s)
  }

  // Score candidate sessions:
  // Active in-progress (running, subagents, pending interaction) -> 50
  // User custom ongoing -> 40
  // User custom warning -> 35
  // User custom unread or unread state -> 30
  // Recent un-triaged conversation -> 10 (stays at top until user selects a status option)
  // Completed or explicitly dismissed/idle -> -1 (leaves recent list)
  const scored = candidates.map((s) => {
    const custom = customStatuses?.[s.id]
    const runningSubagents = (descendants.get(s.id)?.runningCount ?? 0) > 0
    const isActive = s.running || runningSubagents || s.pendingInteraction !== undefined
    const isCompleted = custom === 'completed' || completedSessions?.[s.id] === true
    const isDismissed = custom === 'idle'

    // Actively running or waiting interaction always leads
    if (isActive) {
      return { summary: s, score: 50, updatedAt: s.updatedAt }
    }

    // Explicitly completed or marked as read/idle leaves the top section
    if (isCompleted || isDismissed) {
      return { summary: s, score: -1, updatedAt: s.updatedAt }
    }

    // Explicit user active statuses
    if (custom === 'ongoing') return { summary: s, score: 40, updatedAt: s.updatedAt }
    if (custom === 'warning') return { summary: s, score: 35, updatedAt: s.updatedAt }
    if (custom === 'unread' || unreadSessions?.[s.id] === true) return { summary: s, score: 30, updatedAt: s.updatedAt }

    // Otherwise: recent conversation that has NOT been triaged yet.
    // It remains in "Recentes e Em Andamento" until the user explicitly selects a status option!
    return { summary: s, score: 10, updatedAt: s.updatedAt }
  })

  const activeOrRecent = scored.filter(item => item.score > 0)
  activeOrRecent.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    return b.updatedAt - a.updatedAt
  })

  return activeOrRecent.slice(0, limit).map(({ summary: s }) =>
    sessionNode(s, descendants, completedSessions, unreadSessions, customStatuses),
  )
}

/** Relative-time bucket of a session row's trailing label. */
export type RelativeTimeUnit = 'now' | 'minutes' | 'hours' | 'days' | 'months' | 'years'

/** Structured relative time: the bucket plus its magnitude (0 for 'now'). */
export interface RelativeTime {
  unit: RelativeTimeUnit
  n: number
}

/**
 * Filter the session list by query string across name and content hits.
 * Local name matches lead in recency order, followed by content-search hits
 * from the engine in rank order.
 * @param list - session list snapshot.
 * @param workspaces - workspace list for resolving folder labels.
 * @param query - search query string.
 * @param archivedSessionIds - registry-global archive set.
 * @param content - content search results from the engine.
 * @param limit - maximum results to return.
 * @returns unified search result list.
 */
export function deriveSearchResults(
  list: SessionListState,
  workspaces: readonly WorkspaceView[],
  query: string,
  archivedSessionIds: readonly SessionId[],
  content: { items: readonly SessionSearchResultItem[]; hasMore: boolean },
  limit: number,
): SearchResultSet {
  const q = query.trim().toLowerCase()
  if (q === '') return { items: [], hasMore: false }
  const archived = new Set(archivedSessionIds)
  const descendants = indexSubagentDescendants(list.byId)

  const workspaceBySession = new Map<SessionId, string>()
  for (const workspace of workspaces) {
    for (const sessionId of workspace.sessionIds) {
      if (!workspaceBySession.has(sessionId)) workspaceBySession.set(sessionId, workspace.title)
    }
  }
  const labelOf = (summary: SessionSummary): string =>
    workspaceBySession.get(summary.id) ?? workspaceLabel(summary.cwd)
  const contentBySession = new Map<SessionId, SessionSearchResultItem>()
  for (const item of content.items) {
    if (!contentBySession.has(item.sessionId)) contentBySession.set(item.sessionId, item)
  }

  const local: SessionSummary[] = []
  for (const id of list.ids) {
    const summary = list.byId[id]
    // Blank placeholders never match a query (their canonical title displays
    // localized, so matching it would tie search to one language).
    if (summary === undefined || summary.blank || !sessionVisible(summary, list.current, archived)) continue
    if (
      sessionTitle(summary).toLowerCase().includes(q)
      || labelOf(summary).toLowerCase().includes(q)
    ) {
      local.push(summary)
    }
  }
  local.sort(byRecency)

  const ordered: SessionSummary[] = []
  const included = new Set<SessionId>()
  const include = (summary: SessionSummary): void => {
    if (included.has(summary.id)) return
    included.add(summary.id)
    ordered.push(summary)
  }
  for (const summary of local) include(summary)
  for (const item of content.items) {
    const summary = list.byId[item.sessionId]
    if (summary !== undefined && !summary.blank && sessionVisible(summary, list.current, archived)) include(summary)
  }

  return {
    items: ordered.slice(0, limit).map((summary) => {
      const match = contentBySession.get(summary.id)
      return {
        id: summary.id,
        title: sessionTitle(summary),
        workspace: labelOf(summary),
        running: summary.running,
        runningSubagentCount: descendants.get(summary.id)?.runningCount ?? 0,
        ...(summary.pendingInteraction === undefined
          ? {}
          : { pendingInteraction: summary.pendingInteraction }),
        completed: summary.completed === true,
        ...match === undefined ? {} : { snippet: match.snippet },
      }
    }),
    hasMore: content.hasMore || ordered.length > limit,
  }
}

/**
 * Compact relative time for session rows, as a structured bucket the
 * renderer localizes ("now"/"5min"/"3h"/"2d"/"4mo"/"1y" in en).
 * @param updatedAt - epoch ms of the session's last activity.
 * @param now - current epoch ms (injected for pure rendering).
 * @returns the row's trailing time bucket and magnitude.
 */
export function relativeTime(updatedAt: number, now: number): RelativeTime {
  const MIN = 60_000
  const HOUR = 3_600_000
  const DAY = 86_400_000
  const diff = Math.max(0, now - updatedAt)
  if (diff < MIN) return { unit: 'now', n: 0 }
  if (diff < HOUR) return { unit: 'minutes', n: Math.floor(diff / MIN) }
  if (diff < DAY) return { unit: 'hours', n: Math.floor(diff / HOUR) }
  if (diff < 30 * DAY) return { unit: 'days', n: Math.floor(diff / DAY) }
  if (diff < 365 * DAY) return { unit: 'months', n: Math.floor(diff / (30 * DAY)) }
  return { unit: 'years', n: Math.floor(diff / (365 * DAY)) }
}
