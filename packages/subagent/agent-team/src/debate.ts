/** Structured Team debate creation and compare-and-set transitions. */

import { randomUUID } from 'node:crypto'
import { Buffer } from 'node:buffer'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { TeamJournal } from './journal.ts'
import type { TeamMembership, TeamRoster } from './roster.ts'
import { TeamError } from './error.ts'
import { TeamDebateId, TeamId } from './types.ts'
import type {
  ContributeTeamDebateRequest,
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
    private readonly maxContentBytes: number,
  ) {}

  /** Return the current durable debate, when present. */
  get(membership: TeamMembership): TeamDebateSnapshot | undefined {
    return this.journal.state(membership.root).debate
  }

  /** Create a revision-one active debate. */
  async start(caller: Agent, request: StartTeamDebateRequest): Promise<TeamDebateSnapshot> {
    const membership = this.requireLead(caller)
    const topic = requiredText(request.topic, 'topic', 4_000)
    const maxRounds = request.maxRounds ?? 2
    if (!Number.isSafeInteger(maxRounds) || maxRounds < 1 || maxRounds > this.maxRounds) {
      throw new TeamError(`maxRounds must be an integer from 1 through ${this.maxRounds}`, 'TEAM_INVALID_ARGUMENT')
    }
    const participants = this.participants(membership, request.participants)
    const debateId = TeamDebateId(randomUUID())
    const evidence = [...(request.evidence ?? [])]
    if (evidence.length > 0) this.assertContent(evidence, 'debate evidence')
    const debate: TeamDebateSnapshot = {
      id: debateId,
      revision: 1,
      topic,
      evidence,
      status: 'active',
      phase: 'positions',
      round: 1,
      maxRounds,
      participants,
      contributions: [],
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

  /** Append one participant contribution to the active phase. */
  async contribute(caller: Agent, request: ContributeTeamDebateRequest): Promise<TeamDebateSnapshot> {
    const membership = this.roster.membership(caller)
    const content = [...request.content]
    this.assertContent(content, 'debate contribution')
    return await this.journal.transact(membership.root.id, async () => {
      const current = this.journal.state(membership.root).debate
      if (current === undefined) throw new TeamError('no Team debate exists', 'TEAM_DEBATE_NOT_FOUND')
      this.assertCurrent(current, request.debateId, request.expectedRevision)
      if (current.status !== 'active') {
        throw new TeamError('contributions require an active Team debate', 'TEAM_DEBATE_TRANSITION')
      }
      if (!current.participants.includes(membership.name)) {
        throw new TeamError(`Team member "${membership.name}" is not a debate participant`, 'TEAM_DEBATE_PARTICIPANT_REQUIRED')
      }
      const duplicate = current.contributions.some(contribution =>
        contribution.round === current.round && contribution.phase === current.phase
        && contribution.author === membership.name)
      if (duplicate) {
        throw new TeamError(
          `Team member "${membership.name}" already contributed to round ${current.round} ${current.phase}`,
          'TEAM_DEBATE_CONTRIBUTION_EXISTS',
        )
      }
      const revision = current.revision + 1
      const next: TeamDebateSnapshot = {
        ...current,
        revision,
        contributions: [...current.contributions, {
          sequence: current.contributions.length + 1,
          revision,
          round: current.round,
          phase: current.phase,
          author: membership.name,
          content,
          createdAt: Date.now(),
        }],
      }
      await this.journal.appendAndFlush(membership.root, 'team/debate', {
        version: 1,
        teamId: TeamId(membership.root.id),
        debate: next,
      })
      return next
    })
  }

  /** Apply one Lead-authorized compare-and-set transition. */
  async update(caller: Agent, request: UpdateTeamDebateRequest): Promise<TeamDebateSnapshot> {
    const membership = this.requireLead(caller)
    const note = request.note === undefined ? undefined : requiredText(request.note, 'note', 1_000)
    return await this.journal.transact(membership.root.id, async () => {
      const current = this.journal.state(membership.root).debate
      if (current === undefined) throw new TeamError('no Team debate exists', 'TEAM_DEBATE_NOT_FOUND')
      this.assertCurrent(current, request.debateId, request.expectedRevision)
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
        this.assertPhaseComplete(current)
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
        this.assertPhaseComplete(current)
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

  private assertCurrent(current: TeamDebateSnapshot, id: TeamDebateId, revision: number): void {
    if (current.id === id && current.revision === revision) return
    throw new TeamError(
      `stale debate ref "${id}" revision ${revision}; current is "${current.id}" revision ${current.revision}`,
      'TEAM_DEBATE_STALE',
    )
  }

  private assertContent(content: readonly unknown[], subject: string): void {
    if (content.length === 0) throw new TeamError(`${subject} must not be empty`, 'TEAM_INVALID_ARGUMENT')
    const bytes = Buffer.byteLength(JSON.stringify(content), 'utf8')
    if (bytes > this.maxContentBytes) {
      throw new TeamError(`${subject} exceeds ${this.maxContentBytes} UTF-8 bytes`, 'TEAM_INVALID_ARGUMENT')
    }
  }

  private assertPhaseComplete(current: TeamDebateSnapshot): void {
    const authors = new Set(current.contributions
      .filter(item => item.round === current.round && item.phase === current.phase)
      .map(item => item.author))
    const missing = current.participants.filter(name => !authors.has(name))
    if (missing.length > 0) {
      throw new TeamError(
        `debate phase ${current.round}/${current.phase} still requires contributions from: ${missing.join(', ')}`,
        'TEAM_DEBATE_INCOMPLETE',
      )
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
