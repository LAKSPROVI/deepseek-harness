import type { KeyboardEvent, RefObject } from 'react'

/**
 * Escape closes an open header popover and hands focus back to its trigger,
 * so keyboard users land where they opened it. Shared by every popover in
 * this header so the key handling cannot drift between them.
 * @param open - whether the popover is currently open.
 * @param close - closes the popover.
 * @param triggerRef - the button that opened it.
 * @returns the `onKeyDown` handler for the popover root.
 */
export function useEscapeToClose(
  open: boolean,
  close: () => void,
  triggerRef: RefObject<HTMLButtonElement | null>,
): (event: KeyboardEvent<HTMLDivElement>) => void {
  return (event) => {
    if (event.key === 'Escape' && open) {
      event.preventDefault()
      close()
      triggerRef.current?.focus()
    }
  }
}
