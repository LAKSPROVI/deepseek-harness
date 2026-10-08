/** SVG replay paths remain valid JSON on Windows and POSIX. */
import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { deriveReplayScript, parseSessionLog } from '@deepseek-ai/dsh-llm-replay'
import { presentSvgReplay } from './present-svg-fixture.ts'

const fixture = new URL('../../../snapshots/web/present-svg/session.v4.jsonl', import.meta.url)

describe('SVG replay workspace paths', () => {
  it.each([
    String.raw`C:\Users\Test User\AppData\Local\Temp\svg-test\workspace`,
    '/tmp/svg-test/workspace',
    '/tmp/svg-"quoted"/workspace',
  ])('writes the SVG into the selected workspace %s', async (cwd) => {
    const text = await readFile(fixture, 'utf8')
    const recorded = deriveReplayScript(parseSessionLog(text))
    const replay = presentSvgReplay(text, cwd)
    expect(replay).toHaveLength(recorded.length)
    const first = replay[0]!
    if (first.kind !== 'chunks') throw new Error('SVG fixture starts with chunk replay')
    const ending = first.chunks.find(chunk => chunk.type === 'block-end' && chunk.block.type === 'tool-call')
    if (ending?.type !== 'block-end' || ending.block.type !== 'tool-call') throw new Error('SVG write has assembled arguments')
    const args = ending.block.arguments
    const parsed = JSON.parse(args) as { file_path: string; content: string }
    expect(parsed.file_path).toBe(`${cwd}/von-neumann.svg`)
    expect(parsed.content).toBe(await readFile(new URL('../../../snapshots/web/present-svg/workspace.expected/von-neumann.svg', import.meta.url), 'utf8'))
    expect(replay.slice(1)).toEqual(recorded.slice(1))
    const recordedFirst = recorded[0]!
    if (recordedFirst.kind !== 'chunks') throw new Error('SVG fixture starts with chunk replay')
    expect(first.chunks).toHaveLength(recordedFirst.chunks.length)
    const unchanged = first.chunks.filter(chunk => chunk.type !== 'block-end' && chunk.type !== 'tool-call-delta')
    expect(unchanged).toEqual(recordedFirst.chunks.filter(chunk => chunk.type !== 'block-end' && chunk.type !== 'tool-call-delta'))
    expect(first.chunks.filter(chunk => chunk.type === 'tool-call-delta'))
      .toEqual(recordedFirst.chunks.filter(chunk => chunk.type === 'tool-call-delta'))
  })
})
