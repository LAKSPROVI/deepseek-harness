/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-transcription-groq`.
 * @module @deepseek-ai/dsh-transcription-groq/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-transcription-groq'

/** Cordis companion plugin name. */
export const name = 'transcription-groq-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the provider holds no state between calls — it projects
 * its settings section per transcription and retains no credential — so it
 * publishes no event or mutable data relation to check.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
