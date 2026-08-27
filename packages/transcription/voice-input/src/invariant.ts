/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-voice-input`.
 * @module @deepseek-ai/dsh-voice-input/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-voice-input'

/** Cordis companion plugin name. */
export const name = 'voice-input-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the Remote surface holds no state across calls and
 * publishes no event — it decodes one upload, delegates to `ctx.transcription`,
 * and retains nothing after answering — so there is no event or mutable data
 * relation to check.
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
