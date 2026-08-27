/**
 * Push-to-talk composer control. Recording, upload, and failure state are
 * local: nothing here is shared across entries or survives a remount, and the
 * audio never becomes durable data. Every exit path — success, refusal,
 * cancellation, unmount — stops the MediaStream tracks, because a leaked track
 * leaves the browser's recording indicator lit and users read that as the app
 * listening after they stopped.
 * @module @deepseek-ai/dsh-client-ui-voice-input/client/VoiceInputButton
 */

import { useEffect, useRef, useState } from 'react'
import type { MouseEvent } from 'react'
import { bytesToBase64, resolveMediaType, type VoiceMediaType } from './audio.ts'
import { CARRIER_NOTICE, describeFailure, type VoiceInputNotice } from './failures.ts'
import { assertNever } from './never.ts'
import type { VoiceInputButtonProps } from './slots.ts'
import css from './VoiceInputButton.module.css'

/** What the control is doing right now. */
type Phase = 'idle' | 'recording' | 'uploading'

/** Stop every track so the browser releases the microphone and clears its indicator.
 * @param stream - the granted capture stream.
 */
function releaseStream(stream: MediaStream): void {
  for (const track of stream.getTracks()) track.stop()
}

/**
 * Whether this browser can record at all. `mediaDevices` is absent on
 * insecure origins, and `MediaRecorder` is absent on browsers that never
 * shipped it.
 * @returns the capture entry point, or undefined when recording is impossible.
 */
function recordingSupport(): MediaDevices | undefined {
  // Both names are typed as always present, yet `mediaDevices` is absent on an
  // insecure origin and `MediaRecorder` on a browser that never shipped it. The
  // recorder is read off globalThis because a `typeof` guard on its declared
  // face is a condition the types call impossible.
  const { MediaRecorder: recorder } = globalThis as { MediaRecorder?: unknown }
  const devices: MediaDevices | undefined = navigator.mediaDevices
  if (devices === undefined || recorder === undefined) return undefined
  return devices
}

/**
 * Push-to-talk microphone control for the composer tool row.
 *
 * Pointer gestures are hold-to-record: press starts, release or leaving the
 * button sends. Keyboard activation toggles instead — a keyboard cannot
 * express "still holding", so Enter or Space starts the recording and the next
 * press sends it. Both gestures land on the same start/stop pair.
 * @param props - runtime share (draft read/write), the injected transcribe callback, and the locale seat.
 * @returns the microphone control, its cancel affordance while uploading, and a live status line.
 */
export function VoiceInputButton({ useInput, inputActions, transcribe, t }: VoiceInputButtonProps) {
  const [phase, setPhase] = useState<Phase>('idle')
  const [notice, setNotice] = useState<VoiceInputNotice | null>(null)
  const draft = useInput(state => state.draft)

  const recorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const startingRef = useRef(false)
  const aliveRef = useRef(true)
  // The transcript appends to whatever the draft holds when the Host answers,
  // which is later than the render this handler was created in.
  const draftRef = useRef(draft)

  useEffect(() => {
    draftRef.current = draft
  }, [draft])

  useEffect(() => {
    aliveRef.current = true
    return () => {
      aliveRef.current = false
      const recorder = recorderRef.current
      recorderRef.current = null
      if (recorder !== null && recorder.state !== 'inactive') recorder.stop()
      const stream = streamRef.current
      streamRef.current = null
      if (stream !== null) releaseStream(stream)
      abortRef.current?.abort()
      abortRef.current = null
    }
  }, [])

  /** Append the transcript to the live draft, separated by one space when the draft is non-empty. */
  const appendTranscript = (text: string): void => {
    const current = draftRef.current
    inputActions.setDraft(current === '' ? text : `${current} ${text}`)
  }

  /** Upload the recorded bytes and settle the control on the answer. */
  const upload = async (bytes: Uint8Array, mediaType: VoiceMediaType): Promise<void> => {
    const controller = new AbortController()
    abortRef.current = controller
    setPhase('uploading')
    let carried: Awaited<ReturnType<typeof transcribe>>
    try {
      carried = await transcribe({ mediaType, data: bytesToBase64(bytes) }, controller.signal)
    } catch {
      // Only an assembly fault reaches here — arity, an unmounted method, a
      // missing Context binder; the Remote face settles a carrier failure into
      // its envelope instead of rejecting. Caught so an abort mid-flight cannot
      // surface as an unhandled rejection.
      if (!aliveRef.current || abortRef.current !== controller) return
      abortRef.current = null
      setPhase('idle')
      setNotice(CARRIER_NOTICE)
      return
    }
    // A late answer to a cancelled upload is ignored: the cancel gesture owns
    // the visible state from the moment the user asked for it.
    if (!aliveRef.current || abortRef.current !== controller) return
    abortRef.current = null
    setPhase('idle')
    // Outer envelope: the carrier. Its code is an open string, so it is never
    // switched on and never shown.
    if (!carried.ok) {
      setNotice(CARRIER_NOTICE)
      return
    }
    // Inner envelope: the Host's closed business union.
    const result = carried.value
    if (!result.ok) {
      setNotice(describeFailure(result.error))
      return
    }
    const text = result.value.text.trim()
    if (text === '') {
      setNotice({ key: 'status.silent', severity: 'info' })
      return
    }
    appendTranscript(text)
    setNotice({ key: 'status.inserted', severity: 'info' })
  }

  /** Package one finished recording: release the microphone, then decide whether it can be uploaded. */
  const complete = (recorder: MediaRecorder, chunks: readonly Blob[]): void => {
    recorderRef.current = null
    const stream = streamRef.current
    streamRef.current = null
    if (stream !== null) releaseStream(stream)
    if (!aliveRef.current) return

    const declared = recorder.mimeType === '' ? chunks[0]?.type ?? '' : recorder.mimeType
    const mediaType = resolveMediaType(declared)
    if (mediaType === undefined) {
      setPhase('idle')
      // Refuse locally rather than upload a container the Host would reject.
      setNotice({ key: 'error.format', severity: 'error', params: { mediaType: declared } })
      return
    }
    const blob = new Blob([...chunks], { type: mediaType })
    void blob.arrayBuffer().then(async (buffer) => {
      const bytes = new Uint8Array(buffer)
      if (bytes.byteLength === 0) {
        if (!aliveRef.current) return
        setPhase('idle')
        setNotice({ key: 'error.recorder', severity: 'error' })
        return
      }
      await upload(bytes, mediaType)
    }, () => {
      if (!aliveRef.current) return
      setPhase('idle')
      setNotice({ key: 'error.recorder', severity: 'error' })
    })
  }

  /** Attach a recorder to the granted stream and start capturing. */
  const startRecorder = (stream: MediaStream): void => {
    const recorder = new MediaRecorder(stream)
    const chunks: Blob[] = []
    recorder.addEventListener('dataavailable', (event: BlobEvent) => {
      if (event.data.size > 0) chunks.push(event.data)
    })
    // MediaRecorder fires 'stop' after an internal error too, so the
    // empty-audio arm in complete() also covers a capture that failed midway.
    recorder.addEventListener('stop', () => { complete(recorder, chunks) })
    recorderRef.current = recorder
    streamRef.current = stream
    recorder.start()
    setPhase('recording')
    setNotice(null)
  }

  /** Ask for the microphone and begin recording. */
  const begin = (): void => {
    if (startingRef.current || recorderRef.current !== null || abortRef.current !== null) return
    const devices = recordingSupport()
    if (devices === undefined) {
      setNotice({ key: 'error.unsupported', severity: 'error' })
      return
    }
    startingRef.current = true
    void devices.getUserMedia({ audio: true }).then((stream) => {
      startingRef.current = false
      // Unmounted while the permission prompt was open: the grant still opened
      // a live track, so release it instead of recording into a dead component.
      if (!aliveRef.current) {
        releaseStream(stream)
        return
      }
      startRecorder(stream)
    }, (reason: unknown) => {
      startingRef.current = false
      if (!aliveRef.current) return
      const denied = reason instanceof DOMException
        && (reason.name === 'NotAllowedError' || reason.name === 'SecurityError')
      setNotice({ key: denied ? 'error.permission' : 'error.recorder', severity: 'error' })
    })
  }

  /** Stop capturing; the recorder's stop event carries the audio onward. */
  const finish = (): void => {
    const recorder = recorderRef.current
    if (recorder === null || recorder.state === 'inactive') return
    recorder.stop()
  }

  /** Abandon the in-flight upload; its answer, if one arrives, is ignored. */
  const cancelUpload = (): void => {
    const controller = abortRef.current
    if (controller === null) return
    abortRef.current = null
    controller.abort()
    setPhase('idle')
    setNotice({ key: 'status.cancelled', severity: 'info' })
  }

  /**
   * Keyboard activation only. Enter and Space reach a button as a synthetic
   * click carrying `detail === 0`, while a pointer-driven click carries a
   * click count — so this toggles for keyboard users without double-handling
   * the click that follows every pointer release.
   * @param event - the click, pointer-driven or synthesized by a key.
   */
  const onClick = (event: MouseEvent<HTMLButtonElement>): void => {
    if (event.detail !== 0) return
    if (recorderRef.current !== null) finish()
    else begin()
  }

  const label = buttonLabel(phase, t)
  const status = statusLine(phase, notice, t)
  return (
    <span className={css.wrap}>
      <button
        type="button"
        className={phase === 'recording' ? `${css.mic} ${css.recording}` : css.mic}
        aria-label={label}
        title={label}
        aria-pressed={phase === 'recording'}
        aria-busy={phase === 'uploading'}
        onClick={onClick}
        onPointerDown={begin}
        onPointerUp={finish}
        onPointerLeave={finish}
        onPointerCancel={finish}
      >
        <svg viewBox="0 0 16 16" width={14} height={14} aria-hidden focusable="false">
          <path d="M8 1.5a2 2 0 0 1 2 2v4a2 2 0 0 1-4 0v-4a2 2 0 0 1 2-2Z" fill="currentColor" />
          <path
            d="M4 7a4 4 0 0 0 8 0M8 11v3.5"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.4}
            strokeLinecap="round"
          />
        </svg>
      </button>
      {phase === 'uploading' && (
        <button type="button" className={css.cancel} onClick={cancelUpload}>
          {t('action.cancel')}
        </button>
      )}
      {/* One live region owns every announcement; the visible line below repeats
          a failure for sighted users and stays out of the accessibility tree. */}
      <span className={css.srOnly} role="status" aria-live="polite">{status}</span>
      {notice?.severity === 'error' && (
        <span className={css.error} aria-hidden title={status}>{status}</span>
      )}
    </span>
  )
}

/**
 * The control's accessible name for the current phase.
 * @param phase - what the control is doing.
 * @param t - the namespace-bound translator.
 * @returns the button label.
 */
function buttonLabel(phase: Phase, t: VoiceInputButtonProps['t']): string {
  switch (phase) {
    case 'idle':
      return t('button.idle')
    case 'recording':
      return t('button.recording')
    case 'uploading':
      return t('button.uploading')
    /* v8 ignore next 2 -- Phase is component-local state no caller can set, so the default only defends future source widening */
    default:
      return assertNever(phase)
  }
}

/**
 * The line the live region announces: phase progress while the control is
 * busy, otherwise the standing notice (a failure, a silent take, a completed
 * insertion, or a cancellation).
 * @param phase - what the control is doing.
 * @param notice - the most recent notice, when one stands.
 * @param t - the namespace-bound translator.
 * @returns the announcement text, empty when there is nothing to say.
 */
function statusLine(phase: Phase, notice: VoiceInputNotice | null, t: VoiceInputButtonProps['t']): string {
  switch (phase) {
    case 'recording':
      return t('status.recording')
    case 'uploading':
      return t('status.uploading')
    case 'idle':
      return notice === null ? '' : t(notice.key, notice.params)
    /* v8 ignore next 2 -- Phase is component-local state no caller can set, so the default only defends future source widening */
    default:
      return assertNever(phase)
  }
}
