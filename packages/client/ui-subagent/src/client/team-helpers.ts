/** Pure Agent Teams form helpers shared by presentation and tests. */

/**
 * Convert a natural teammate label to the durable lower-kebab identity.
 * @param value - operator-entered name.
 * @returns a lower-kebab id capped at 64 characters.
 */
export function normalizeTeamMemberName(value: string): string {
  return value.normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-+/g, '-')
    .slice(0, 64)
    .replace(/-+$/g, '')
}

/** Format bytes for compact attachment cards. */
export function formatAttachmentBytes(bytes: number): string {
  if (bytes < 1_024) return `${bytes} B`
  if (bytes < 1_048_576) return `${(bytes / 1_024).toFixed(1)} KB`
  return `${(bytes / 1_048_576).toFixed(1)} MB`
}
