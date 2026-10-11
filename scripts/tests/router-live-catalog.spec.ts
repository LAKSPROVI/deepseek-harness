/** CLI transport and watch behavior run with private files and ephemeral loopback ports. */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'

// Process startup competes with the repository's concurrent build and test lanes.
it('runs the keyless router catalog and watch scenarios through plain Node', async () => {
  const result = await promisify(execFile)(process.execPath, ['--test', fileURLToPath(new URL('./sync-router-live-models.test.mjs', import.meta.url))], { timeout: 110000 })
  expect(result.stdout).toMatch(/fail 0/)
  expect(result.stdout).toContain('CLI watch authenticates')
}, 120000)
