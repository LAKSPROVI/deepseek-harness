// @vitest-environment jsdom
/**
 * Push-to-talk control behavior over faked browser recording APIs: pointer
 * hold-to-record against keyboard toggle, the refusals it decides locally
 * (unsupported browser, denied microphone, unaccepted container, unreadable or
 * silent take), the double envelope the injected transcribe callback answers
 * with, cancellation, and the microphone release every exit path owes the user.
 */
import { useSyncExternalStore } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import type { RenderResult } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type {
  VoiceInputFailure, VoiceInputTranscribeRequest, VoiceInputTranscribeResult,
} from '@deepseek-ai/dsh-voice-input/types'
import { VoiceInputButton } from '../src/client/VoiceInputButton.tsx'
import { zh } from '../src/client/locales.ts'

const t = makeTranslate(zh, commonZh)

/** The carrier envelope wrapping the business result, as the Remote face answers. */
type Answer = RemoteResult<VoiceInputTranscribeResult>

/** One captured microphone track; `stopped` is what a released stream proves. */
class FakeTrack {
  stopped = false

  stop(): void {
    this.stopped = true
  }
}

/** The granted capture stream: the control must stop every one of its tracks. */
class FakeStream {
  readonly tracks = [new FakeTrack(), new FakeTrack()]

  getTracks(): FakeTrack[] {
    return this.tracks
  }

  /** Whether the microphone is fully released. */
  get allStopped(): boolean {
    return this.tracks.every(track => track.stopped)
  }
}

/** Listener face the control attaches to; the fake calls these directly. */
type RecorderListener = (event: { data: Blob }) => void

/**
 * MediaRecorder stand-in a test drives: it emits `dataavailable` chunks on
 * demand, reports the container it chose (including none at all), and — like the
 * real recorder — goes inactive the moment `stop()` is called while the
 * `stop` event lands a tick later.
 */
class FakeRecorder {
  static instances: FakeRecorder[] = []
  static mimeType = 'audio/webm;codecs=opus'

  readonly mimeType = FakeRecorder.mimeType
  state: 'inactive' | 'recording' = 'inactive'
  private readonly listeners = new Map<string, Set<RecorderListener>>()

  constructor(readonly stream: unknown) {
    FakeRecorder.instances.push(this)
  }

  addEventListener(type: string, listener: RecorderListener): void {
    const bucket = this.listeners.get(type) ?? new Set<RecorderListener>()
    bucket.add(listener)
    this.listeners.set(type, bucket)
  }

  start(): void {
    this.state = 'recording'
  }

  stop(): void {
    this.state = 'inactive'
    queueMicrotask(() => { this.fire('stop') })
  }

  /** Deliver one recorded chunk, exactly as the browser would. */
  emit(chunk: Blob): void {
    this.fire('dataavailable', { data: chunk })
  }

  private fire(type: string, event: { data: Blob } = { data: new Blob([]) }): void {
    for (const listener of [...(this.listeners.get(type) ?? [])]) listener(event)
  }
}

/** How the recorded Blob answers `arrayBuffer()`. */
type BufferMode = 'bytes' | 'gated' | 'reject'

interface MountOptions {
  /** Draft the composer already holds. */
  readonly draft?: string
  /** Container the recorder declares; the empty string makes the control fall back to the first chunk. */
  readonly recorderMimeType?: string
  /** Drop `navigator.mediaDevices` (an insecure origin). */
  readonly withoutMediaDevices?: boolean
  /** Drop `MediaRecorder` (a browser that never shipped it). */
  readonly withoutRecorder?: boolean
  /** Reject the permission request with this reason instead of granting. */
  readonly denyWith?: Error
  /** Withhold the permission answer until `grant()` or `deny()`. */
  readonly gatePermission?: boolean
  /** How the recorded Blob answers `arrayBuffer()`. */
  readonly buffer?: BufferMode
  /** The carrier envelope the injected transcribe callback resolves with. */
  readonly answer?: Answer
  /** Reject the transcribe call with this reason (an assembly fault). */
  readonly transcribeRejection?: Error
  /** Withhold the transcribe answer until `answerNow()` or `rejectNow()`. */
  readonly gateTranscribe?: boolean
}

const restores: (() => void)[] = []

afterEach(() => {
  cleanup()
  for (const restore of restores.splice(0).reverse()) restore()
  vi.unstubAllGlobals()
  FakeRecorder.instances = []
  FakeRecorder.mimeType = 'audio/webm;codecs=opus'
})

/**
 * Render the control over faked recording APIs and a driven draft cell.
 * @param options - the browser and Host behavior this test needs.
 * @returns the view plus the seams the test drives and asserts.
 */
function mount(options: MountOptions = {}) {
  FakeRecorder.mimeType = options.recorderMimeType ?? 'audio/webm;codecs=opus'
  const streams: FakeStream[] = []
  const constraints: unknown[] = []
  const requests: { request: VoiceInputTranscribeRequest; signal: AbortSignal }[] = []
  // Every recorded chunk's bytes in order: what the packaged Blob reads back,
  // and what the base64 the request carries must decode to.
  const recordedBytes: number[] = []

  let settlePermission: ((stream: FakeStream) => void) | undefined
  let failPermission: ((reason: Error) => void) | undefined
  const getUserMedia = (given: unknown): Promise<FakeStream> => {
    constraints.push(given)
    const stream = new FakeStream()
    streams.push(stream)
    if (options.gatePermission === true) {
      return new Promise<FakeStream>((resolve, reject) => {
        settlePermission = resolve
        failPermission = reject
      })
    }
    if ('denyWith' in options) return Promise.reject(options.denyWith)
    return Promise.resolve(stream)
  }
  if (options.withoutMediaDevices !== true) {
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia } })
    restores.push(() => { Reflect.deleteProperty(navigator, 'mediaDevices') })
  }
  if (options.withoutRecorder !== true) vi.stubGlobal('MediaRecorder', FakeRecorder)

  let settleBuffer: ((buffer: ArrayBuffer) => void) | undefined
  let failBuffer: ((reason: unknown) => void) | undefined
  const arrayBuffer = (): Promise<ArrayBuffer> => {
    if (options.buffer === 'reject') return Promise.reject(new Error('blob read failed'))
    if (options.buffer === 'gated') {
      return new Promise<ArrayBuffer>((resolve, reject) => {
        settleBuffer = resolve
        failBuffer = reject
      })
    }
    return Promise.resolve(Uint8Array.from(recordedBytes).buffer)
  }
  const originalBuffer = Object.getOwnPropertyDescriptor(Blob.prototype, 'arrayBuffer')
  Object.defineProperty(Blob.prototype, 'arrayBuffer', { configurable: true, writable: true, value: arrayBuffer })
  restores.push(() => {
    if (originalBuffer === undefined) Reflect.deleteProperty(Blob.prototype, 'arrayBuffer')
    else Object.defineProperty(Blob.prototype, 'arrayBuffer', originalBuffer)
  })

  let settleTranscribe: ((answer: Answer) => void) | undefined
  let failTranscribe: ((reason: unknown) => void) | undefined
  const transcribe = vi.fn((request: VoiceInputTranscribeRequest, signal: AbortSignal): Promise<Answer> => {
    requests.push({ request, signal })
    if (options.gateTranscribe === true) {
      return new Promise<Answer>((resolve, reject) => {
        settleTranscribe = resolve
        failTranscribe = reject
      })
    }
    if ('transcribeRejection' in options) return Promise.reject(options.transcribeRejection)
    return Promise.resolve(options.answer ?? { ok: true, value: { ok: true, value: { text: 'hello there' } } })
  })

  let draft = options.draft ?? ''
  const listeners = new Set<() => void>()
  const subscribe = (listener: () => void): (() => void) => {
    listeners.add(listener)
    return () => { listeners.delete(listener) }
  }
  const setDraft = vi.fn((next: string) => {
    draft = next
    for (const listener of [...listeners]) listener()
  })
  const useInput = (<T,>(select: (state: { draft: string }) => T): T =>
    useSyncExternalStore(subscribe, () => select({ draft }))) as never

  const props = { useInput, inputActions: { setDraft }, transcribe, t } as unknown as
    Parameters<typeof VoiceInputButton>[0]
  const view: RenderResult = render(<VoiceInputButton {...props} />)
  const mic = view.getByLabelText(zh['button.idle'])

  /** Flush the microtask chain the recorder's stop event opens (read, upload, settle). */
  const settle = async (ticks = 10): Promise<void> => {
    await act(async () => {
      for (let tick = 0; tick < ticks; tick += 1) await Promise.resolve()
    })
  }

  const liveRecorder = (): FakeRecorder => {
    const last = FakeRecorder.instances.at(-1)
    if (last === undefined) throw new Error('no recorder was constructed')
    return last
  }

  return {
    view,
    mic,
    streams,
    constraints,
    requests,
    transcribe,
    setDraft,
    settle,
    recorderCount: (): number => FakeRecorder.instances.length,
    /** The live region's announcement. */
    status: (): string => view.getByRole('status').textContent ?? '',
    /** The failure line shown beside the announcement, when one stands. */
    errorLine: (): string | null =>
      view.container.querySelector<HTMLElement>('[aria-hidden][title]')?.textContent ?? null,
    draft: (): string => draft,
    cancel: (): HTMLElement => view.getByRole('button', { name: zh['action.cancel'] }),
    /** Press and hold, letting the permission grant land. */
    press: async (): Promise<void> => {
      fireEvent.pointerDown(mic)
      await settle(2)
    },
    /** Deliver one recorded chunk of the given bytes. */
    emit: (bytes: readonly number[], type = 'audio/webm'): void => {
      recordedBytes.push(...bytes)
      act(() => { liveRecorder().emit(new Blob([Uint8Array.from(bytes)], { type })) })
    },
    grant: async (): Promise<void> => {
      const stream = streams.at(-1)
      if (stream === undefined || settlePermission === undefined) throw new Error('no permission request is open')
      settlePermission(stream)
      await settle(3)
    },
    deny: async (reason: Error): Promise<void> => {
      if (failPermission === undefined) throw new Error('no permission request is open')
      failPermission(reason)
      await settle(3)
    },
    releaseBuffer: async (bytes: readonly number[] = []): Promise<void> => {
      if (settleBuffer === undefined) throw new Error('no buffer read is open')
      settleBuffer(Uint8Array.from(bytes).buffer)
      await settle()
    },
    rejectBuffer: async (): Promise<void> => {
      if (failBuffer === undefined) throw new Error('no buffer read is open')
      failBuffer(new Error('blob read failed'))
      await settle()
    },
    answerNow: async (answer: Answer): Promise<void> => {
      if (settleTranscribe === undefined) throw new Error('no transcribe call is open')
      settleTranscribe(answer)
      await settle()
    },
    rejectNow: async (): Promise<void> => {
      if (failTranscribe === undefined) throw new Error('no transcribe call is open')
      failTranscribe(new Error('assembly fault'))
      await settle()
    },
  }
}

/** Decode the base64 a request carried back into bytes. */
function decode(data: string): number[] {
  return Array.from(atob(data), character => character.charCodeAt(0))
}

const AUDIO = [1, 2, 3, 250] as const

describe('VoiceInputButton gestures', () => {
  it('appends the transcript to a non-empty draft separated by one space', async () => {
    const ui = mount({ draft: 'already typed' })

    await ui.press()
    expect(ui.status()).toBe(zh['status.recording'])
    ui.emit(AUDIO)
    fireEvent.pointerUp(ui.mic)
    await ui.settle()

    expect(ui.setDraft).toHaveBeenCalledWith('already typed hello there')
    expect(ui.draft()).toBe('already typed hello there')
    await waitFor(() => { expect(ui.status()).toBe(zh['status.inserted']) })
  })

  it('appends the transcript to an empty draft with no leading space', async () => {
    const ui = mount({ draft: '' })

    await ui.press()
    ui.emit(AUDIO)
    fireEvent.pointerUp(ui.mic)
    await ui.settle()

    expect(ui.setDraft).toHaveBeenCalledWith('hello there')
    expect(ui.draft()).toBe('hello there')
  })

  it('trims the transcript the Host returned', async () => {
    const ui = mount({ answer: { ok: true, value: { ok: true, value: { text: '  spoken words \n' } } } })

    await ui.press()
    ui.emit(AUDIO)
    fireEvent.pointerUp(ui.mic)
    await ui.settle()

    expect(ui.setDraft).toHaveBeenCalledWith('spoken words')
  })

  it('appends to the draft as it stands when the answer lands, not as it stood at the press', async () => {
    const ui = mount({ draft: 'first', gateTranscribe: true })

    await ui.press()
    ui.emit(AUDIO)
    fireEvent.pointerUp(ui.mic)
    await ui.settle()
    // The human keeps typing while the upload is in flight.
    act(() => { ui.setDraft('first and second') })

    await ui.answerNow({ ok: true, value: { ok: true, value: { text: 'plus the voice' } } })

    expect(ui.draft()).toBe('first and second plus the voice')
  })

  it('starts on the first keyboard press and sends on the second', async () => {
    const ui = mount()

    fireEvent.click(ui.mic, { detail: 0 })
    await ui.settle(3)
    expect(ui.status()).toBe(zh['status.recording'])
    ui.emit(AUDIO)

    fireEvent.click(ui.mic, { detail: 0 })
    await ui.settle()

    expect(ui.transcribe).toHaveBeenCalledTimes(1)
    expect(ui.setDraft).toHaveBeenCalledWith('hello there')
  })

  it('ignores the pointer-driven click that follows every release', async () => {
    const ui = mount()

    await ui.press()
    ui.emit(AUDIO)
    fireEvent.pointerUp(ui.mic)
    // The browser fires this click after the release; handling it would record again.
    fireEvent.click(ui.mic, { detail: 1 })
    await ui.settle()

    expect(ui.transcribe).toHaveBeenCalledTimes(1)
    expect(ui.recorderCount()).toBe(1)
  })

  it('sends the recording when the pointer leaves the button while held', async () => {
    const ui = mount()

    await ui.press()
    ui.emit(AUDIO)
    fireEvent.pointerLeave(ui.mic)
    await ui.settle()

    expect(ui.transcribe).toHaveBeenCalledTimes(1)
  })

  it('sends the recording when the pointer gesture is cancelled', async () => {
    const ui = mount()

    await ui.press()
    ui.emit(AUDIO)
    fireEvent.pointerCancel(ui.mic)
    await ui.settle()

    expect(ui.transcribe).toHaveBeenCalledTimes(1)
  })

  it('does nothing when a release arrives with no recording open', async () => {
    const ui = mount()

    fireEvent.pointerUp(ui.mic)
    await ui.settle()

    expect(ui.recorderCount()).toBe(0)
    expect(ui.transcribe).not.toHaveBeenCalled()
    expect(ui.status()).toBe('')
  })

  it('sends once when a leave follows the release that already stopped the recorder', async () => {
    const ui = mount()

    await ui.press()
    ui.emit(AUDIO)
    fireEvent.pointerUp(ui.mic)
    // Before the recorder's stop event lands, so the recorder is still attached.
    fireEvent.pointerLeave(ui.mic)
    await ui.settle()

    expect(ui.transcribe).toHaveBeenCalledTimes(1)
  })

  it('asks for the microphone once while the permission prompt is still open', async () => {
    const ui = mount({ gatePermission: true })

    fireEvent.pointerDown(ui.mic)
    fireEvent.pointerDown(ui.mic)
    await ui.settle(2)

    expect(ui.constraints).toEqual([{ audio: true }])
  })

  it('asks for the microphone once while it is already recording', async () => {
    const ui = mount()

    await ui.press()
    fireEvent.pointerDown(ui.mic)
    await ui.settle(2)

    expect(ui.constraints).toHaveLength(1)
    expect(ui.recorderCount()).toBe(1)
  })

  it('starts no recording while an upload is in flight', async () => {
    const ui = mount({ gateTranscribe: true })

    await ui.press()
    ui.emit(AUDIO)
    fireEvent.pointerUp(ui.mic)
    await ui.settle()
    expect(ui.status()).toBe(zh['status.uploading'])

    fireEvent.pointerDown(ui.mic)
    await ui.settle(2)

    expect(ui.constraints).toHaveLength(1)
  })

  it('asks only for audio', async () => {
    const ui = mount()

    await ui.press()

    expect(ui.constraints).toEqual([{ audio: true }])
  })
})

describe('VoiceInputButton refusals it decides locally', () => {
  it('reports an unsupported browser when the page has no mediaDevices', async () => {
    const ui = mount({ withoutMediaDevices: true })

    await ui.press()

    expect(ui.status()).toBe(zh['error.unsupported'])
    expect(ui.errorLine()).toBe(zh['error.unsupported'])
    expect(ui.recorderCount()).toBe(0)
  })

  it('reports an unsupported browser when MediaRecorder never shipped', async () => {
    const ui = mount({ withoutRecorder: true })

    await ui.press()

    expect(ui.status()).toBe(zh['error.unsupported'])
    expect(ui.constraints).toHaveLength(0)
  })

  it.each([
    ['a refused permission', 'NotAllowedError'],
    ['a blocked insecure origin', 'SecurityError'],
  ])('reports a denied microphone for %s', async (_case, errorName) => {
    const ui = mount({ denyWith: new DOMException('denied', errorName) })

    await ui.press()

    expect(ui.status()).toBe(zh['error.permission'])
  })

  it('reports a recorder failure when the microphone request fails for another reason', async () => {
    const ui = mount({ denyWith: new Error('device busy') })

    await ui.press()

    expect(ui.status()).toBe(zh['error.recorder'])
  })

  it('reports a recorder failure for an unrelated DOMException', async () => {
    const ui = mount({ denyWith: new DOMException('no device', 'NotFoundError') })

    await ui.press()

    expect(ui.status()).toBe(zh['error.recorder'])
  })

  it('refuses a container the Host does not accept without uploading it', async () => {
    const ui = mount({ recorderMimeType: 'audio/flac' })

    await ui.press()
    ui.emit(AUDIO, 'audio/flac')
    fireEvent.pointerUp(ui.mic)
    await ui.settle()

    expect(ui.status()).toBe(t('error.format', { mediaType: 'audio/flac' }))
    expect(ui.transcribe).not.toHaveBeenCalled()
  })

  it('falls back to the first chunk container when the recorder declares none', async () => {
    const ui = mount({ recorderMimeType: '' })

    await ui.press()
    ui.emit(AUDIO, 'audio/ogg;codecs=opus')
    fireEvent.pointerUp(ui.mic)
    await ui.settle()

    expect(ui.requests[0]?.request.mediaType).toBe('audio/ogg')
  })

  it('refuses an undeclared container when no chunk arrived at all', async () => {
    const ui = mount({ recorderMimeType: '' })

    await ui.press()
    fireEvent.pointerUp(ui.mic)
    await ui.settle()

    expect(ui.status()).toBe(t('error.format', { mediaType: '' }))
    expect(ui.transcribe).not.toHaveBeenCalled()
  })

  it('reports a recording that captured nothing', async () => {
    const ui = mount()

    await ui.press()
    // A zero-size chunk is no audio, so the packaged recording stays empty.
    ui.emit([])
    fireEvent.pointerUp(ui.mic)
    await ui.settle()

    expect(ui.status()).toBe(zh['error.recorder'])
    expect(ui.transcribe).not.toHaveBeenCalled()
  })

  it('reports a recording it could not read', async () => {
    const ui = mount({ buffer: 'reject' })

    await ui.press()
    ui.emit(AUDIO)
    fireEvent.pointerUp(ui.mic)
    await ui.settle()

    expect(ui.status()).toBe(zh['error.recorder'])
    expect(ui.transcribe).not.toHaveBeenCalled()
  })
})

describe('VoiceInputButton transcription', () => {
  it('uploads the recorded bytes as base64 under the narrowed media type', async () => {
    const ui = mount()

    await ui.press()
    ui.emit(AUDIO)
    fireEvent.pointerUp(ui.mic)
    await ui.settle()

    const sent = ui.requests[0]?.request
    // The recorder declared audio/webm;codecs=opus; the parameters are dropped.
    expect(sent?.mediaType).toBe('audio/webm')
    expect(decode(sent?.data ?? '')).toEqual([...AUDIO])
  })

  it.each([
    ['audio-empty', { code: 'audio-empty' }, undefined],
    ['audio-undecodable', { code: 'audio-undecodable' }, undefined],
    ['audio-too-large', { code: 'audio-too-large', actualBytes: 26214400 }, { bytes: 26214400 }],
    ['provider-unavailable', { code: 'provider-unavailable', detail: 'none selected' }, undefined],
    ['provider-unconfigured', { code: 'provider-unconfigured', detail: 'no groq key' }, undefined],
    ['provider-failed', { code: 'provider-failed', detail: 'upstream 503' }, undefined],
    ['aborted', { code: 'aborted' }, undefined],
  ] as [string, VoiceInputFailure, Record<string, unknown> | undefined][])(
    'gives the %s failure its own line', async (code, error, params) => {
      const ui = mount({ answer: { ok: true, value: { ok: false, error } } })

      await ui.press()
      ui.emit(AUDIO)
      fireEvent.pointerUp(ui.mic)
      await ui.settle()

      expect(ui.status()).toBe(t('error.' + code, params))
      expect(ui.errorLine()).toBe(t('error.' + code, params))
      expect(ui.setDraft).not.toHaveBeenCalled()
    })

  it('reports one connection line when the carrier itself failed', async () => {
    const ui = mount({
      answer: { ok: false, error: { code: 'rpc-timeout', message: 'gateway went away', details: {} } },
    })

    await ui.press()
    ui.emit(AUDIO)
    fireEvent.pointerUp(ui.mic)
    await ui.settle()

    // The carrier's own code is operator-facing, so it never reaches the user.
    expect(ui.status()).toBe(zh['error.carrier'])
    expect(ui.setDraft).not.toHaveBeenCalled()
  })

  it('reports one connection line when the call never settled into an envelope', async () => {
    const ui = mount({ transcribeRejection: new Error('assembly fault') })

    await ui.press()
    ui.emit(AUDIO)
    fireEvent.pointerUp(ui.mic)
    await ui.settle()

    expect(ui.status()).toBe(zh['error.carrier'])
  })

  it.each([
    ['an empty transcript', ''],
    ['a whitespace-only transcript', '   \n\t '],
  ])('reports a silent take for %s and leaves the draft untouched', async (_case, text) => {
    const ui = mount({ draft: 'keep me', answer: { ok: true, value: { ok: true, value: { text } } } })

    await ui.press()
    ui.emit(AUDIO)
    fireEvent.pointerUp(ui.mic)
    await ui.settle()

    expect(ui.status()).toBe(zh['status.silent'])
    expect(ui.setDraft).not.toHaveBeenCalled()
    expect(ui.draft()).toBe('keep me')
  })

  it('announces recording, then uploading, then the outcome', async () => {
    const ui = mount({ gateTranscribe: true })
    expect(ui.status()).toBe('')

    await ui.press()
    expect(ui.status()).toBe(zh['status.recording'])
    expect(ui.mic.getAttribute('aria-pressed')).toBe('true')

    ui.emit(AUDIO)
    fireEvent.pointerUp(ui.mic)
    await ui.settle()
    expect(ui.status()).toBe(zh['status.uploading'])
    expect(ui.mic.getAttribute('aria-busy')).toBe('true')
    expect(ui.mic.getAttribute('aria-label')).toBe(zh['button.uploading'])

    await ui.answerNow({ ok: true, value: { ok: true, value: { text: 'done' } } })

    expect(ui.status()).toBe(zh['status.inserted'])
    expect(ui.mic.getAttribute('aria-busy')).toBe('false')
    expect(ui.mic.getAttribute('aria-label')).toBe(zh['button.idle'])
  })

  it('keeps an ordinary outcome out of the visible failure line', async () => {
    const ui = mount()

    await ui.press()
    ui.emit(AUDIO)
    fireEvent.pointerUp(ui.mic)
    await ui.settle()

    expect(ui.status()).toBe(zh['status.inserted'])
    expect(ui.errorLine()).toBeNull()
  })

  it('names the recording gesture on the button while the microphone is live', async () => {
    const ui = mount()

    await ui.press()

    expect(ui.mic.getAttribute('aria-label')).toBe(zh['button.recording'])
    expect(ui.mic.getAttribute('title')).toBe(zh['button.recording'])
  })
})

describe('VoiceInputButton cancellation', () => {
  it('reports a cancelled upload and ignores the answer that arrives afterwards', async () => {
    const ui = mount({ draft: 'typed', gateTranscribe: true })

    await ui.press()
    ui.emit(AUDIO)
    fireEvent.pointerUp(ui.mic)
    await ui.settle()

    fireEvent.click(ui.cancel(), { detail: 1 })
    expect(ui.status()).toBe(zh['status.cancelled'])

    await ui.answerNow({ ok: true, value: { ok: true, value: { text: 'too late' } } })

    expect(ui.status()).toBe(zh['status.cancelled'])
    expect(ui.setDraft).not.toHaveBeenCalled()
    expect(ui.draft()).toBe('typed')
  })

  it('aborts the signal the Host is holding', async () => {
    const ui = mount({ gateTranscribe: true })

    await ui.press()
    ui.emit(AUDIO)
    fireEvent.pointerUp(ui.mic)
    await ui.settle()
    expect(ui.requests[0]?.signal.aborted).toBe(false)

    fireEvent.click(ui.cancel(), { detail: 1 })

    expect(ui.requests[0]?.signal.aborted).toBe(true)
  })

  it('ignores a rejection that arrives after the upload was cancelled', async () => {
    const ui = mount({ gateTranscribe: true })

    await ui.press()
    ui.emit(AUDIO)
    fireEvent.pointerUp(ui.mic)
    await ui.settle()
    fireEvent.click(ui.cancel(), { detail: 1 })

    await ui.rejectNow()

    expect(ui.status()).toBe(zh['status.cancelled'])
  })

  it('cancels once when the affordance is pressed twice before it leaves', async () => {
    const ui = mount({ gateTranscribe: true })

    await ui.press()
    ui.emit(AUDIO)
    fireEvent.pointerUp(ui.mic)
    await ui.settle()

    const cancel = ui.cancel()
    // Both handlers run before the re-render removes the affordance.
    await act(async () => {
      cancel.click()
      cancel.click()
    })

    expect(ui.status()).toBe(zh['status.cancelled'])
    expect(ui.view.queryByRole('button', { name: zh['action.cancel'] })).toBeNull()
  })

  it('offers no cancel affordance while idle or recording', async () => {
    const ui = mount()
    expect(ui.view.queryByRole('button', { name: zh['action.cancel'] })).toBeNull()

    await ui.press()

    expect(ui.view.queryByRole('button', { name: zh['action.cancel'] })).toBeNull()
  })
})

describe('VoiceInputButton unmount', () => {
  it('releases the microphone when the control unmounts while recording', async () => {
    const ui = mount()

    await ui.press()
    ui.emit(AUDIO)
    ui.view.unmount()
    await ui.settle()

    expect(ui.streams[0]?.allStopped).toBe(true)
    expect(ui.transcribe).not.toHaveBeenCalled()
  })

  it('releases the granted stream when the permission prompt outlived the control', async () => {
    const ui = mount({ gatePermission: true })

    fireEvent.pointerDown(ui.mic)
    await ui.settle(2)
    ui.view.unmount()

    await ui.grant()

    // The grant still opened a live track, so it must be stopped rather than
    // recorded into a control that no longer exists.
    expect(ui.streams[0]?.allStopped).toBe(true)
    expect(ui.recorderCount()).toBe(0)
  })

  it('swallows a denial that arrives after the control unmounted', async () => {
    const ui = mount({ gatePermission: true })

    fireEvent.pointerDown(ui.mic)
    await ui.settle(2)
    ui.view.unmount()

    await ui.deny(new DOMException('denied', 'NotAllowedError'))

    expect(ui.recorderCount()).toBe(0)
  })

  it('leaves nothing to stop when the control never recorded', async () => {
    const ui = mount()

    ui.view.unmount()
    await ui.settle()

    expect(ui.streams).toHaveLength(0)
    expect(ui.recorderCount()).toBe(0)
  })

  it('leaves nothing to stop when the recorder already stopped', async () => {
    const ui = mount()

    await ui.press()
    ui.emit(AUDIO)
    fireEvent.pointerUp(ui.mic)
    // The recorder is inactive but still attached; unmount must not stop it twice.
    ui.view.unmount()
    await ui.settle()

    expect(ui.streams[0]?.allStopped).toBe(true)
    expect(ui.transcribe).not.toHaveBeenCalled()
  })

  it('ignores the transcript when the control unmounted mid-upload', async () => {
    const ui = mount({ gateTranscribe: true })

    await ui.press()
    ui.emit(AUDIO)
    fireEvent.pointerUp(ui.mic)
    await ui.settle()
    ui.view.unmount()
    expect(ui.requests[0]?.signal.aborted).toBe(true)

    await ui.answerNow({ ok: true, value: { ok: true, value: { text: 'nobody is listening' } } })

    expect(ui.setDraft).not.toHaveBeenCalled()
  })

  it('ignores a rejection that arrives after the control unmounted mid-upload', async () => {
    const ui = mount({ gateTranscribe: true })

    await ui.press()
    ui.emit(AUDIO)
    fireEvent.pointerUp(ui.mic)
    await ui.settle()
    ui.view.unmount()

    await ui.rejectNow()

    expect(ui.setDraft).not.toHaveBeenCalled()
  })

  it('ignores an empty recording read back after the control unmounted', async () => {
    const ui = mount({ buffer: 'gated' })

    await ui.press()
    ui.emit(AUDIO)
    fireEvent.pointerUp(ui.mic)
    await ui.settle()
    ui.view.unmount()

    await ui.releaseBuffer([])

    expect(ui.transcribe).not.toHaveBeenCalled()
  })

  it('ignores an unreadable recording reported after the control unmounted', async () => {
    const ui = mount({ buffer: 'gated' })

    await ui.press()
    ui.emit(AUDIO)
    fireEvent.pointerUp(ui.mic)
    await ui.settle()
    ui.view.unmount()

    await ui.rejectBuffer()

    expect(ui.transcribe).not.toHaveBeenCalled()
  })

  it('uploads the recording read back while the control is still mounted', async () => {
    const ui = mount({ buffer: 'gated' })

    await ui.press()
    ui.emit(AUDIO)
    fireEvent.pointerUp(ui.mic)
    await ui.settle()

    await ui.releaseBuffer(AUDIO)

    expect(decode(ui.requests[0]?.request.data ?? '')).toEqual([...AUDIO])
  })
})

describe('VoiceInputButton microphone release', () => {
  it.each([
    ['a completed transcription', {}],
    ['a container it refused', { recorderMimeType: 'audio/flac' }],
    ['a recording it could not read', { buffer: 'reject' as BufferMode }],
    ['a carrier failure', {
      answer: { ok: false, error: { code: 'rpc-timeout', message: 'gone', details: {} } } as Answer,
    }],
    ['a business failure', {
      answer: { ok: true, value: { ok: false, error: { code: 'aborted' } } } as Answer,
    }],
  ])('stops every track after %s', async (_case, options) => {
    const ui = mount(options)

    await ui.press()
    ui.emit(AUDIO)
    fireEvent.pointerUp(ui.mic)
    await ui.settle()

    expect(ui.streams).toHaveLength(1)
    expect(ui.streams[0]?.allStopped).toBe(true)
  })

  it('opens no stream to release when the microphone was denied', async () => {
    const ui = mount({ denyWith: new DOMException('denied', 'NotAllowedError') })

    await ui.press()

    expect(ui.streams[0]?.allStopped).toBe(false)
    expect(ui.status()).toBe(zh['error.permission'])
  })
})
