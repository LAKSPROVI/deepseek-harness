/** Compact composer control that opens the shared prompt-library overlay. */

import { IconListPenOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PromptLibraryLauncherProps } from './slots.ts'
import css from './PromptLibraryLauncher.module.css'

/**
 * Render the composer launcher. It changes only overlay state.
 * @param props - derived session runtime, locale, and shared-store faces.
 * @returns the compact prompt-library button.
 */
export function PromptLibraryLauncher({ usePromptLibrary, setOverlayOpen, t }: PromptLibraryLauncherProps) {
  const open = usePromptLibrary(state => state.overlayOpen)
  const available = usePromptLibrary(state => state.status === 'ready')
  return (
    <button
      type="button"
      className={css.button}
      aria-label={t('launcher.label')}
      aria-haspopup="dialog"
      aria-expanded={open}
      disabled={!available}
      onClick={() => { setOverlayOpen(!open) }}
    >
      <IconListPenOutline16 />
    </button>
  )
}
