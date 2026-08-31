/** Deterministic keyless Agent Teams adapter for the real headless Loader snapshot. */

import { CallId, LlmAdapter } from '@deepseek-ai/dsh-llm'

let nextCall = 0

function calls(messages) {
  return messages.flatMap(message => message.role === 'assistant'
    ? message.content.filter(block => block.type === 'tool-call').map(block => block.name)
    : [])
}

function latestAssistantCalls(messages) {
  const assistant = messages.findLast(message => message.role === 'assistant')
  return assistant?.content.filter(block => block.type === 'tool-call').map(block => block.name) ?? []
}

function hasTaskAction(messages, action) {
  return messages.some(message => message.role === 'assistant'
    && message.content.some((block) => {
      if (block.type !== 'tool-call' || block.name !== 'team_task_update') return false
      try {
        return JSON.parse(block.arguments).action === action
      } catch {
        return false
      }
    }))
}

function latestToolText(messages) {
  const message = messages.findLast(candidate => candidate.content.some(block => block.type === 'tool-result'))
  if (message === undefined) return ''
  return message.content.flatMap(block => block.type === 'tool-result'
    ? block.content.filter(item => item.type === 'text').map(item => item.text)
    : []).join('\n')
}

function latestToolJson(messages) {
  try {
    return JSON.parse(latestToolText(messages))
  } catch {
    return undefined
  }
}

function toolChunks(specs) {
  const chunks = []
  for (const [index, spec] of specs.entries()) {
    const id = CallId(`team-fixture-${++nextCall}`)
    const args = JSON.stringify(spec.args)
    chunks.push(
      { type: 'block-start', index, blockType: 'tool-call' },
      { type: 'tool-call-delta', index, id, name: spec.name, argumentsDelta: args },
      { type: 'block-end', index, block: { type: 'tool-call', id, name: spec.name, arguments: args } },
    )
  }
  chunks.push(
    { type: 'usage', usage: { inputTokens: 10, outputTokens: 5 } },
    { type: 'finish', reason: { kind: 'tool-calls' } },
  )
  return chunks
}

function textChunks(text) {
  return [
    { type: 'block-start', index: 0, blockType: 'text' },
    { type: 'text-delta', index: 0, text },
    { type: 'block-end', index: 0, block: { type: 'text', text } },
    { type: 'usage', usage: { inputTokens: 10, outputTokens: 3 } },
    { type: 'finish', reason: { kind: 'stop' } },
  ]
}

function researcher(messages) {
  const names = calls(messages)
  if (!names.includes('team_task_create')) {
    return toolChunks([{ name: 'team_task_create', args: {
      subject: 'Research', description: 'Collect the deterministic finding.', write_scopes: ['research'],
    } }])
  }
  if (!names.includes('team_task_update')) {
    return toolChunks([{ name: 'team_task_update', args: {
      task_id: 'task-1', expected_revision: 1, action: 'claim',
    } }])
  }
  if (!names.includes('send_message')) {
    return toolChunks([
      { name: 'team_task_update', args: { task_id: 'task-1', expected_revision: 2, action: 'complete' } },
      { name: 'send_message', args: { target: 'implementer', message: 'Research complete: use the deterministic finding.' } },
    ])
  }
  return textChunks('Research teammate complete.')
}

function implementer(messages) {
  const names = calls(messages)
  const last = latestAssistantCalls(messages)
  const text = latestToolText(messages)
  if (!names.includes('team_task_create')) {
    if (last.includes('team_task_get') && text.includes('"subject":"Research"')) {
      return toolChunks([{ name: 'team_task_create', args: {
        subject: 'Implementation',
        description: 'Apply the deterministic finding.',
        blocked_by: ['task-1'],
        write_scopes: ['implementation'],
      } }])
    }
    if (last.includes('wait_agent')) {
      return toolChunks([{ name: 'team_task_get', args: { task_id: 'task-1' } }])
    }
    return toolChunks([{ name: 'wait_agent', args: { timeout_ms: 10000 } }])
  }
  if (!hasTaskAction(messages, 'claim')) {
    if (last.includes('team_task_get') && text.includes('"status":"completed"')) {
      return toolChunks([{ name: 'team_task_update', args: {
        task_id: 'task-2', expected_revision: 1, action: 'claim',
      } }])
    }
    if (last.includes('team_task_get')) {
      return toolChunks([{ name: 'team_task_get', args: { task_id: 'task-1' } }])
    }
    if (last.includes('wait_agent')) {
      return toolChunks([{ name: 'team_task_get', args: { task_id: 'task-1' } }])
    }
    return toolChunks([{ name: 'team_task_get', args: { task_id: 'task-1' } }])
  }
  if (!names.includes('send_message')) {
    return toolChunks([
      { name: 'team_task_update', args: { task_id: 'task-2', expected_revision: 2, action: 'complete' } },
      { name: 'send_message', args: { target: 'lead', message: 'Implementation complete and verified.' } },
    ])
  }
  return textChunks('Implementation teammate complete.')
}

function lead(messages) {
  const names = calls(messages)
  const last = latestAssistantCalls(messages)
  const spawned = names.filter(name => name === 'spawn_teammate').length
  if (spawned === 0) {
    return toolChunks([{
      name: 'spawn_teammate',
      args: {
        name: 'implementer',
        description: 'Own deterministic implementation.',
        prompt: 'IMPLEMENTER_MARK: wait for research, complete dependent task 2, report to lead.',
        context: 'fresh',
        llm_provider: 'team-primary',
        model: 'fixture-implementer',
        persona: 'You implement the verified proposal.',
      },
    }])
  }
  if (spawned === 1) {
    return toolChunks([{
      name: 'spawn_teammate',
      args: {
        name: 'researcher',
        description: 'Own deterministic research.',
        prompt: 'RESEARCHER_MARK: complete research task 1, message implementer, then finish.',
        context: 'fresh',
        llm_provider: 'team-review',
        model: 'fixture-researcher',
        persona: 'You challenge assumptions and verify evidence.',
      },
    }])
  }
  const result = latestToolText(messages)
  if (last.includes('team_task_list')) {
    const completed = result.match(/"status":"completed"/gu)?.length ?? 0
    if (completed >= 2 && !names.includes('team_debate_start')) {
      return toolChunks([{ name: 'team_debate_start', args: {
        topic: 'Which implementation is supported by the verified evidence?',
        participants: ['lead', 'implementer', 'researcher'],
        max_rounds: 1,
      } }])
    }
    return toolChunks([{ name: 'team_task_list', args: {} }])
  }
  if (last.includes('team_debate_start') || last.includes('team_debate_update')) {
    const debate = latestToolJson(messages)
    if (debate?.status === 'completed') return toolChunks([{ name: 'list_agents', args: {} }])
    return toolChunks([{ name: 'team_debate_update', args: {
      debate_id: debate.id,
      expected_revision: debate.revision,
      action: debate.phase === 'synthesis' ? 'complete' : 'advance',
      note: `Completed ${debate.phase}.`,
    } }])
  }
  if (last.includes('list_agents')) {
    const inactive = result.match(/"status":"inactive"/gu)?.length ?? 0
    if (inactive >= 2) return textChunks('TEAM_WORKFLOW_OK: heterogeneous teammates, dependent tasks, and structured debate completed.')
    return toolChunks([{ name: 'list_agents', args: {} }])
  }
  if (last.includes('wait_agent')) return toolChunks([{ name: 'team_task_list', args: {} }])
  return toolChunks([{ name: 'wait_agent', args: { timeout_ms: 10000 } }])
}

class TeamFixtureAdapter extends LlmAdapter {
  async * stream(options) {
    const userText = options.messages.flatMap(message => message.role === 'user'
      ? message.content.filter(block => block.type === 'text').map(block => block.text)
      : []).join('\n')
    const chunks = userText.includes('RESEARCHER_MARK')
      ? researcher(options.messages)
      : userText.includes('IMPLEMENTER_MARK')
        ? implementer(options.messages)
        : lead(options.messages)
    for (const chunk of chunks) {
      options.signal?.throwIfAborted()
      yield chunk
    }
  }
}

/** Cordis plugin name. */
export const name = 'team-fixture-llm'
/** LLM registry dependency. */
export const inject = ['llm']

/** Register one keyless adapter under the Lead and two teammate routes. */
export function apply(ctx) {
  ctx.llm.registerAdapter(['deepseek-official', 'team-primary', 'team-review'], new TeamFixtureAdapter())
}
