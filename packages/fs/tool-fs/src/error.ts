/**
 * Model-facing diagnostics for guarded-mutation failures. Providers and
 * policies retain operation-specific causes, while this package owns the
 * stable message shown to the model.
 * @module @deepseek-ai/dsh-tool-fs/src/error
 */

import { FsError } from '@deepseek-ai/dsh-fs'

/**
 * Render the stable model-facing diagnostic for a guarded-mutation failure.
 * `FS_STALE_VERSION` keeps the provider's reason and appends a re-read remedy —
 * recreation-oriented when the provider reports the target was deleted after the
 * read, a plain re-read otherwise. `FS_NOT_OBSERVED` replaces operation-specific
 * policy/provider text with one path-aware reason and read remedy. The original
 * error remains the cause, and both diagnostics preserve its code for machine
 * routing. Anything else passes through untouched.
 * @param error - the caught value from a write/edit execution.
 * @param displayPath - the resolved target path shown to the model.
 * @returns a remediated `FsError` for the two guarded-mutation codes, else the original value.
 */
export function remediateFsError(error: unknown, displayPath: string): unknown {
  if (!(error instanceof FsError)) return error
  if (error.code === 'FS_NOT_OBSERVED') {
    return new FsError(
      `cannot modify "${displayPath}": file has not been read — read the file, then retry`,
      error.code,
      { cause: error },
    )
  }
  if (error.code === 'FS_STALE_VERSION') {
    // A write onto a target deleted after the read is recoverable by recreation:
    // the re-read records the absence, then the retried write resolves to
    // `createIfAbsent`. Providers phrase that case as "deleted after it was read"
    // (dsh-fs-local, dsh-fs-e2b); a plain version mismatch only needs a re-read.
    const remedy = error.message.includes('deleted after it was read')
      ? ' — re-read the file to record the deletion, then retry to recreate it'
      : ' — re-read the file, then retry'
    return new FsError(`${error.message}${remedy}`, error.code, { cause: error })
  }
  return error
}
