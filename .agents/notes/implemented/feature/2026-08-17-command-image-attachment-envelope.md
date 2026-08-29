# Agent Note: Command image-attachment envelope

Status: implemented

English | [中文](2026-08-17-command-image-attachment-envelope.zh.md)

## Problem

The Web composer submits one envelope — draft text, attached images, and delivery mode — but the two submission planes consumed it asymmetrically. A plain message rode `defaultSink → conversation.sendSession`, which serialized the images into prompt content and cleared them on success. A claimed slash command rode `claim.submit(args, actx)`, a text-only transaction: `/goal rebuild the cathedral` with four reference photos executed the command, cleared the draft, and silently stranded the images in the composer rail. The model never saw them, and no surface said so. The defect was contract-level, not a missed call site: nothing in the claim, the adjudication, or the host executor modeled attachments, so any command could consume the text half of a submission and drop the rest.

Merging the two planes was not on the table — the [plugin command registration Agent Note](2026-07-19-plugin-command-registration.md) deliberately keeps human commands out of the model plane, and that separation is correct. The gap was that the envelope fractured at the plane fork.

## Decision

The submission envelope is modeled end to end, and every command route either consumes it whole or refuses it loudly.

**Declaration.** `CommandDefinition.input.attachments: boolean` (absent = false) declares whether composer attachments may accompany an invocation. The flag rides the frozen `CommandDescriptor` through `commands/list` to every client, onto the minted `CommandClaim` (`attachments: true`), and into the input machine's published claim snapshot.

**Generic identity and tagged payload.** Browser drafts and durable references use `DraftAttachmentId` and `AttachmentId`; the command RPC carries encoded bytes rather than identifiers. Its public `EncodedCommandAttachment` type from `@deepseek-ai/dsh-commands/types` is a `type`-discriminated union of one encoded image or one encoded opaque file. This widening is owned by the [opaque generic file decision](2026-08-29-opaque-generic-file-attachments.md); the image-specific producer behavior in this note remains authoritative.

**Executor enforcement.** `CommandRuntime.execute(agent, line, encodedAttachments, signal)` carries the submission's base64 attachments. The executor — not the composer — enforces the declaration: attachments to a non-declaring command, an absent attachment store, and a refused image or file group each settle as a logged `command/done` error before the handler runs. Admission partitions the submitted vector by tag, delegates complete batches to `admitEncodedImages` and `admitEncodedFiles`, and restores exact mixed order before the handler receives frozen ordered `ImageBlock` and `FileBlock` values on `invocation.attachments`. Both prompt RPC and command execution therefore share the same Host-authoritative admission, and a rejected batch publishes no durable object.

**Producer-owned model visibility.** The registry never schedules attachments itself. `/goal` submits one `agent.followup` user message containing the admitted blocks plus fixed explanatory text after a successful create or edit, so later goal rounds read them from ordinary session history and the goal domain stores no attachment state. `/plan <message>` folds attachments into its steered text message, while bare `/plan` may steer an attachment-only user message because the attachment can contain the whole task. Producer control forms with no model input (`/goal pause`, `/plan off`) return a direct error and keep the composer's attachments in place. The plan projection treats `command/run` as a candidate and drops it on a paired `command/done` error, so a rejected attachment-carrying `/plan off` cannot leave a pending exit.

**Composer refusal is a visible banner, everything retained.** ui-commands receives the attachment count from adjudication and refuses every enter route that cannot consume the envelope: contribution popups, decorated popups, non-declaring claims, and bare detached executes. The input machine publishes one error notice, which the composer renders through its transient Toast banner with draft and attachments untouched. A pre-claimed submit is gated in the facade with the same copy from the `conversation` namespace. On the accepting path the facade serializes ordered draft attachments through `commandAttachments`, passes them to `claim.submit`, and clears plus releases them only on a success outcome; an error result, including a producer grammar rejection, keeps them.

## Testing

Registry executor enforcement, admission failure settlement, and frozen invocation attachments are covered in `packages/interaction/commands/tests/commands.spec.ts`; batch admission ordering and limits in `packages/attachment/attachment/tests/admission.spec.ts`; producer behavior in `packages/goal/command-goal/tests/command-goal.spec.ts` and `packages/plan/plan-mode/tests/plan-mode.spec.ts`; client refusal and consumption paths in the ui-commands, ui-conversation, and ui-input-trigger client suites; and the assembled-application flow in the apps/web keyless lanes.

## Alternatives considered

- **Block commands whenever images are attached (no acceptance path)** — rejected: predictable, but `/goal` with reference images is the motivating use case; the user's images would have no route to the model at all.
- **Auto-send stranded images as a follow-up user message after any command** — rejected: surprising for host-state commands (`/model`, `/compact`), and it moves the message contract from the producer to the composer, against the command registry's "producer owns model-visible work" rule.
- **Store attachment references in the goal domain and render them into round prompts** — rejected: requires durable goal schema changes and either duplicates image blocks into every round prompt or adds round-one-only prompt shape; the round-prompt invariant would need attachment state. One ordinary logged user message achieves the same model visibility.
- **Consume attachments on any command success regardless of grammar** — rejected: `/goal pause` with attachments would silently discard them, recreating the original defect one layer deeper. Consumption is tied to the producer's explicit success, and grammar misfits return errors.
- **Keep enforcement client-side only** — rejected: schema omission is not enforcement; direct RPC callers could bypass the composer. The executor settles the declaration itself.
- **Use an untagged multimedia identifier** — rejected: the two identifiers are already attachment-generic, while the wire transports bytes and each modality has distinct admission and model-visible semantics. The shipped `EncodedCommandAttachment` union carries an explicit `type`, so the executor can admit or refuse each group without guessing from MIME.

## Consequences

- No command route can consume a submission's text and strand its attachments: the contract forces whole-envelope consumption or a visible refusal, for current and future commands alike.
- The commands package depends on `dsh-attachment` and `dsh-llm`, and `commands/execute` carries a required `encodedAttachments` wire parameter — every caller states its envelope explicitly.
- `/goal` and `/plan` accept reference attachments at the cost of one extra logged user message (goal) and attachment blocks in the steered message (plan), including an attachment-only message for bare `/plan`; native-capable routes receive supported contents and other routes receive deterministic modality fallbacks.
- Menu-pick popup flows do not consult the envelope: picking a popup command while attachments are present leaves them visibly in the composer rather than refusing the interaction. Enter-submission is the enforced envelope boundary.
- "A rejected batch publishes no durable object" covers exactly the pre-admission settlements (declaration, missing store, batch limit). A handler-level grammar rejection (`/goal pause` with attachments) and a post-admission cancellation settle after the batch committed, leaving content-addressed objects without a referencing session event — harmless under sha256 dedup and the attachment store's deferred reference-aware GC, but not "no object was written".
