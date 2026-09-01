/** Structured Team debate creation and compare-and-set transitions. */

import { randomUUID } from 'node:crypto'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { TeamJournal } from './journal.ts'
import type { TeamMembership, TeamRoster } from './roster.ts'
import { TeamError } from './error.ts'
import { TeamDebateId, TeamId } from './types.ts'
import type {
  StartTeamDebateRequest,
  TeamDebatePhase,
  TeamDebateSnapshot,
  TeamDebateStatus,
  UpdateTeamDebateRequest,
} from './types.ts'
import { requiredText } from './validation.ts'

const PHASES: readonly TeamDebatePhase[] = ['positions', 'critique', 'rebuttal', 'verification', 'synthesis']

/** Owns one current structured debate per Team. */
export class TeamDebateBoard {
  constructor(
    private readonly journal: TeamJournal,
    private readonly roster: TeamRoster,
    private readonly maxRounds: number,
  ) {}

  /**
   * Return the current durable debate, when present.
   * @param membership Team whose debate is requested.
   * @returns Current debate, or `undefined` when the Team has none.
   */
  get(membership: TeamMembership): TeamDebateSnapshot | undefined {
    return this.journal.state(membership.root).debate
  }

  /**
   * Create a revision-one active debate.
   * @param caller Lead Agent authorizing the operation.
   * @param request Topic, participants, and optional round limit.
   * @returns Persisted active debate.
   */
  async start(caller: Agent, request: StartTeamDebateRequest): Promise<TeamDebateSnapshot> {
    const membership = this.requireLead(caller)
    const topic = requiredText(request.topic, 'topic', 4_000)
    const maxRounds = request.maxRounds ?? 2
    if (!Number.isSafeInteger(maxRounds) || maxRounds < 1 || maxRounds > this.maxRounds) {
      throw new TeamError(`maxRounds must be an integer from 1 through ${this.maxRounds}`, 'TEAM_INVALID_ARGUMENT')
    }
    const participants = this.participants(membership, request.participants)
    const debateId = TeamDebateId(randomUUID())
    const debate: TeamDebateSnapshot = {
      id: debateId,
      revision: 1,
      topic,
      status: 'active',
      phase: 'positions',
      round: 1,
      maxRounds,
      participants,
      history: [{ revision: 1, round: 1, phase: 'positions', status: 'active', actor: membership.name }],
    }
    return await this.journal.transact(membership.root.id, async () => {
      const current = this.journal.state(membership.root).debate
      if (current !== undefined && current.status !== 'completed') {
        throw new TeamError('an active or paused Team debate already exists', 'TEAM_DEBATE_ACTIVE')
      }
      await this.journal.appendAndFlush(membership.root, 'team/debate', {
        version: 1,
        teamId: TeamId(membership.root.id),
        debate,
      })
      return debate
    })
  }

  /**
   * Apply one Lead-authorized compare-and-set transition.
   * @param caller Lead Agent authorizing the operation.
   * @param request Debate identity, expected revision, action, and optional note.
   * @returns Persisted debate after the transition.
   */
  async update(caller: Agent, request: UpdateTeamDebateRequest): Promise<TeamDebateSnapshot> {
    const membership = this.requireLead(caller)
    const note = request.note === undefined ? undefined : requiredText(request.note, 'note', 1_000)
    return await this.journal.transact(membership.root.id, async () => {
      const current = this.journal.state(membership.root).debate
      if (current === undefined) throw new TeamError('no Team debate exists', 'TEAM_DEBATE_NOT_FOUND')
      if (current.id !== request.debateId || current.revision !== request.expectedRevision) {
        throw new TeamError(
          `stale debate ref "${request.debateId}" revision ${request.expectedRevision}; current is "${current.id}" revision ${current.revision}`,
          'TEAM_DEBATE_STALE',
        )
      }
      const next = this.transition(current, request.action, membership.name, note)
      await this.journal.appendAndFlush(membership.root, 'team/debate', {
        version: 1,
        teamId: TeamId(membership.root.id),
        debate: next,
      })
      return next
    })
  }

  private transition(
    current: TeamDebateSnapshot,
    action: UpdateTeamDebateRequest['action'],
    actor: string,
    note: string | undefined,
  ): TeamDebateSnapshot {
    if (current.status === 'completed') {
      throw new TeamError('completed Team debate cannot change', 'TEAM_DEBATE_COMPLETED')
    }
    let status: TeamDebateStatus = current.status
    let phase = current.phase
    let round = current.round
    switch (action) {
      case 'pause':
        if (current.status !== 'active') throw new TeamError('only an active debate can pause', 'TEAM_DEBATE_TRANSITION')
        status = 'paused'
        break
      case 'resume':
        if (current.status !== 'paused') throw new TeamError('only a paused debate can resume', 'TEAM_DEBATE_TRANSITION')
        status = 'active'
        break
      case 'advance': {
        if (current.status !== 'active') throw new TeamError('only an active debate can advance', 'TEAM_DEBATE_TRANSITION')
        const index = PHASES.indexOf(current.phase)
        if (index < PHASES.length - 1) {
          const nextPhase = PHASES[index + 1]
          if (nextPhase === undefined) {
            throw new TeamError('debate phase sequence is incomplete', 'TEAM_DEBATE_TRANSITION')
          }
          phase = nextPhase
        } else if (current.round < current.maxRounds) {
          phase = 'positions'
          round += 1
        } else {
          status = 'completed'
        }
        break
      }
      case 'complete':
        if (current.status !== 'active' || current.phase !== 'synthesis') {
          throw new TeamError('a debate can complete only from active synthesis', 'TEAM_DEBATE_TRANSITION')
        }
        status = 'completed'
        break
    }
    const revision = current.revision + 1
    return {
      ...current,
      revision,
      status,
      phase,
      round,
      history: [...current.history, {
        revision,
        round,
        phase,
        status,
        actor,
        ...(note === undefined ? {} : { note }),
      }],
    }
  }

  private requireLead(caller: Agent): TeamMembership {
    const membership = this.roster.membership(caller)
    if (membership.role !== 'lead') throw new TeamError('only the Team Lead can control a debate', 'TEAM_LEAD_REQUIRED')
    return membership
  }

  private participants(membership: TeamMembership, requested: readonly string[]): string[] {
    const names = requested.map(name => name.trim())
    if (names.length < 2 || names.length > 10 || new Set(names).size !== names.length) {
      throw new TeamError('participants must contain 2 through 10 unique Team member names', 'TEAM_INVALID_ARGUMENT')
    }
    const available = new Set(this.roster.list(membership)
      .filter(member => member.status !== 'failed' && member.status !== 'provisioning')
      .map(member => member.name))
    for (const name of names) {
      if (!available.has(name)) throw new TeamError(`active debate participant "${name}" not found`, 'TEAM_MEMBER_NOT_FOUND')
    }
    return names
  }
}
