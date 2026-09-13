/** Full CRUD settings section for the durable prompt library. */

import { useState } from 'react'
import {
  Button, IconEditOutline16, IconPlusOutline16, IconTrashOutline16, IconWarningOutline16,
} from '@deepseek-ai/dsh-client-ui-primitives'
import {
  MAX_PROMPT_AGGREGATE_CHARS, MAX_PROMPT_BODY_CHARS, MAX_PROMPT_COUNT, MAX_PROMPT_TITLE_CHARS,
  beginsWithSlashCommand, type SavedPrompt,
} from '../prompt-settings.ts'
import type { PromptDraft, PromptLibrarySettingsProps } from './slots.ts'
import { validatePromptList } from './validation.ts'
import css from './PromptLibrarySettingsSection.module.css'

const EMPTY_DRAFT: PromptDraft = { title: '', body: '' }

/**
 * Render ordered prompt CRUD. Settings are unavailable unless the namespace is
 * ready, Host-backed, and writable.
 * @param props - derived root runtime, locale, and shared-store faces.
 * @returns the settings page.
 */
export function PromptLibrarySettingsSection({
  usePromptLibrary, createPrompt, updatePrompt, deletePrompt, t,
}: PromptLibrarySettingsProps) {
  const state = usePromptLibrary(value => value)
  const [editing, setEditing] = useState<string | 'new' | null>(null)
  const [draft, setDraft] = useState<PromptDraft>(EMPTY_DRAFT)
  const [localError, setLocalError] = useState<string | null>(null)
  const available = state.status === 'ready' && state.mode === 'host' && state.writable

  const beginEdit = (prompt: SavedPrompt): void => {
    setEditing(prompt.id)
    setDraft({ title: prompt.title, body: prompt.body })
    setLocalError(null)
  }
  const cancel = (): void => {
    setEditing(null)
    setDraft(EMPTY_DRAFT)
    setLocalError(null)
  }
  const save = async (): Promise<void> => {
    const candidate = editing === 'new'
      ? [...state.prompts, { id: '__draft__', ...draft }]
      : state.prompts.map(prompt => prompt.id === editing ? { ...prompt, ...draft } : prompt)
    const validation = validatePromptList(candidate)
    if (!validation.ok) {
      setLocalError(t(validation.key, { count: validation.count }))
      return
    }
    try {
      if (editing === 'new') await createPrompt(draft.title, draft.body)
      else if (editing !== null) await updatePrompt(editing, draft.title, draft.body)
      cancel()
    } catch {
      setLocalError(t('error.save'))
    }
  }

  return (
    <section className={css.section}>
      <header className={css.header}>
        <div>
          <h2 className={css.heading}>{t('settings.title')}</h2>
          <p className={css.description}>{t('settings.description')}</p>
        </div>
        <Button
          size="sm"
          variant="outline"
          icon={<IconPlusOutline16 />}
          disabled={!available || state.prompts.length >= MAX_PROMPT_COUNT || editing !== null}
          onClick={() => { setEditing('new'); setDraft(EMPTY_DRAFT); setLocalError(null) }}
        >
          {t('action.add')}
        </Button>
      </header>

      {state.status === 'loading' && <p className={css.notice}>{t('settings.loading')}</p>}
      {!available && state.status !== 'loading' && <p className={css.unavailable}>{t('settings.unavailable')}</p>}
      {available && state.prompts.length === 0 && editing !== 'new' && <p className={css.notice}>{t('settings.empty')}</p>}

      {editing !== null && (
        <div className={css.editor}>
          <label className={css.label}>
            <span>{t('field.title')}</span>
            <input
              value={draft.title}
              maxLength={MAX_PROMPT_TITLE_CHARS}
              onChange={(event) => {
                const title = event.currentTarget.value
                setDraft(value => ({ ...value, title }))
                setLocalError(null)
              }}
            />
          </label>
          <label className={css.label}>
            <span>{t('field.body')}</span>
            <textarea
              value={draft.body}
              maxLength={MAX_PROMPT_BODY_CHARS}
              rows={8}
              onChange={(event) => {
                const body = event.currentTarget.value
                setDraft(value => ({ ...value, body }))
                setLocalError(null)
              }}
            />
          </label>
          {beginsWithSlashCommand(draft.body) && (
            <p className={css.slashWarning}><IconWarningOutline16 />{t('warning.slash')}</p>
          )}
          {localError !== null && <p className={css.error} role="alert">{localError}</p>}
          <div className={css.editorActions}>
            <span className={css.count}>{t('count', { used: draft.body.length, max: MAX_PROMPT_BODY_CHARS })}</span>
            <Button size="sm" variant="ghost" disabled={state.saving} onClick={cancel}>{t('action.cancel')}</Button>
            <Button size="sm" disabled={state.saving} onClick={() => { void save() }}>{t('action.save')}</Button>
          </div>
        </div>
      )}

      <div className={css.list}>
        {state.prompts.map(prompt => (
          <article key={prompt.id} className={css.card}>
            <div className={css.cardText}>
              <h3>{prompt.title}</h3>
              <p>{prompt.body}</p>
              {beginsWithSlashCommand(prompt.body) && (
                <span className={css.slashWarning}><IconWarningOutline16 />{t('warning.slash')}</span>
              )}
            </div>
            <div className={css.cardActions}>
              <Button
                size="sm"
                variant="toolbar"
                icon={<IconEditOutline16 />}
                disabled={!available || editing !== null}
                aria-label={`${t('action.edit')}: ${prompt.title}`}
                onClick={() => { beginEdit(prompt) }}
              />
              <Button
                size="sm"
                variant="toolbar"
                icon={<IconTrashOutline16 />}
                disabled={!available || editing !== null || state.saving}
                aria-label={`${t('action.delete')}: ${prompt.title}`}
                onClick={() => { void deletePrompt(prompt.id) }}
              />
            </div>
          </article>
        ))}
      </div>
      <span className={css.aggregate}>{t('count', {
        used: state.prompts.reduce((sum, prompt) => sum + prompt.title.length + prompt.body.length, 0),
        max: MAX_PROMPT_AGGREGATE_CHARS,
      })}</span>
    </section>
  )
}
