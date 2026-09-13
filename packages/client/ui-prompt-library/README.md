# @deepseek-ai/dsh-client-ui-prompt-library

English | [中文](README.zh.md)

Durable prompt library for the Web client. The Host registers the `prompt-library` settings namespace with one ordered `prompts` array; the browser binds that namespace through `ctx.settingsScope`, provides full CRUD in `settings.section`, a compact launcher in `conversation.input.left`, and a searchable picker in `conversation.input.overlay`.

Each prompt is `{ id, title, body }`. The Host accepts at most 100 prompts, 120 title characters, 12,000 body characters, and 200,000 combined title/body characters across the complete list. IDs must be unique. The Client repeats these bounds only for immediate form feedback; the Host registration remains authoritative.

All three browser entries share one apply-owned observable store. The settings scope is its only persistence source: the package does not use `localStorage`. Remote or memory settings appear as an explicit unavailable state and disable CRUD. Selecting a prompt writes through `inputActions.setDraft`: an empty draft becomes the body; a non-empty draft becomes the existing text, two newlines, then the body. Selection never invokes `submit`. A body whose `trimStart()` begins with `/` carries a warning in settings and in the picker.

## Model Experience

None, as this package changes only browser draft composition. A saved prompt becomes model-visible only if the user separately submits the resulting draft through the conversation input.

#### KV Cache effect

No direct effect. Inserting text changes only the unsent browser draft; any later submitted request and its cache behavior belong to the conversation and model provider.

## Known Limitations and Deferred Work

- Prompt ordering follows array order, but this package provides create/edit/delete only; drag-and-drop reordering is not exposed.
- Search is a case-insensitive title/body substring match within the bounded in-memory list; there is no fuzzy ranking or tagging.
