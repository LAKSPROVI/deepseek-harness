# Agent Note: Atomic-write crash durability

Status: implemented

English | [中文](2026-10-01-atomic-write-crash-durability.zh.md)

## Problem

`writeFileAtomic` replaced files atomically but not durably: the temp sibling was written and renamed with no `fsync`, so power loss in the window after the rename could leave the target unwound or zero-length. The consumers are launch-critical — the credentials store aborts the whole boot when its file is invalid, so a torn `.credentials.yaml` turns a power cut into a dead application until an operator intervenes by hand. The gap was documented three ways (a `settings-atomic-durability` source TODO, a Known Limitations bullet, an inherited limitation line in the credentials store), each leaving durability "the caller's policy" — but no caller could implement it: the write path belongs to this package.

## Decision

`writeFileAtomic` now opens the temp sibling with `wx` plus the caller's mode, writes, fsyncs the file handle, closes it, renames over the target, and fsyncs the parent directory on POSIX — the same publish protocol `dsh-storage-json`'s `writeAtomic` already uses for unit files. On Windows the directory fsync is skipped because the platform rejects `O_RDONLY` directory opens, so rename durability there relies on the NTFS volume journal; the file data itself is fsynced on every platform. The mode-carrying exclusive open already preserved owner-only permissions, so the TODO's second clause needed no extra work. All three doc claims were rewritten in the same change and the TODO is closed.

## Alternatives considered

- **Keep durability the caller's policy** — rejected: no caller can fsync a rename it does not own; the only lever was inside this package, and the boot-dead failure mode is exactly the kind a durability gap produces.
- **Extract a shared helper with `dsh-storage-json`** — rejected for now: the two differ materially (mode-carrying `wx` open, Windows transient-rename retry, lock integration here; fixed `0o600` there), and forcing one shape would couple a zero-dependency util to the storage group for ~10 duplicated lines.
- **`MoveFileExW(..., MOVEFILE_WRITE_THROUGH)` on Windows** — rejected: Node's `rename` does not expose the flag, and adding a native addon for this one guarantee is out of proportion to the journal's practical reliability.

## Consequences

A completed `writeFileAtomic` replacement survives power loss on POSIX; credentials and profile edits no longer risk a zero-length, boot-blocking file in the crash window. Every write now pays one file fsync and, on POSIX, one directory fsync — one device round trip each, measurable on spinning disks but paid only by writes that already justified atomicity. Windows rename durability remains journal-bound, as before. The 2026-10-01 robustness audit's recommendation ("~10 lines, template exists in storage-json") is closed with this note as its owner.
