// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SessionContextActions } from '../src/client/header/SessionContextActions.tsx'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { zh } from '../src/client/locales.ts'

// The component may call `t` with a shared `common` key as well as a workspace
// one — `LocaleKeysOf` is the namespace union PLUS the common vocabulary — so the
// fake must accept the whole domain and echo back anything the zh dictionary lacks.
const t: TranslateNS<'workspace'> = key => (zh as Record<string, string>)[key] ?? key

// The framework injects the whole session standard kit. These components read
// only the seats named at each render site, so the rest are inert stubs that
// exist to satisfy the prop contract rather than to be called.
const frameworkSeats = {
  useSession: (() => undefined) as never,
  useProjection: (() => undefined) as never,
  useInput: (() => undefined) as never,
  inputActions: {} as never,
  useSessions: (() => undefined) as never,
  useWorkspaces: (() => undefined) as never,
}

describe('SessionContextActions', () => {
  const sessionId = 'test-session-123'
  const startSession = vi.fn()
  const forkSession = vi.fn()

  const useSessions = (selector: (s: { byId: Record<string, { displayTitle: string }> }) => unknown) =>
    selector({ byId: { [sessionId]: { displayTitle: 'Pesquisa Jurídica' } } })

  const useWorkspaces = (selector: (s: { items: Array<{ workspaceId: string; sessionIds: string[] }> }) => unknown) =>
    selector({ items: [{ workspaceId: 'ws-1', sessionIds: [sessionId] }] })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('renders quick new session button with trigger', () => {
    render(
      <SessionContextActions {...frameworkSeats}
        sessionId={sessionId as never}
        useSessions={useSessions as never}
        useWorkspaces={useWorkspaces as never}
        startSession={startSession}
        forkSession={forkSession}
        t={t}
      />,
    )

    const trigger = screen.getByRole('button', { name: /新会话/i })
    expect(trigger).toBeDefined()
  })

  it('opens dropdown and executes start clean session in same workspace', () => {
    render(
      <SessionContextActions {...frameworkSeats}
        sessionId={sessionId as never}
        useSessions={useSessions as never}
        useWorkspaces={useWorkspaces as never}
        startSession={startSession}
        forkSession={forkSession}
        t={t}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /新会话/i }))

    const cleanBtn = screen.getByRole('menuitem', { name: /新空白会话/i })
    fireEvent.click(cleanBtn)

    expect(startSession).toHaveBeenCalledWith('ws-1')
  })

  it('triggers fork session from context menu', () => {
    render(
      <SessionContextActions {...frameworkSeats}
        sessionId={sessionId as never}
        useSessions={useSessions as never}
        useWorkspaces={useWorkspaces as never}
        startSession={startSession}
        forkSession={forkSession}
        t={t}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /新会话/i }))
    fireEvent.click(screen.getByRole('menuitem', { name: /分叉会话/i }))

    expect(forkSession).toHaveBeenCalledWith(sessionId)
  })
})
