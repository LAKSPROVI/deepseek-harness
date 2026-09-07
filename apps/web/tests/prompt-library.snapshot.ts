// @vitest-environment jsdom
// Persistent prompt-library behavior over the built Web composition and the
// keyless FixtureApiClient transport. The fixture exposes a Host settings view;
// the real plugin loads it, searches it, and writes only to the composer draft.
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { expect, it } from 'vitest'
import { installAssembledBootEnv, mountAssembledApp } from './assembled-boot.ts'

installAssembledBootEnv()

/** Open a fresh fixture session and return its composer textarea. */
async function freshComposer(): Promise<HTMLTextAreaElement> {
  const tree = await screen.findByRole('tree', { name: 'Sessions' }, { timeout: 10_000 })
  const start = tree.querySelector<HTMLButtonElement>('button[aria-label="New session in fixture"]')
  if (start === null) throw new Error('fixture Workspace new-session action missing')
  fireEvent.click(start)
  return await screen.findByPlaceholderText('Describe what you want to build', {}, { timeout: 10_000 }) as HTMLTextAreaElement
}

it('searches a Host-persisted prompt and inserts it without submitting', async () => {
  mountAssembledApp('?fixture&fixturePromptLibrary=1')
  const textarea = await freshComposer()
  const launcher = await screen.findByRole('button', { name: 'Prompt library' }, { timeout: 10_000 })

  fireEvent.click(launcher)
  const dialog = await screen.findByRole('dialog', { name: 'Prompt library' })
  const search = within(dialog).getByRole('textbox', { name: 'Search saved prompts' })
  fireEvent.change(search, { target: { value: 'security' } })
  const option = within(dialog).getByRole('option', { name: /Review change/ })
  fireEvent.click(option)

  await waitFor(() => {
    expect(textarea.value).toBe('Review this change for correctness and security.')
    expect(screen.queryByRole('dialog', { name: 'Prompt library' })).toBeNull()
  })
  expect(document.querySelector('[data-align="end"]')).toBeNull()
})
