/**
 * Audio packaging: the container declaration a recorder reports narrowed onto
 * the media types the Host accepts, and the base64 encoding the JSON-only RPC
 * carries — including a buffer past the encoder's chunk size.
 */
import { describe, expect, it } from 'vitest'
import { bytesToBase64, resolveMediaType } from '../src/client/audio.ts'

describe('resolveMediaType', () => {
  it.each([
    'audio/webm',
    'audio/ogg',
    'audio/wav',
    'audio/mp4',
    'audio/mpeg',
  ])('accepts the bare container %s', (declared) => {
    expect(resolveMediaType(declared)).toBe(declared)
  })

  it('drops the codec parameters a recorder appends to its container', () => {
    expect(resolveMediaType('audio/webm;codecs=opus')).toBe('audio/webm')
    expect(resolveMediaType('audio/ogg;codecs=opus;rate=48000')).toBe('audio/ogg')
  })

  it('reads a container the recorder spelled in another case', () => {
    expect(resolveMediaType('AUDIO/WEBM')).toBe('audio/webm')
    expect(resolveMediaType('Audio/MP4;Codecs=mp4a.40.2')).toBe('audio/mp4')
  })

  it('reads a container padded with whitespace', () => {
    expect(resolveMediaType('  audio/wav  ')).toBe('audio/wav')
    expect(resolveMediaType('audio/mpeg ; codecs=mp3')).toBe('audio/mpeg')
  })

  it.each([
    ['a container the Host does not accept', 'audio/flac'],
    ['an accepted subtype under another top type', 'video/webm'],
    ['an undeclared container', ''],
    ['whitespace alone', '   '],
    ['a generic binary type', 'application/octet-stream'],
  ])('leaves %s unresolved', (_case, declared) => {
    expect(resolveMediaType(declared)).toBeUndefined()
  })
})

describe('bytesToBase64', () => {
  it('encodes an empty buffer', () => {
    expect(bytesToBase64(new Uint8Array(0))).toBe('')
  })

  it('encodes a buffer larger than one encoding chunk back to the same bytes', () => {
    // Past 0x8000 the encoder must loop: spreading a whole audio buffer into
    // String.fromCharCode exceeds the argument limit and throws.
    const bytes = Uint8Array.from({ length: 0x8000 * 2 + 5 }, (_value, index) => (index * 7) % 256)

    const encoded = bytesToBase64(bytes)

    expect(encoded).toBe(Buffer.from(bytes).toString('base64'))
    expect(Uint8Array.from(atob(encoded), character => character.charCodeAt(0))).toEqual(bytes)
  })

  it('encodes every byte value in one sub-chunk buffer', () => {
    const bytes = Uint8Array.from({ length: 256 }, (_value, index) => index)

    expect(bytesToBase64(bytes)).toBe(Buffer.from(bytes).toString('base64'))
  })
})
