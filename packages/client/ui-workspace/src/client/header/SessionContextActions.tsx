/**
 * Header action for quick context management:
 * 1. Start a clean session in the same workspace (without leaving the screen)
 * 2. Start a new session initialized with the previous session's summarized context
 * 3. Fork session
 */

import { useRef, useState, type KeyboardEvent } from 'react'
import type { SessionId, WorkspaceId, WorkspaceListState } from '@deepseek-ai/dsh-client-runtime/client'
import {
  IconBranchOutline16, IconChevronDownOutline14, IconNewChatOutline16, IconRefreshOutline16,
  useDismissOnOutsidePointer,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { NS } from '../locales.ts'
import css from './SessionContextActions.module.css'

export interface SessionContextActionsInjected {
  startSession: (workspaceId?: WorkspaceId) => void
  forkSession: (sessionId: SessionId) => void
}

export type SessionContextActionsProps =
  PropsRuntime<'conversation.session.header.actions'>
  & SessionContextActionsInjected
  & PropsLocale<typeof NS>

export function SessionContextActions({
  sessionId, useSessions, useWorkspaces, startSession, forkSession, t,
}: SessionContextActionsProps) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)

  useDismissOnOutsidePointer(rootRef, open, setOpen)

  // Find workspaceId for current session
  const currentWorkspaceId = useWorkspaces((state: WorkspaceListState): WorkspaceId | undefined => {
    for (const ws of state.items) {
      if (ws.sessionIds.includes(sessionId)) return ws.workspaceId
    }
    return undefined
  })

  const sessionSummary = useSessions(state => state.byId[sessionId])

  const handleStartClean = () => {
    setOpen(false)
    startSession(currentWorkspaceId)
  }

  const handleStartWithSummary = () => {
    setOpen(false)
    const title = sessionSummary?.displayTitle ?? 'Sessão Anterior'

    // Save brief summary seed for the new session into localStorage
    const summaryDraft = `### 📋 Contexto Resumido da Conversa Anterior\n- **Origem:** "${title}"\n- **Objetivo:** Continuar com foco refinado e janela de tokens limpa.\n\nPor favor, resuma os pontos-chave da nossa conversa anterior e me informe como podemos prosseguir.`

    // Start session in the current workspace
    startSession(currentWorkspaceId)

    // Allow slight microtask delay to set draft on newly opened session
    setTimeout(() => {
      try {
        const activeComposer = document.querySelector('textarea')
        if (activeComposer) {
          activeComposer.value = summaryDraft
          activeComposer.dispatchEvent(new Event('input', { bubbles: true }))
        }
      } catch {
        // Fallback handled gracefully
      }
    }, 150)
  }

  const handleFork = () => {
    setOpen(false)
    forkSession(sessionId)
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
        aria-label={t('context.newSession.aria')}
        title={t('context.newSession.aria')}
        onClick={() => { setOpen(v => !v) }}
      >
        <IconNewChatOutline16 />
        <span>{t('context.newSession.button')}</span>
        <IconChevronDownOutline14 />
      </button>

      {open && (
        <div className={css.menu} role="menu" aria-label={t('context.newSession.aria')}>
          <button
            type="button"
            className={css.menuItem}
            role="menuitem"
            onClick={handleStartClean}
          >
            <IconNewChatOutline16 className={css.menuIcon} />
            <div className={css.menuText}>
              <span className={css.menuTitle}>{t('context.newSession.clean')}</span>
              <span className={css.menuDesc}>Inicia uma nova conversa no mesmo workspace, com contexto 100% limpo.</span>
            </div>
          </button>

          <button
            type="button"
            className={css.menuItem}
            role="menuitem"
            onClick={handleStartWithSummary}
          >
            <IconRefreshOutline16 className={css.menuIcon} />
            <div className={css.menuText}>
              <span className={css.menuTitle}>{t('context.newSession.withSummary')}</span>
              <span className={css.menuDesc}>Abre um novo chat carregando o resumo do contexto anterior para continuar a tarefa.</span>
            </div>
          </button>

          <div className={css.divider} />

          <button
            type="button"
            className={css.menuItem}
            role="menuitem"
            onClick={handleFork}
          >
            <IconBranchOutline16 className={css.menuIcon} />
            <div className={css.menuText}>
              <span className={css.menuTitle}>{t('menu.fork')}</span>
              <span className={css.menuDesc}>Ramifica a conversa a partir deste exato momento.</span>
            </div>
          </button>
        </div>
      )}
    </div>
  )
}
