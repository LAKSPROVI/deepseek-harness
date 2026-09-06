// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SessionNotesPopover } from '../src/client/header/SessionNotesPopover.tsx'
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

describe('SessionNotesPopover', () => {
  const sessionId = 'test-session-123'
  const setDraft = vi.fn()
  const inputActions = { setDraft } as never

  beforeEach(() => {
    localStorage.clear()
    setDraft.mockClear()
  })

  afterEach(cleanup)

  it('renders the trigger button with notes label', () => {
    render(<SessionNotesPopover {...frameworkSeats} sessionId={sessionId as never} inputActions={inputActions} t={t} />)
    const trigger = screen.getByRole('button', { name: /备注/i })
    expect(trigger).toBeDefined()
  })

  it('opens dialog, allows typing notes and auto-saves to localStorage', () => {
    render(<SessionNotesPopover {...frameworkSeats} sessionId={sessionId as never} inputActions={inputActions} t={t} />)
    const trigger = screen.getByRole('button', { name: /备注/i })
    fireEvent.click(trigger)

    const textarea = screen.getByPlaceholderText(/自由笔记/i)
    fireEvent.change(textarea, { target: { value: 'Minhas anotações importantes para o caso' } })

    expect(localStorage.getItem(`dsh.session.notes.${sessionId}`)).toContain('Minhas anotações importantes para o caso')
  })

  it('switches to reminders tab and adds a new reminder', () => {
    render(<SessionNotesPopover {...frameworkSeats} sessionId={sessionId as never} inputActions={inputActions} t={t} />)
    fireEvent.click(screen.getByRole('button', { name: /备注/i }))

    // Switch to reminders tab
    fireEvent.click(screen.getByRole('tab', { name: /未来提醒/i }))
    expect(screen.getByText(/当前会话暂无待办提醒/i)).toBeDefined()

    // Add a reminder
    const textInput = screen.getByPlaceholderText(/输入新的待办/i)
    const dueInput = screen.getByPlaceholderText(/期限\/时间/i)
    fireEvent.change(textInput, { target: { value: 'Protocolar petição de juntada' } })
    fireEvent.change(dueInput, { target: { value: 'Amanhã 15h' } })

    fireEvent.click(screen.getByTitle(/添加/i))

    expect(screen.getByText('Protocolar petição de juntada')).toBeDefined()
    expect(screen.getByText('⏰ Amanhã 15h')).toBeDefined()

    // Check localStorage persistence
    const saved = localStorage.getItem(`dsh.session.notes.${sessionId}`)
    expect(saved).toContain('Protocolar petição de juntada')
  })

  it('inserts notes and reminders into chat composer via inputActions.setDraft', () => {
    // Seed localStorage
    localStorage.setItem(`dsh.session.notes.${sessionId}`, JSON.stringify({
      notes: 'Verificar tempestividade do recurso',
      reminders: [{ id: '1', text: 'Conferir guia de custas', completed: false, createdAt: Date.now() }],
    }))

    render(<SessionNotesPopover {...frameworkSeats} sessionId={sessionId as never} inputActions={inputActions} t={t} />)
    fireEvent.click(screen.getByRole('button', { name: /备注/i }))

    const insertBtn = screen.getByRole('button', { name: /插入到输入框/i })
    fireEvent.click(insertBtn)

    expect(setDraft).toHaveBeenCalledWith(expect.stringContaining('Verificar tempestividade do recurso'))
    expect(setDraft).toHaveBeenCalledWith(expect.stringContaining('Conferir guia de custas'))
  })
})
