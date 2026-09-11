import type { Context } from '@deepseek-ai/cordis'
import type { TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol'
import { describe, expect, it } from 'vitest'
import { apply } from '../src/client/index.ts'

describe('Client Remote mount order', () => {
  it('publishes voiceInput before client plugins can wait for it', async () => {
    const mounted: string[] = []
    const disposed: string[] = []
    const ctx = {
      remote: {
        async $mount(contribution: TypertRemoteContribution) {
          mounted.push(contribution.package)
          return async () => { disposed.push(contribution.package) }
        },
      },
    } as unknown as Context

    const dispose = await apply(ctx)

    expect(mounted).toEqual([
      '@deepseek-ai/dsh-agent-presets',
      '@deepseek-ai/dsh-commands',
      '@deepseek-ai/dsh-api-settings-controller',
      '@deepseek-ai/dsh-goal',
      '@deepseek-ai/dsh-llm',
      '@deepseek-ai/dsh-cordis-host-runner',
      '@deepseek-ai/dsh-host-plugin-inventory',
      '@deepseek-ai/dsh-message-feedback',
      '@deepseek-ai/dsh-client-file-upload',
      '@deepseek-ai/dsh-session-reference',
      '@deepseek-ai/dsh-subagent',
      '@deepseek-ai/dsh-api-session-controller',
      '@deepseek-ai/dsh-api-workspace-controller',
      '@deepseek-ai/dsh-api-workspace-files',
      '@deepseek-ai/dsh-voice-input',
    ])

    await dispose()
    expect(disposed).toEqual([...mounted].reverse())
  })
})
