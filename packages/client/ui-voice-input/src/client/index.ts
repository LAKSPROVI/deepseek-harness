/**
 * Voice-input plugin, browser half: a push-to-talk microphone entry in the
 * composer's `conversation.input.left` tool row. The browser records one
 * utterance, this plugin's injected callback carries it to the Host's
 * `voiceInput` Remote namespace as base64 inside ordinary JSON (the RPC layer
 * has no binary path), and the component appends the returned transcript to
 * the session draft through the public input action face.
 *
 * The audio is transient: it exists as bytes for one call, never enters the
 * session log, and never reaches the console. Recording lifecycle and failure
 * copy stay in the component; this entry owns only the Remote hop.
 * @module @deepseek-ai/dsh-client-ui-voice-input/client
 */
// Type-only: pulls the generated Remote API and ctx.remote merge through the Client assembly boundary.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
// Type-only: pulls the ui-conversation SlotMap merge (the input.left entry).
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import { VoiceInputButton } from './VoiceInputButton.tsx'
import type { VoiceInputInjected } from './slots.ts'
import { en, zh } from './locales.ts'

export type { VoiceInputNotice } from './failures.ts'
export type { VoiceInputInjected, VoiceInputButtonProps } from './slots.ts'
export type { VoiceInputKey } from './locales.ts'
export type { VoiceMediaType } from './audio.ts'

/** Dictionary namespace owned by this plugin. */
const NS = 'voiceInput'

/** Required services: stable Client faces; the voiceInput namespace arrives asynchronously. */
export const inject = ['slots', 'remote', 'locale']

/**
 * Client plugin body: register the `voiceInput` dictionaries and contribute
 * the push-to-talk entry to the composer tool row. `slots.inject` waits for
 * ui-conversation's declaration, because apply order between plugins is
 * unconstrained and a bare register would race it.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-voice-input: dictionaries')

  // api-remotes mounts generated namespaces asynchronously. The desktop shell
  // can finish its activation sweep before voiceInput exists, so making the
  // namespace a static plugin injection turns normal startup ordering into a
  // fatal "failed to load plugins" screen. Install the slot contribution in a
  // child scope when the namespace appears; Cordis also disposes it if the
  // namespace is withdrawn during HMR.
  ctx.inject(['remote.voiceInput'], (scope: ClientContext) => {
    scope.slots.inject('conversation.input.left', () => scope.slots.register({
      name: 'conversation.input.left',
      id: 'voice-input',
      order: 20,
      locale: NS,
      inject: (): VoiceInputInjected => ({
        transcribe: (request, signal) => scope.remote.voiceInput.transcribe(request, signal),
      }),
    }, VoiceInputButton))
  })
}
