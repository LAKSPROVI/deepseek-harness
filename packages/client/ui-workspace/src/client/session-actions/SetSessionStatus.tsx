/**
 * The triage action: a `sidebar.workspaces.session.menu.item` row opening the
 * status picker, and the `shell.overlay` dialog that applies the selection.
 * The dialog lives outside the row menu because the row unmounts with it.
 * Browser-local only: the status rides the Workspace view store, never the Host.
 */
import { useState } from 'react'
import { Button, IconChecklistOutlineRegular, MenuItemButton, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SessionMenuItemProps, SessionStatusDialogProps, SessionStatusInjected } from '../contract/slots.ts'
import type { CustomSessionStatus } from '../stores.ts'
import css from '../rows/WorkspaceBrowser.module.css'

/** The status picker's radio options, in menu order. */
const STATUS_OPTIONS: readonly CustomSessionStatus[] = [
  'idle', 'warning', 'unread', 'completed', 'finalized', 'later',
]

const STATUS_LABEL_KEYS: Record<CustomSessionStatus, string> = {
  ongoing: 'status.running',
  idle: 'status.setOngoing',
  warning: 'status.setWaitingDecision',
  unread: 'status.setUnread',
  completed: 'status.setCompleted',
  finalized: 'status.setFinalized',
  later: 'status.setLater',
}

/**
 * Menu row (order 250, between rename and fork): raise the status picker.
 * @param props - owner share, menu open state, and the injected request hop.
 * @returns the row.
 */
export function SetSessionStatusMenuItem({
  sessionId, useMenuOpenState, requestSessionStatus, t,
}: SessionMenuItemProps<SessionStatusInjected>) {
  const [, setMenuOpen] = useMenuOpenState()
  return (
    <MenuItemButton
      icon={<IconChecklistOutlineRegular />}
      onSelect={() => {
        setMenuOpen(false)
        requestSessionStatus(sessionId)
      }}
    >
      {t('menu.setStatus')}
    </MenuItemButton>
  )
}

/**
 * The `shell.overlay` entry: one modal per pending request, listing the six
 * browser-local statuses; confirming applies the pick through the view store.
 * @param props - the pending request hook, its settlement, the store action, and the locale seat.
 * @returns the open dialog, or null.
 */
export function SessionStatusDialog({
  useStatusRequest, settleSessionStatus, setSessionStatus, t,
}: SessionStatusDialogProps) {
  const pending = useStatusRequest(p => p)
  if (pending === null) return null
  return (
    <StatusForm
      key={pending}
      sessionId={pending}
      setSessionStatus={setSessionStatus}
      onSettle={settleSessionStatus}
      t={t}
    />
  )
}

/** One request's dialog: draft status on mount; apply persists and closes. */
function StatusForm({ sessionId, setSessionStatus, onSettle, t }: {
  sessionId: SessionId
  setSessionStatus: SessionStatusDialogProps['setSessionStatus']
  onSettle: () => void
  t: SessionStatusDialogProps['t']
}) {
  const [draft, setDraft] = useState<CustomSessionStatus>('warning')
  return (
    <Modal
      open
      onClose={onSettle}
      closeLabel={t('close')}
      title={t('menu.setStatus')}
      footer={(
        <>
          <Button onClick={onSettle}>{t('cancel')}</Button>
          <Button
            variant="primary"
            onClick={() => { setSessionStatus(sessionId, draft); onSettle() }}
          >
            {t('save')}
          </Button>
        </>
      )}
    >
      <div className={css.statusOptions}>
        {STATUS_OPTIONS.map(option => (
          <label key={option} className={css.statusOption}>
            <input
              type="radio"
              name="session-custom-status"
              checked={draft === option}
              onChange={() => { setDraft(option) }}
            />
            <span>{t(STATUS_LABEL_KEYS[option] as Parameters<SessionStatusDialogProps['t']>[0])}</span>
          </label>
        ))}
      </div>
    </Modal>
  )
}
