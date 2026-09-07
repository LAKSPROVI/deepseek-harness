// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PromptLibrarySettingsSection } from '../src/client/PromptLibrarySettingsSection.tsx'
import { en } from '../src/client/locales.ts'
import type { PromptLibraryState } from '../src/client/store.ts'
import type { PromptLibrarySettingsProps } from '../src/client/slots.ts'

afterEach(cleanup)

const ready: PromptLibraryState = {
  status: 'ready',
  prompts: [],
  writable: true,
  mode: 'host',
  saving: false,
  error: null,
  overlayOpen: false,
}

/** Render the real settings form over a settled Host-backed library. */
function renderSection(createPrompt = vi.fn<(title: string, body: string) => Promise<void>>().mockResolvedValue()) {
  const props = {
    t: (key: keyof typeof en) => en[key],
    usePromptLibrary: (selector: (state: PromptLibraryState) => unknown) => selector(ready),
    createPrompt,
    updatePrompt: vi.fn(),
    deletePrompt: vi.fn(),
  } as unknown as PromptLibrarySettingsProps
  render(<PromptLibrarySettingsSection {...props} />)
  return createPrompt
}

describe('PromptLibrarySettingsSection', () => {
  it('keeps both controlled fields mounted through edits and saves their values', () => {
    const createPrompt = renderSection()
    fireEvent.click(screen.getByRole('button', { name: en['action.add'] }))

    const title = screen.getByRole('textbox', { name: en['field.title'] })
    const body = screen.getByText(en['field.body']).closest('label')?.querySelector('textarea')
    expect(body).not.toBeNull()

    fireEvent.change(title, { target: { value: 'Review architecture' } })
    fireEvent.change(body!, { target: { value: 'Review for correctness and security.' } })

    expect((screen.getByRole('textbox', { name: en['field.title'] }) as HTMLInputElement).value).toBe('Review architecture')
    expect(body?.value).toBe('Review for correctness and security.')
    fireEvent.click(screen.getByRole('button', { name: en['action.save'] }))
    expect(createPrompt).toHaveBeenCalledWith('Review architecture', 'Review for correctness and security.')
  })
})
