// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SessionNotesPopover } from '../src/client/header/SessionNotesPopover.tsx'
import type { SessionNotesPopoverProps } from '../src/client/header/SessionNotesPopover.tsx'
import { zh } from '../src/client/locales.ts'

const t = ((key: keyof typeof zh) => zh[key] ?? key) as never

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
    render(<SessionNotesPopover {...({ sessionId, inputActions, t } as unknown as SessionNotesPopoverProps)} />)
    const trigger = screen.getByRole('button', { name: /备注/i })
    expect(trigger).toBeDefined()
  })

  it('opens dialog, allows typing notes and auto-saves to localStorage', () => {
    render(<SessionNotesPopover {...({ sessionId, inputActions, t } as unknown as SessionNotesPopoverProps)} />)
    const trigger = screen.getByRole('button', { name: /备注/i })
    fireEvent.click(trigger)

    const textarea = screen.getByPlaceholderText(/自由笔记/i)
    fireEvent.change(textarea, { target: { value: 'Minhas anotações importantes para o caso' } })

    expect(localStorage.getItem(`dsh.session.notes.${sessionId}`)).toContain('Minhas anotações importantes para o caso')
  })

  it('switches to reminders tab and adds a new reminder', () => {
    render(<SessionNotesPopover {...({ sessionId, inputActions, t } as unknown as SessionNotesPopoverProps)} />)
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

    render(<SessionNotesPopover {...({ sessionId, inputActions, t } as unknown as SessionNotesPopoverProps)} />)
    fireEvent.click(screen.getByRole('button', { name: /备注/i }))

    const insertBtn = screen.getByRole('button', { name: /插入到输入框/i })
    fireEvent.click(insertBtn)

    expect(setDraft).toHaveBeenCalledWith(expect.stringContaining('Verificar tempestividade do recurso'))
    expect(setDraft).toHaveBeenCalledWith(expect.stringContaining('Conferir guia de custas'))
  })
})
