/**
 * Session Notes & Reminders header utility popover.
 * Allows users to take structured notes, manage future follow-up reminders,
 * copy notes, or inject them into the chat input composer.
 */

import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import clsx from 'clsx'
import {
  IconListPenOutline16, IconPlusOutline16, writeClipboard, useDismissOnOutsidePointer,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { NS } from '../locales.ts'
import css from './SessionNotesPopover.module.css'

export interface SessionReminder {
  id: string
  text: string
  due?: string | undefined
  completed: boolean
  createdAt: number
}

export interface SessionNotesData {
  notes: string
  reminders: SessionReminder[]
}

const STORAGE_KEY_PREFIX = 'dsh.session.notes.'

function loadNotesData(sessionId: string): SessionNotesData {
  try {
    const raw = localStorage.getItem(`${STORAGE_KEY_PREFIX}${sessionId}`)
    if (raw !== null && raw !== '') {
      const parsed = JSON.parse(raw) as Partial<SessionNotesData>
      return {
        notes: typeof parsed.notes === 'string' ? parsed.notes : '',
        reminders: Array.isArray(parsed.reminders) ? parsed.reminders : [],
      }
    }
  } catch {
    // Ignore storage parse errors
  }
  return { notes: '', reminders: [] }
}

function saveNotesData(sessionId: string, data: SessionNotesData): void {
  try {
    localStorage.setItem(`${STORAGE_KEY_PREFIX}${sessionId}`, JSON.stringify(data))
  } catch {
    // Ignore storage write errors
  }
}

export type SessionNotesPopoverProps = PropsRuntime<'conversation.session.header.utilities'> & PropsLocale<typeof NS>

export function SessionNotesPopover({ sessionId, inputActions, t }: SessionNotesPopoverProps) {
  const [open, setOpen] = useState(false)
  const [activeTab, setActiveTab] = useState<'notes' | 'reminders'>('notes')
  const [data, setData] = useState<SessionNotesData>(() => loadNotesData(sessionId))
  const [newReminderText, setNewReminderText] = useState('')
  const [newReminderDue, setNewReminderDue] = useState('')
  const [copied, setCopied] = useState(false)

  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)

  useDismissOnOutsidePointer(rootRef, open, setOpen)

  // Reload notes when session changes
  useEffect(() => {
    setData(loadNotesData(sessionId))
  }, [sessionId])

  const pendingRemindersCount = data.reminders.filter(r => !r.completed).length

  const handleNotesChange = (text: string) => {
    const updated = { ...data, notes: text }
    setData(updated)
    saveNotesData(sessionId, updated)
  }

  const handleAddReminder = () => {
    const trimmed = newReminderText.trim()
    if (trimmed === '') return
    const reminder: SessionReminder = {
      id: `rem-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      text: trimmed,
      ...(newReminderDue.trim() ? { due: newReminderDue.trim() } : {}),
      completed: false,
      createdAt: Date.now(),
    }
    const updated = {
      ...data,
      reminders: [...data.reminders, reminder],
    }
    setData(updated)
    saveNotesData(sessionId, updated)
    setNewReminderText('')
    setNewReminderDue('')
  }

  const handleToggleReminder = (id: string) => {
    const updated = {
      ...data,
      reminders: data.reminders.map(r => (r.id === id ? { ...r, completed: !r.completed } : r)),
    }
    setData(updated)
    saveNotesData(sessionId, updated)
  }

  const handleDeleteReminder = (id: string) => {
    const updated = {
      ...data,
      reminders: data.reminders.filter(r => r.id !== id),
    }
    setData(updated)
    saveNotesData(sessionId, updated)
  }

  const handleInsertInChat = () => {
    let payload = ''
    if (data.notes.trim() !== '') {
      payload += `### Anotações da Sessão:\n${data.notes.trim()}\n\n`
    }
    if (data.reminders.length > 0) {
      payload += '### Lembretes / Tarefas:\n'
      for (const r of data.reminders) {
        payload += `- [${r.completed ? 'x' : ' '}] ${r.text}${r.due ? ` (Prazo: ${r.due})` : ''}\n`
      }
    }
    if (payload.trim() !== '') {
      inputActions.setDraft(payload.trim())
      setOpen(false)
    }
  }

  const handleCopy = () => {
    let textToCopy = ''
    if (data.notes.trim() !== '') {
      textToCopy += `### Anotações da Sessão:\n${data.notes.trim()}\n\n`
    }
    if (data.reminders.length > 0) {
      textToCopy += '### Lembretes / Tarefas:\n'
      for (const r of data.reminders) {
        textToCopy += `- [${r.completed ? 'x' : ' '}] ${r.text}${r.due ? ` (Prazo: ${r.due})` : ''}\n`
      }
    }
    if (textToCopy.trim() !== '') {
      void writeClipboard(textToCopy.trim()).then(() => {
        setCopied(true)
        setTimeout(() => { setCopied(false) }, 2000)
      })
    }
  }

  const handleClear = () => {
    const updated: SessionNotesData = { notes: '', reminders: [] }
    setData(updated)
    saveNotesData(sessionId, updated)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Escape' && open) {
      event.preventDefault()
      setOpen(false)
      triggerRef.current?.focus()
    }
  }

  return (
    <div ref={rootRef} className={css.root} onKeyDown={onKeyDown}>
      <button
        ref={triggerRef}
        type="button"
        className={css.trigger}
        aria-expanded={open}
        aria-label={t('notes.button.aria')}
        title={t('notes.button.aria')}
        onClick={() => { setOpen(v => !v) }}
      >
        <IconListPenOutline16 />
        <span>{t('notes.button.label')}</span>
        {pendingRemindersCount > 0 && (
          <span className={css.triggerBadge}>{pendingRemindersCount}</span>
        )}
      </button>

      {open && (
        <div className={css.popover} role="dialog" aria-label={t('notes.title')}>
          <div className={css.header}>
            <span className={css.title}>{t('notes.title')}</span>
            <button
              type="button"
              className={css.closeButton}
              aria-label={t('notes.action.close')}
              onClick={() => { setOpen(false) }}
            >
              ✕
            </button>
          </div>

          <div className={css.tabs} role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'notes'}
              className={clsx(css.tab, activeTab === 'notes' && css.tabActive)}
              onClick={() => { setActiveTab('notes') }}
            >
              {t('notes.tab.notes')}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'reminders'}
              className={clsx(css.tab, activeTab === 'reminders' && css.tabActive)}
              onClick={() => { setActiveTab('reminders') }}
            >
              {t('notes.tab.reminders')}
              {pendingRemindersCount > 0 ? ` (${pendingRemindersCount})` : ''}
            </button>
          </div>

          <div className={css.body}>
            {activeTab === 'notes' ? (
              <textarea
                className={css.notesArea}
                placeholder={t('notes.placeholder')}
                value={data.notes}
                onChange={(e) => { handleNotesChange(e.target.value) }}
              />
            ) : (
              <>
                <div className={css.remindersList}>
                  {data.reminders.length === 0 ? (
                    <div className={css.emptyState}>{t('notes.reminders.empty')}</div>
                  ) : (
                    data.reminders.map(reminder => (
                      <div
                        key={reminder.id}
                        className={clsx(css.reminderItem, reminder.completed && css.reminderItemDone)}
                      >
                        <input
                          type="checkbox"
                          className={css.reminderCheckbox}
                          checked={reminder.completed}
                          onChange={() => { handleToggleReminder(reminder.id) }}
                        />
                        <div className={css.reminderContent}>
                          <span className={css.reminderText}>{reminder.text}</span>
                          {reminder.due ? <span className={css.reminderDue}>⏰ {reminder.due}</span> : null}
                        </div>
                        <button
                          type="button"
                          className={css.deleteButton}
                          onClick={() => { handleDeleteReminder(reminder.id) }}
                          title="Excluir"
                        >
                          ✕
                        </button>
                      </div>
                    ))
                  )}
                </div>

                <div className={css.addReminderForm}>
                  <div className={css.inputRow}>
                    <input
                      type="text"
                      className={css.reminderInput}
                      placeholder={t('notes.reminders.placeholder')}
                      value={newReminderText}
                      onChange={(e) => { setNewReminderText(e.target.value) }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault()
                          handleAddReminder()
                        }
                      }}
                    />
                    <input
                      type="text"
                      className={css.dueInput}
                      placeholder={t('notes.reminders.duePlaceholder')}
                      value={newReminderDue}
                      onChange={(e) => { setNewReminderDue(e.target.value) }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault()
                          handleAddReminder()
                        }
                      }}
                    />
                    <button
                      type="button"
                      className={css.addButton}
                      onClick={handleAddReminder}
                      title={t('notes.reminders.add')}
                    >
                      <IconPlusOutline16 size={14} />
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>

          <div className={css.footer}>
            <button
              type="button"
              className={css.actionButton}
              onClick={handleClear}
            >
              {t('notes.action.clear')}
            </button>
            <button
              type="button"
              className={css.actionButton}
              onClick={handleCopy}
            >
              {copied ? t('notes.action.copied') : t('notes.action.copy')}
            </button>
            <button
              type="button"
              className={clsx(css.actionButton, css.actionButtonPrimary)}
              onClick={handleInsertInChat}
            >
              {t('notes.action.insertInChat')}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
