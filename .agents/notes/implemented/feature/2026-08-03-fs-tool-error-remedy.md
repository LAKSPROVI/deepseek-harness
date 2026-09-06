# Agent Note: Stale-version errors append the recovery instruction at the model boundary

Status: implemented

English | [中文](2026-08-03-fs-tool-error-remedy.zh.md)

## Problem

Guarded `write` and `edit` failures reach the model with messages that state the condition but not the only correct recovery: `FS_STALE_VERSION` ("file changed since it was read") and `FS_NOT_OBSERVED` ("edit requires reading … first"). The model must guess that the recovery is a re-read (or a first read) followed by a retry, and the retry/permission/UI layers that route on the structured code see the same message text. The provider-owned messages are part of the storage seam's machine-oriented vocabulary ([filesystem capability seam](../architecture/2026-06-17-filesystem-capability-seam.md)), so the remedy cannot live there without leaking model-facing wording into every consumer of `FsError`.

## Decision

`dsh-tool-fs` owns a model-facing error wrapper, `remediateFsError` in `src/error.ts`, applied in `write.ts` and `edit.ts` after the sandbox denial mapping. It appends the recovery instruction to stale-version failures and passes unrelated errors through untouched. The [normalized unread-mutation diagnostic](../bug-fix/2026-09-03-normalized-unread-fs-tool-diagnostic.md) supersedes this note's original `FS_NOT_OBSERVED` text treatment.

- `FS_STALE_VERSION` (including a missing edit target, which shares the stale code) gains `— re-read the file, then retry`.
- A guarded `write` whose target was deleted after the read is a recoverable case — the re-read records the absence and the retry then resolves to `createIfAbsent` — so the wrapper gives it a recreation-oriented remedy, `— re-read the file to record the deletion, then retry to recreate it`. The wrapper selects it by the provider's stable deletion phrasing `cannot write "<path>": the file was deleted after it was read`, emitted by `dsh-fs-local` and `dsh-fs-e2b` on the `replaceIfVersion` no-target branch (the version-mismatch branch keeps `file changed since it was read`). That phrasing is a machine-oriented condition string, not the model-facing remedy; the remedy is still appended only at the wrapper.

The structured `FsError` code is preserved so retry/permission/UI layers keep routing on it, and the original error chains as `cause`. Provider messages stay machine-oriented and unchanged except for the sharper deletion-condition string above.

In `edit.ts` the `fs/edit-intent` waterfall sits inside the same `try` as the provider mutation, so the policy plugin's `FS_NOT_OBSERVED` refusal and the provider refusal both pass through the model-facing wrapper.

## Alternatives considered

- **Append the remedy to the provider messages in `dsh-fs` / `dsh-fs-local`.** Rejected because those messages are machine-oriented seam vocabulary consumed by retry, permission, UI, and model-facing layers; model-facing wording belongs at the model boundary, where `dsh-tool-fs` already owns result formatting ([filesystem capability seam](../architecture/2026-06-17-filesystem-capability-seam.md)). The provider still owns the *condition* wording — the deletion-remedy branch keys on a provider phrase — but the recovery instruction itself is never in the provider.
- **Give the deleted-target case its own `FsError` code so the wrapper branches on the code, not a phrase.** Rejected for the same reason a new code was rejected for the stale/unread split below: retry and UI layers already treat every `FS_STALE_VERSION` the same way (re-read, retry), and the deletion case resolves through that same path; a new code forks routing on a distinction only the wording cares about. Matching the provider's condition string keeps the fork inside the wrapper that owns the wording.
- **Add the recovery to prompt guidance instead.** Rejected because the failure arrives mid-task; a static instruction does not reliably reach the retry decision, while the error message is present exactly when the model must act.
- **Signal the remedy with a new `FsError` code.** Rejected because the two failures are the same conditions retry layers already handle; splitting the code would fork routing on identical semantics.

## Consequences

The `FS_STALE_VERSION` model-visible text includes its appended remedy — the recreation-oriented variant when the provider reports the write target was deleted after the read, the plain re-read otherwise. Unit tests cover both texts, code preservation, cause chaining, and passthrough of unrelated values; assembled tool paths assert that each remedy reaches the model, and that following the recreation remedy (re-read, then retry) recreates the deleted file.

The [filesystem absence-observation follow-up](../bug-fix/2026-08-09-filesystem-absence-observation.md) makes the stale remedy actionable for external deletion. The failed reread still returns `FS_NOT_FOUND`, but records confirmed absence: edit then returns `FS_NOT_FOUND` without another stale remedy, while write retries as an atomic `createIfAbsent` and preserves any concurrent creator. The recreation-oriented wording added here spells that path out at the moment the model must act, so a session that deleted the file out of band (its own shell `rm`, so no `fs/observed` absence was recorded) is told the re-read is what unblocks the retry rather than left to infer it.
