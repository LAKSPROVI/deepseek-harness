/** Build the SVG scenario's replay against its isolated workspace. */
import { deriveReplayScript, parseSessionLog, type ReplayEntry } from '@deepseek-ai/dsh-llm-replay'

/**
 * Materialize cwd placeholders in recorded tool-call fields; preserve every other chunk.
 * @param fixtureText - selected Session fixture generation.
 * @param workspaceCwd - isolated workspace connected by the browser.
 * @returns replay entries preserving the recorded chunk order and SVG content.
 */
export function presentSvgReplay(fixtureText: string, workspaceCwd: string): ReplayEntry[] {
  const escapedCwd = JSON.stringify(workspaceCwd).slice(1, -1)
  return deriveReplayScript(parseSessionLog(fixtureText)).map((entry) => {
    if (entry.kind !== 'chunks') return entry
    return { ...entry, chunks: entry.chunks.map((chunk) => {
      if (chunk.type === 'tool-call-delta') {
        return { ...chunk, argumentsDelta: chunk.argumentsDelta.replaceAll('{{cwd}}', escapedCwd) }
      }
      if (chunk.type === 'block-end' && chunk.block.type === 'tool-call') {
        return { ...chunk, block: { ...chunk.block, arguments: chunk.block.arguments.replaceAll('{{cwd}}', escapedCwd) } }
      }
      return chunk
    }) }
  })
}
