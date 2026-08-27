/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-client-ui-voice-input`.
 * @module @deepseek-ai/dsh-client-ui-voice-input/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-client-ui-voice-input'

/** Cordis companion plugin name. */
export const name = 'client-ui-voice-input-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the recording lifecycle this package owns lives
 * entirely in one browser component's local state and in MediaStream tracks it
 * releases on every exit path — neither is an authoritative event stream nor
 * cross-plugin mutable data a host-side companion can observe. The audio bytes
 * never become durable data, so no data relation survives a call for an
 * installer to check; the one relationship worth asserting (a stopped
 * recording leaves no live track) is observable only from the browser, where
 * component specs can drive the recorder.
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
