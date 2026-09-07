import { describe, expect, it } from 'vitest'
import { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import { applyTeamProjection, teamProjectionSchema } from '../src/projection.ts'
import { TeamDebateId, TeamId, TeamTaskId } from '../src/types.ts'
import type { TeamDebateSnapshot, TeamProjection } from '../src/types.ts'

const TEAM = TeamId('team-root')
const MEMBER_ID = SessionId('worker-one')

function event(type: SessionEvent['type'], data: unknown, seq: number): SessionEvent {
  return { type, data, seq, time: seq } as SessionEvent
}

function debate(revision = 1): TeamDebateSnapshot {
  return {
    id: TeamDebateId('debate-one'),
    revision,
    topic: 'Choose the safer design',
    evidence: [],
    status: 'active',
    phase: revision === 1 ? 'positions' : 'critique',
    round: 1,
    maxRounds: 2,
    participants: ['lead', 'worker-one'],
    contributions: [],
    history: revision === 1
      ? [{ revision: 1, round: 1, phase: 'positions', status: 'active', actor: 'lead' }]
      : [
        { revision: 1, round: 1, phase: 'positions', status: 'active', actor: 'lead' },
        { revision: 2, round: 1, phase: 'critique', status: 'active', actor: 'lead' },
      ],
  }
}

describe('Agent Teams projection', () => {
  it('projects whole roster, task, and debate values while preserving unrelated identity', () => {
    const unrelated = event('turn/start', { turn: 1 }, 0)
    expect(applyTeamProjection(null, unrelated)).toBeNull()

    let state = applyTeamProjection(null, event('team/member', {
      version: 1,
      teamId: TEAM,
      member: {
        id: MEMBER_ID,
        name: 'worker-one',
        description: 'verify evidence',
        provider: 'spawn',
        llmProvider: 'mock',
        model: 'alternate-model',
        persona: 'Skeptical verifier',
        context: 'fresh',
        phase: 'provisioning',
      },
    }, 1))
    if (state === null) throw new Error('member event did not create projection')
    expect(applyTeamProjection(state, unrelated)).toBe(state)

    state = applyTeamProjection(state, event('team/member', {
      version: 1,
      teamId: TEAM,
      member: { ...state.members[0]!, phase: 'active' },
    }, 2))
    state = applyTeamProjection(state, event('team/task', {
      version: 1,
      teamId: TEAM,
      task: {
        id: TeamTaskId('task-1'), revision: 1, subject: 'Verify', description: 'Check sources',
        status: 'pending', blockedBy: [], writeScopes: [],
      },
    }, 3))
    state = applyTeamProjection(state, event('team/debate', {
      version: 1, teamId: TEAM, debate: debate(),
    }, 4))

    expect(state).toMatchObject({
      teamId: TEAM,
      members: [{ name: 'worker-one', phase: 'active', model: 'alternate-model' }],
      tasks: [{ id: 'task-1', revision: 1 }],
      debate: { id: 'debate-one', phase: 'positions', revision: 1 },
    })
    expect(teamProjectionSchema.parse(state)).toEqual(state)
  })

  it('replaces matching values and resets inherited state for another Team id', () => {
    const initial: TeamProjection = {
      teamId: TEAM,
      members: [{
        id: MEMBER_ID,
        name: 'worker-one',
        description: 'verify evidence',
        provider: 'spawn',
        context: 'fresh',
        phase: 'active',
      }],
      tasks: [],
      debate: debate(),
    }
    const advanced = applyTeamProjection(initial, event('team/debate', {
      version: 1, teamId: TEAM, debate: debate(2),
    }, 5))
    expect(advanced?.debate).toMatchObject({ revision: 2, phase: 'critique' })

    const forkTeam = TeamId('fork-root')
    const reset = applyTeamProjection(advanced, event('team/task', {
      version: 1,
      teamId: forkTeam,
      task: {
        id: TeamTaskId('task-1'), revision: 1, subject: 'Fork task', description: 'Own state',
        status: 'pending', blockedBy: [], writeScopes: [],
      },
    }, 6))
    expect(reset).toEqual({
      teamId: forkTeam,
      members: [],
      tasks: [expect.objectContaining({ subject: 'Fork task' })],
      debate: null,
    })
  })
})
