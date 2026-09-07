/** Searchable composer overlay for inserting one saved prompt into the draft. */

import { useMemo, useState } from 'react'
import { IconSearchOutline16, IconWarningOutline16, Input } from '@deepseek-ai/dsh-client-ui-primitives'
import { beginsWithSlashCommand, insertPromptBody } from '../prompt-settings.ts'
import type { PromptLibraryOverlayProps } from './slots.ts'
import css from './PromptLibraryOverlay.module.css'

/**
 * Render the searchable prompt picker. Selection writes the full next draft
 * through `inputActions.setDraft` and never invokes submit.
 * @param props - derived session runtime, locale, and shared-store faces.
 * @returns the floating picker, or null while closed.
 */
export function PromptLibraryOverlay({
  useInput, inputActions, usePromptLibrary, setOverlayOpen, t,
}: PromptLibraryOverlayProps) {
  const draft = useInput(state => state.draft)
  const open = usePromptLibrary(state => state.overlayOpen)
  const status = usePromptLibrary(state => state.status)
  const prompts = usePromptLibrary(state => state.prompts)
  const [query, setQuery] = useState('')
  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase()
    if (needle === '') return prompts
    return prompts.filter(prompt => `${prompt.title}\n${prompt.body}`.toLocaleLowerCase().includes(needle))
  }, [prompts, query])

  if (!open) return null
  return (
    <section className={css.overlay} role="dialog" aria-label={t('launcher.label')}>
      <Input
        autoFocus
        icon={<IconSearchOutline16 />}
        value={query}
        aria-label={t('overlay.search')}
        placeholder={t('overlay.search')}
        onChange={(event) => { setQuery(event.currentTarget.value) }}
      />
      <div className={css.list} role="listbox">
        {status !== 'ready' && <p className={css.empty}>{t('overlay.unavailable')}</p>}
        {status === 'ready' && filtered.length === 0 && <p className={css.empty}>{t('overlay.empty')}</p>}
        {status === 'ready' && filtered.map(prompt => (
          <button
            key={prompt.id}
            type="button"
            className={css.item}
            role="option"
            aria-selected="false"
            onClick={() => {
              inputActions.setDraft(insertPromptBody(draft, prompt.body))
              setOverlayOpen(false)
              setQuery('')
            }}
          >
            <span className={css.title}>{prompt.title}</span>
            <span className={css.preview}>{prompt.body}</span>
            {beginsWithSlashCommand(prompt.body) && (
              <span className={css.warning} title={t('warning.slash')}>
                <IconWarningOutline16 />
                <span>{t('warning.slash')}</span>
              </span>
            )}
          </button>
        ))}
      </div>
    </section>
  )
}
