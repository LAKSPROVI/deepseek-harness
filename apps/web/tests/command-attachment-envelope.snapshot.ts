// @vitest-environment jsdom
// Generic command-attachment envelopes over the built Web composition and the
// keyless FixtureApiClient transport. Opaque files stay inert in the draft rail;
// commands consume the complete mixed-capable envelope or refuse it intact.
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

/** Paste one file into the composer through the browser clipboard contract. */
function pasteFile(textarea: HTMLTextAreaElement, file: File): void {
  fireEvent.paste(textarea, {
    clipboardData: {
      items: [{ kind: 'file', type: file.type, getAsFile: () => file }],
      getData: () => '',
    },
  })
}

/** Paste one opaque file and wait for its inert card. */
async function pasteOpaqueFile(textarea: HTMLTextAreaElement, name: string): Promise<HTMLElement> {
  pasteFile(textarea, new File(['fixture notes'], name, { type: 'text/plain' }))
  const group = await screen.findByRole('group', { name: 'Pending files' })
  await within(group).findByText(name)
  expect(group.querySelector('img')).toBeNull()
  return group
}

/** Paste one tiny PNG and wait for its specialized image thumbnail. */
async function pasteImage(textarea: HTMLTextAreaElement, name: string): Promise<void> {
  pasteFile(textarea, new File([new Uint8Array([137, 80, 78, 71])], name, { type: 'image/png' }))
  await waitFor(() => {
    const rail = document.querySelector('[role="group"][aria-label="Pending images"]')
    if (rail === null) throw new Error('image attachment rail missing')
    expect([...rail.querySelectorAll('img')].map(img => img.getAttribute('alt'))).toContain(name)
  }, { timeout: 5_000 })
}

it('keeps an opaque file and draft when a non-declaring command refuses the envelope', async () => {
  mountAssembledApp()
  const textarea = await freshComposer()
  const group = await pasteOpaqueFile(textarea, 'notes.txt')

  fireEvent.change(textarea, { target: { value: '/echo hello' } })
  fireEvent.keyDown(textarea, { key: 'Enter' })

  const notice = await screen.findByRole('alert')
  expect(notice.textContent).toBe('/echo does not accept attachments; remove them first')
  expect(textarea.value).toBe('/echo hello')
  expect(within(group).getByText('notes.txt')).not.toBeNull()
  expect(group.querySelector('img')).toBeNull()
})

it('consumes an opaque file through a declaring command and clears the composer', async () => {
  mountAssembledApp()
  const textarea = await freshComposer()
  await pasteOpaqueFile(textarea, 'goal-notes.txt')

  fireEvent.change(textarea, { target: { value: '/goal rebuild the cathedral' } })
  fireEvent.keyDown(textarea, { key: 'Enter' })

  await waitFor(() => {
    expect(textarea.value).toBe('')
    expect(screen.queryByRole('group', { name: 'Pending files' })).toBeNull()
  }, { timeout: 5_000 })
})

it('keeps the specialized raster path for an image-only plan request', async () => {
  mountAssembledApp()
  const textarea = await freshComposer()
  await pasteImage(textarea, 'plan-task.png')

  fireEvent.change(textarea, { target: { value: '/plan' } })
  fireEvent.keyDown(textarea, { key: 'Enter' })

  await waitFor(() => {
    expect(textarea.value).toBe('')
    expect(document.querySelector('[role="group"][aria-label="Pending images"]')).toBeNull()
  }, { timeout: 5_000 })
  expect([...document.querySelectorAll('[role="alert"]')]
    .some(candidate => candidate.textContent?.includes('/plan') ?? false)).toBe(false)
})
