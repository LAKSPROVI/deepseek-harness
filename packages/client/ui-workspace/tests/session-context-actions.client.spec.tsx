// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SessionContextActions } from '../src/client/header/SessionContextActions.tsx'
import type { SessionContextActionsProps } from '../src/client/header/SessionContextActions.tsx'
import { zh } from '../src/client/locales.ts'

const t = ((key: keyof typeof zh) => zh[key] ?? key) as never

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
      <SessionContextActions
        {...({ sessionId, useSessions, useWorkspaces, startSession, forkSession, t } as unknown as SessionContextActionsProps)}
      />,
    )

    const trigger = screen.getByRole('button', { name: /新会话/i })
    expect(trigger).toBeDefined()
  })

  it('opens dropdown and executes start clean session in same workspace', () => {
    render(
      <SessionContextActions
        {...({ sessionId, useSessions, useWorkspaces, startSession, forkSession, t } as unknown as SessionContextActionsProps)}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /新会话/i }))

    const cleanBtn = screen.getByRole('menuitem', { name: /新空白会话/i })
    fireEvent.click(cleanBtn)

    expect(startSession).toHaveBeenCalledWith('ws-1')
  })

  it('triggers fork session from context menu', () => {
    render(
      <SessionContextActions
        {...({ sessionId, useSessions, useWorkspaces, startSession, forkSession, t } as unknown as SessionContextActionsProps)}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /新会话/i }))
    fireEvent.click(screen.getByRole('menuitem', { name: /分叉会话/i }))

    expect(forkSession).toHaveBeenCalledWith(sessionId)
  })
})
