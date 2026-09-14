import { describe, expect, it, vi } from 'vitest'
import type { KeyboardEvent } from 'react'
import { useEscapeToClose } from '../src/client/header/popover.ts'

function keyEvent(key: string) {
  const preventDefault = vi.fn()
  return { event: { key, preventDefault } as unknown as KeyboardEvent<HTMLDivElement>, preventDefault }
}

describe('useEscapeToClose', () => {
  it('closes an open popover on Escape and returns focus to the trigger', () => {
    const close = vi.fn()
    const focus = vi.fn()
    const onKeyDown = useEscapeToClose(true, close, { current: { focus } as unknown as HTMLButtonElement })
    const { event, preventDefault } = keyEvent('Escape')
    onKeyDown(event)
    expect(preventDefault).toHaveBeenCalledOnce()
    expect(close).toHaveBeenCalledOnce()
    expect(focus).toHaveBeenCalledOnce()
  })

  it('ignores other keys, a closed popover, and a missing trigger', () => {
    const close = vi.fn()
    useEscapeToClose(true, close, { current: null })(keyEvent('Enter').event)
    useEscapeToClose(false, close, { current: null })(keyEvent('Escape').event)
    expect(close).not.toHaveBeenCalled()
    // No trigger to focus: closing still works.
    useEscapeToClose(true, close, { current: null })(keyEvent('Escape').event)
    expect(close).toHaveBeenCalledOnce()
  })
})
