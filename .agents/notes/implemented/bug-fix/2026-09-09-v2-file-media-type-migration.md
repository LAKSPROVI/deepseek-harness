# Agent Note: V2 legacy file media type migration

Status: implemented

English | [中文](2026-09-09-v2-file-media-type-migration.zh.md)

## Problem

Some released V2 Sessions record a `file` content block whose attachment includes `mediaType`. The V2-to-V3 source audit was introduced after those Sessions existed and accepted only `attachmentId`, `name`, and `bytes`. It therefore rejected intact historical conversations during restore, even though the field describes the file and does not carry a Session reference.

## Decision

The V2-to-V3 source audit admits an optional `attachment.mediaType` only when it is a string. Migration preserves the field verbatim in every audited content owner, including spliced agent inbox messages. It does not infer a media type, alter attachment metadata, or rewrite the compressed source artifact.

## Alternatives considered

**Drop `mediaType` during migration.** Rejected because migration must preserve historical request meaning and attachment metadata; removing the field would change a valid conversation to bypass an admission rule.

**Accept any `mediaType` value.** Rejected because the optional legacy member remains owned metadata. Requiring a string permits the released representation while continuing to reject malformed durable data.

**Keep refusing the field.** Rejected because it turns a non-coordinate legacy annotation into a permanent restore failure for otherwise intact sessions.

## Consequences

Historical V2 conversations with a string file media type reopen as V3 without source mutation. Focused migration coverage proves preservation through `agent/inbox/spliced` and retains rejection of non-string values. Other unknown attachment members, unknown content kinds, and native V3 extension rules remain unchanged.
