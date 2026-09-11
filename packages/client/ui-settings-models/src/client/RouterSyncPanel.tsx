/**
 * 9Router live dynamic models synchronization status panel and immediate sync trigger.
 */

import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { RouterSyncStatus } from '@deepseek-ai/dsh-api-remotes/client'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ModelsOperations } from './operations.ts'
import type { en } from './locales.ts'
import styles from './ModelsSection.module.css'

/** Props of {@link RouterSyncPanel}. */
export interface RouterSyncPanelProps {
  /** Host operations for querying and triggering sync. */
  operations: Pick<ModelsOperations, 'getRouterSyncStatus' | 'triggerRouterSync'>
  /** Section copy dictionary lookup. */
  t: (key: keyof typeof en) => string
  /** Whether the surface is read-only or in a pending parent operation. */
  disabled: boolean
  /** Optional callback fired when a manual sync finishes successfully. */
  onSyncComplete?: (status: RouterSyncStatus) => void
}

/**
 * Format an ISO timestamp string into a concise human-readable locale string.
 * @param iso - ISO 8601 timestamp string.
 * @returns formatted date/time string or fallback.
 */
export function formatSyncTimestamp(iso?: string): string {
  if (iso === undefined || iso.length === 0) return '—'
  try {
    const date = new Date(iso)
    if (Number.isNaN(date.getTime())) return iso
    return date.toLocaleString(undefined, {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
  } catch {
    return iso
  }
}

/**
 * Render the 9Router live synchronization card with real-time status and trigger.
 * @param props - operations face, copy lookup, disabled state, and completion callback.
 * @returns the synchronization panel.
 */
export function RouterSyncPanel(props: RouterSyncPanelProps): ReactNode {
  const { operations, t, disabled, onSyncComplete } = props
  const [status, setStatus] = useState<RouterSyncStatus | undefined>(undefined)
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)

  const loadStatus = async (): Promise<void> => {
    try {
      const res = await operations.getRouterSyncStatus()
      if (res !== undefined) {
        setStatus(res)
        setError(undefined)
      } else {
        setError(t('routerSyncFailed'))
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadStatus()
  }, [operations])

  const handleTriggerSync = async (): Promise<void> => {
    setSyncing(true)
    setError(undefined)
    try {
      const res = await operations.triggerRouterSync()
      if (res !== undefined) {
        setStatus(res)
        onSyncComplete?.(res)
      } else {
        setError(t('routerSyncFailed'))
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSyncing(false)
    }
  }

  if (loading && status === undefined && error === undefined) {
    return null
  }

  const isFailed = error !== undefined || status?.error !== undefined
  const isStale = status?.isStale === true && !isFailed

  const badgeClass = isFailed
    ? styles['syncBadgeFailed']
    : isStale
      ? styles['syncBadgeStale']
      : styles['syncBadgeOperational']

  const badgeText = isFailed
    ? t('routerSyncFailed')
    : isStale
      ? t('routerSyncStale')
      : t('routerSyncOperational')

  const activeModelsText = t('routerSyncActiveModels')
    .replace('{chat}', String(status?.publishedChatModels ?? 0))
    .replace('{available}', String(status?.availableRoutes ?? 0))
    .replace('{total}', String(status?.totalRoutes ?? 0))

  const lastSyncText = t('routerSyncLastSync')
    .replace('{time}', formatSyncTimestamp(status?.synchronizedAt))

  const monitorUpdateText = t('routerSyncMonitorUpdate')
    .replace('{time}', formatSyncTimestamp(status?.monitorUpdatedAt))

  return (
    <div className={styles['syncPanel']} data-testid="router-sync-panel">
      <div className={styles['syncHeader']}>
        <span className={styles['syncTitle']}>{t('routerSyncTitle')}</span>
        <span className={`${styles['syncBadge']} ${badgeClass}`}>
          <span className={styles['syncBadgeDot']} />
          {badgeText}
        </span>
      </div>

      <div className={styles['syncMetrics']}>
        <div className={styles['syncMetricRow']}>
          <span className={styles['syncMetricLabel']}>{lastSyncText}</span>
          <span className={styles['syncMetricValue']}>{activeModelsText}</span>
        </div>
        {status?.monitorUpdatedAt !== undefined ? (
          <div className={styles['syncMetricRow']}>
            <span className={styles['syncMetricLabel']}>{monitorUpdateText}</span>
          </div>
        ) : null}
        {status?.visionModels !== undefined || status?.reasoningModels !== undefined || status?.averageLatencySeconds !== undefined ? (
          <div className={styles['syncChips']}>
            {status.visionModels !== undefined ? (
              <span className={styles['syncChip']}>
                {t('routerSyncVisionBadge').replace('{count}', String(status.visionModels))}
              </span>
            ) : null}
            {status.reasoningModels !== undefined ? (
              <span className={styles['syncChip']}>
                {t('routerSyncReasoningBadge').replace('{count}', String(status.reasoningModels))}
              </span>
            ) : null}
            {status.averageLatencySeconds !== undefined ? (
              <span className={styles['syncChip']}>
                {t('routerSyncLatencyBadge').replace('{latency}', String(status.averageLatencySeconds))}
              </span>
            ) : null}
          </div>
        ) : null}
      </div>

      {isStale ? (
        <p className={styles['syncWarning']}>{t('routerSyncStaleWarning')}</p>
      ) : null}

      {error !== undefined ? (
        <p className={styles['syncError']}>{error}</p>
      ) : status?.error !== undefined ? (
        <p className={styles['syncError']}>{status.error}</p>
      ) : null}

      <div className={styles['syncActions']}>
        <Button
          size="sm"
          disabled={disabled || syncing}
          onClick={() => { void handleTriggerSync() }}
          aria-label={t('routerSyncTrigger')}
        >
          {syncing ? t('routerSyncBusy') : t('routerSyncTrigger')}
        </Button>
      </div>
    </div>
  )
}
