// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { AutomationAction } from '../src/client/AutomationAction.tsx'

afterEach(cleanup)

const task = {
  id: 'task-1',
  title: 'Atualizar prazos',
  status: 'ACTIVE' as const,
  scheduleType: 'INTERVAL' as const,
  nextRunAt: '2026-09-10T12:00:00.000Z',
  lastRunAt: null,
  totalRunsCompleted: 0,
  maxRuns: null,
  createdAt: '2026-09-10T10:00:00.000Z',
  updatedAt: '2026-09-10T10:00:00.000Z',
}

describe('AutomationAction', () => {
  it('loads persisted tasks and triggers the selected task from the native panel', async () => {
    const list = vi.fn(() => Promise.resolve([task]))
    const trigger = vi.fn(() => Promise.resolve({ runId: 'run-1' }))
    render(<AutomationAction list={list} trigger={trigger} pause={vi.fn()} resume={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: 'Automações' }))
    expect(await screen.findByText('Atualizar prazos')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Executar agora: Atualizar prazos' }))
    await waitFor(() => { expect(trigger).toHaveBeenCalledWith('task-1') })
  })
})
