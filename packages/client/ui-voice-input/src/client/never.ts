/**
 * Exhaustiveness helper for this package's closed unions (the recording phase
 * and the Host failure taxonomy).
 * @module @deepseek-ai/dsh-client-ui-voice-input/client/never
 */

/**
 * Refuse a value a closed union says cannot exist.
 * @param _value - the impossible value.
 * @returns never; always throws.
 */
/* v8 ignore next 3 -- closed-union default only defends future source widening */
export function assertNever(_value: never): never {
  throw new Error('unexpected voice-input variant')
}
