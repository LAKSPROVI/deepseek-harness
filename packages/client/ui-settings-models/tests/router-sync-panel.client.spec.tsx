// @vitest-environment jsdom
/** 9Router synchronization panel component tests. */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RouterSyncPanel, formatSyncTimestamp } from '../src/client/RouterSyncPanel.tsx'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

const t = (key: keyof typeof en): string => en[key]

describe('formatSyncTimestamp', () => {
  it('handles empty and undefined input', () => {
    expect(formatSyncTimestamp(undefined)).toBe('—')
    expect(formatSyncTimestamp('')).toBe('—')
  })

  it('formats valid ISO date strings', () => {
    const res = formatSyncTimestamp('2026-09-04T00:15:05.029Z')
    expect(res).not.toBe('—')
    expect(res.length).toBeGreaterThan(5)
  })
})

describe('RouterSyncPanel', () => {
  it('renders operational badge and metrics when state is fresh', async () => {
    const operations = {
      getRouterSyncStatus: vi.fn().mockResolvedValue({
        synchronizedAt: '2026-09-04T00:15:05.029Z',
        monitorUpdatedAt: '2026-09-03T21:48:22.045676Z',
        totalRoutes: 1223,
        availableRoutes: 129,
        publishedChatModels: 125,
        visionModels: 36,
        reasoningModels: 36,
        averageLatencySeconds: 2.886,
        isStale: false,
      }),
      triggerRouterSync: vi.fn(),
    }

    render(<RouterSyncPanel operations={operations} t={t} disabled={false} />)

    await waitFor(() => {
      expect(screen.getByText(en.routerSyncTitle)).toBeDefined()
      expect(screen.getByText(en.routerSyncOperational)).toBeDefined()
      expect(screen.getByText(/125 active chat models/i)).toBeDefined()
      expect(screen.getByText('36 vision')).toBeDefined()
      expect(screen.getByText('36 reasoning')).toBeDefined()
      expect(screen.getByText('2.886s avg latency')).toBeDefined()
    })
  })

  it('renders stale warning when isStale is true', async () => {
    const operations = {
      getRouterSyncStatus: vi.fn().mockResolvedValue({
        synchronizedAt: '2026-09-01T00:00:00.000Z',
        totalRoutes: 1000,
        availableRoutes: 100,
        publishedChatModels: 95,
        isStale: true,
      }),
      triggerRouterSync: vi.fn(),
    }

    render(<RouterSyncPanel operations={operations} t={t} disabled={false} />)

    await waitFor(() => {
      expect(screen.getByText(en.routerSyncStale)).toBeDefined()
      expect(screen.getByText(en.routerSyncStaleWarning)).toBeDefined()
    })
  })

  it('triggers manual sync on button click and updates metrics', async () => {
    const onSyncComplete = vi.fn()
    const operations = {
      getRouterSyncStatus: vi.fn().mockResolvedValue({
        synchronizedAt: '2026-09-01T00:00:00.000Z',
        totalRoutes: 1000,
        availableRoutes: 100,
        publishedChatModels: 95,
        isStale: true,
      }),
      triggerRouterSync: vi.fn().mockResolvedValue({
        synchronizedAt: '2026-09-04T00:20:00.000Z',
        totalRoutes: 1223,
        availableRoutes: 129,
        publishedChatModels: 125,
        isStale: false,
      }),
    }

    render(<RouterSyncPanel operations={operations} t={t} disabled={false} onSyncComplete={onSyncComplete} />)

    await waitFor(() => {
      expect(screen.getByText(en.routerSyncTrigger)).toBeDefined()
    })

    fireEvent.click(screen.getByText(en.routerSyncTrigger))

    await waitFor(() => {
      expect(operations.triggerRouterSync).toHaveBeenCalledTimes(1)
      expect(onSyncComplete).toHaveBeenCalledTimes(1)
      expect(screen.getByText(en.routerSyncOperational)).toBeDefined()
      expect(screen.getByText(/125 active chat models/i)).toBeDefined()
    })
  })

  it('displays error message when status query or trigger fails', async () => {
    const operations = {
      getRouterSyncStatus: vi.fn().mockRejectedValue(new Error('Custom sync error occurred')),
      triggerRouterSync: vi.fn(),
    }

    render(<RouterSyncPanel operations={operations} t={t} disabled={false} />)

    await waitFor(() => {
      expect(screen.getAllByText(en.routerSyncFailed).length).toBeGreaterThanOrEqual(1)
      expect(screen.getByText('Custom sync error occurred')).toBeDefined()
    })
  })
})

describe('formatSyncTimestamp fallbacks', () => {
  it('returns the raw input for an unparsable date or a formatter failure', () => {
    expect(formatSyncTimestamp('not-a-date')).toBe('not-a-date')
    const toLocaleString = vi.spyOn(Date.prototype, 'toLocaleString').mockImplementationOnce(() => {
      throw new RangeError('formatter unavailable')
    })
    expect(formatSyncTimestamp('2026-09-04T00:15:05.029Z')).toBe('2026-09-04T00:15:05.029Z')
    toLocaleString.mockRestore()
  })
})

describe('RouterSyncPanel degraded paths', () => {
  const fresh = { totalRoutes: 10, availableRoutes: 5, publishedChatModels: 4, isStale: false }

  it('reports a refused status query and a bare rejection reason', async () => {
    const refused = { getRouterSyncStatus: vi.fn().mockResolvedValue(undefined), triggerRouterSync: vi.fn() }
    render(<RouterSyncPanel operations={refused} t={t} disabled={false} />)
    await waitFor(() => {
      expect(screen.getAllByText(en.routerSyncFailed).length).toBeGreaterThanOrEqual(1)
    })
    cleanup()

    const bare = { getRouterSyncStatus: vi.fn().mockRejectedValue('offline'), triggerRouterSync: vi.fn() }
    render(<RouterSyncPanel operations={bare} t={t} disabled={false} />)
    await waitFor(() => {
      expect(screen.getByText('offline')).toBeDefined()
    })
  })

  it('reports a refused, failing, or bare-rejected manual sync', async () => {
    const operations = {
      getRouterSyncStatus: vi.fn().mockResolvedValue(fresh),
      triggerRouterSync: vi.fn()
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error('sync exploded'))
        .mockRejectedValueOnce('sync offline'),
    }
    render(<RouterSyncPanel operations={operations} t={t} disabled={false} />)
    await waitFor(() => {
      expect(screen.getByText(en.routerSyncTrigger)).toBeDefined()
    })

    fireEvent.click(screen.getByText(en.routerSyncTrigger))
    await waitFor(() => {
      expect(screen.getAllByText(en.routerSyncFailed).length).toBeGreaterThanOrEqual(1)
    })
    fireEvent.click(screen.getByText(en.routerSyncTrigger))
    await waitFor(() => {
      expect(screen.getByText('sync exploded')).toBeDefined()
    })
    fireEvent.click(screen.getByText(en.routerSyncTrigger))
    await waitFor(() => {
      expect(screen.getByText('sync offline')).toBeDefined()
    })
  })

  it('shows only the telemetry chips the status carries and the error the state file recorded', async () => {
    const operations = {
      getRouterSyncStatus: vi.fn().mockResolvedValue({ ...fresh, visionModels: 3, error: 'Network timeout' }),
      triggerRouterSync: vi.fn(),
    }
    render(<RouterSyncPanel operations={operations} t={t} disabled={false} />)
    await waitFor(() => {
      expect(screen.getByText('3 vision')).toBeDefined()
      expect(screen.getByText('Network timeout')).toBeDefined()
    })
    expect(screen.queryByText(/reasoning$/)).toBeNull()
    expect(screen.queryByText(/avg latency$/)).toBeNull()
    cleanup()

    const reasoningOnly = {
      getRouterSyncStatus: vi.fn().mockResolvedValue({ ...fresh, reasoningModels: 2 }),
      triggerRouterSync: vi.fn(),
    }
    render(<RouterSyncPanel operations={reasoningOnly} t={t} disabled={false} />)
    await waitFor(() => {
      expect(screen.getByText('2 reasoning')).toBeDefined()
    })
    expect(screen.queryByText(/vision$/)).toBeNull()
  })
})
