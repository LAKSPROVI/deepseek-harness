# Agent Note: A durable saved-prompt library in the Web client

Status: implemented

English | [中文](2026-08-29-saved-prompt-library.zh.md)

## Problem

People reuse the same instruction. A review checklist, a house style, a standing set of constraints, the framing that makes a model answer usefully — each one is typed again from memory or pasted from a scratch file the product knows nothing about. The Web client offered no place to keep one, so the text a user refined over months lived outside the harness entirely.

Keeping it is not a browser storage question. A curated prompt has to survive a cleared cache, a second browser, and a reinstall, and the deployment already owns a durable user-preference document the Host writes and the user can open. What was missing was a namespace in it and the three browser surfaces a library needs: somewhere to edit the list, somewhere to reach it while composing, and something that puts a chosen prompt into the message being written.

The last of those is where a saved-prompt feature usually goes wrong. A stored prompt is text the user wrote earlier, not an instruction the product may act on: inserting it must leave the human holding the send gesture, and the library's own bookkeeping — titles, identities, ordering, the fact that a prompt was used at all — must not become something the model reads.

## Decision

`@deepseek-ai/dsh-client-ui-prompt-library` is one package with a Host half and a browser half. The Host half registers the durable `prompt-library` settings namespace; the browser half binds that namespace through `ctx.settingsScope` and installs three slot entries over one apply-owned store.

| Half | Registers | Serves |
|---|---|---|
| Host (`src/index.ts`) | the `prompt-library` namespace on `ctx.settings` | schema, bounds, and the validator the serialized schema cannot express |
| Browser: settings | `settings.section` | full create, edit, and delete over the ordered list |
| Browser: launcher | `conversation.input.left` | a compact composer control that opens the picker |
| Browser: overlay | `conversation.input.overlay` | a searchable picker that inserts one prompt |

A prompt is `{ id, title, body }`, and array order is display order. Registration alone makes the namespace configurable, so the library needs nothing in the api-proxy and no entry in any exposure list ([plugin-owned settings surface](../architecture/2026-08-12-plugin-owned-settings-surface.md)).

### The Host owns the bounds

The Host accepts at most 100 prompts, a 120-character title, a 12,000-character body, and 200,000 combined title and body characters across the complete list; ids must be unique, and no field may be blank. Count and per-field lengths are schema facts. Uniqueness and the aggregate ceiling are not expressible in the serialized schema, so they run in the namespace validator, which rejects the write rather than letting a document grow past what the client can hold in memory and search.

The bounds apply to the complete list, not to the prompt being edited, because that is the value that persists and the value the overlay filters. The browser repeats every bound in `validatePromptList` for immediate form feedback, and the Host registration stays authoritative: the client check exists so a user learns a title is too long while typing it, not to decide whether the write is legal.

### Persistence has exactly one source

The settings scope is the only place a prompt is stored. The package reads and writes no `localStorage`, `sessionStorage`, `IndexedDB`, or cookie, so the durable answer is whatever the deployment's settings provider holds — under the file provider, the `prompts` array in the user's own [`settings.yaml`](../../../../packages/settings/settings-file/README.md).

When the scope reports `memory` mode or a non-writable document, the library does not degrade into a private browser copy. The store projects that snapshot as an explicit unavailable state: the settings section shows a persistence-unavailable line and disables create, edit, and delete, and the launcher is disabled. A remote browser session therefore shows no library rather than a library that silently forgets, which is the failure a local fallback would produce — the user curates a list, and it is gone from every other client and from the next machine.

All three entries read one store created in `apply` and synchronized from the scope, so the picker, the launcher, and the settings page cannot disagree about what is saved or whether saving works.

### Selection writes a draft, never a message

Choosing a prompt calls `inputActions.setDraft` with the complete next draft and nothing else. An empty draft becomes the body; a non-empty draft becomes the existing text, two newlines, then the body. `submit` is never invoked from this package.

Two newlines rather than one, because the composer sends Markdown and a single newline joins a saved prompt to whatever the user had already typed as one paragraph. Appending rather than replacing, because the draft is the user's, and a picker that discards typed text is a data-loss gesture behind a click.

A body whose `trimStart()` begins with `/` carries a warning in both the settings editor and the picker. Such a body reads as a slash command in the composer, and inserting it into a non-empty draft produces a line that looks like a command and is sent as text. The warning states the mismatch; it does not block saving, because a prompt legitimately about slash commands is a prompt a user may want.

### Prompt text is user data, not agent context

Nothing the library stores reaches a model or a session log by itself. Ids, titles, ordering, the count, the search query, and the fact that a prompt was selected are browser-side only and produce no session event. The body becomes model-visible exactly when the human submits the draft it was written into, and at that point the ordinary user-message path carries it as typed text with no marker distinguishing it from anything else the user wrote.

This keeps the feature inside the model-visible-implies-logged rule without a new session event: until the human sends, there is nothing model-visible; after the human sends, the existing event already holds the complete text.

## Alternatives considered

**Store the library in `localStorage`.** No Host registration, no settings namespace, no write path, and it works in memory-settings mode where the shipped feature disables itself. It also loses the library to a cleared cache, keeps it invisible to a second browser and to the machine the user moves to next, and puts durable user-authored content somewhere no backup, no export, and no settings page can see. The settings document is the durable store the product already owns and the user can open.

**Fall back to `localStorage` when the settings document is unavailable.** This keeps the feature working in remote and memory modes. It also makes durability silently conditional: the same UI would sometimes persist across machines and sometimes not, with no way for the user to tell which, and a prompt curated in the fallback would vanish on the next connection change. The unavailable state is stated instead.

**Insert and submit in one gesture.** A saved prompt is often a complete instruction, so sending it directly reads as the obvious shortcut. It also takes the send decision away from the human, discards whatever the user had already typed, and turns a mis-click in a list into a model request. Selection writes the draft and stops; the human sends.

**Replace the draft instead of appending to it.** Simpler, and it matches the "this prompt is the message" reading. It also silently deletes text the user typed, which is the one thing a picker must not do. Appending with a blank line preserves both and reads correctly in Markdown.

**Record prompt metadata in the session — the id, title, or a "from library" marker on the message.** It would give provenance, analytics, and the ability to show which saved prompt produced a turn. It also puts library bookkeeping into a durable log and in front of the model, where a title is unexplained noise in the request, and it requires a session event for a fact no model behavior depends on. Only the text the user sends is recorded, as text.

**Let the browser own the bounds.** The client could enforce the limits alone and skip the namespace validator. The Host document is writable by other means, so the limits would then be advice: a hand-edited `settings.yaml` could hold a list no client can render or search. The validator refuses at the write.

**One combined surface instead of three entries.** A single settings page with no composer entry keeps the slot count down. It also puts the library three clicks from the place it is used; the launcher and overlay exist because insertion belongs next to the draft.

## Testing

Package tests cover Host registration and disposal through a memory provider, duplicate-id and aggregate-limit rejections, count and per-field validation at and past each bound, controlled title/body editing and creation through the rendered settings form, draft composition into empty and occupied drafts with `submit` never called, the slash-prefix predicate, and the unavailable projection into the shared store. A real Loader composition test boots the Host half from a test-only `cordis.yml` and exercises namespace CRUD through `ctx.settings`.

## Consequences

A user keeps a durable, ordered prompt library in the settings document, reaches it from the composer, and inserts a prompt into the message being written without leaving the conversation. Because the store is the settings namespace, the same list appears in every browser that reaches the same Host.

Prompt bodies are stored as plaintext in the settings document. The library applies no encryption and no secret handling, so a prompt containing a credential is on disk in the clear, readable by anything that can read the user's `settings.yaml`. The feature is designed for reusable instructions, not for secrets.

The library is unavailable rather than degraded wherever the settings document is not writable — memory mode and remote settings — and the UI says so instead of accepting edits it cannot keep.

Ordering is array order and the package exposes create, edit, and delete only, so a user reorders by editing the document directly. Search is a case-insensitive substring match over title and body within the bounded in-memory list, with no ranking or tagging; both gaps are recorded in the [package README](../../../../packages/client/ui-prompt-library/README.md).
