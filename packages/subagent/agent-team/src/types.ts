/** Public Agent Teams identities, durable records, and service request values. */

import type { EncodedAttachment } from '@deepseek-ai/dsh-attachment/types'
import type { Branded } from '@deepseek-ai/dsh-brand'
import type { ContentBlock, FileBlock, ImageBlock, TextBlock } from '@deepseek-ai/dsh-llm/types'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {} from '@deepseek-ai/dsh-session-projection/types'

/** Identifies the implicit team rooted at one top-level Session. */
export type TeamId = Branded<'TeamId'>

/** Brand one root Session identity as its implicit Team identity. */
export function TeamId(id: SessionId | string): TeamId {
  return id as TeamId
}

/** Stable identifier for one task in a Team. */
export type TeamTaskId = Branded<'TeamTaskId'>

/** Brand a validated Team-local task identity. */
export function TeamTaskId(id: string): TeamTaskId {
  return id as TeamTaskId
}

/** Stable identifier for one durable peer message. */
export type TeamMessageId = Branded<'TeamMessageId'>

/** Brand a generated peer-message identity. */
export function TeamMessageId(id: string): TeamMessageId {
  return id as TeamMessageId
}

/** Stable identifier for one structured Team debate. */
export type TeamDebateId = Branded<'TeamDebateId'>

/** Brand a generated Team-debate identity. */
export function TeamDebateId(id: string): TeamDebateId {
  return id as TeamDebateId
}

/** Durable teammate lifecycle. */
export type TeamMemberPhase = 'provisioning' | 'active' | 'failed'

/** Whole durable value written on every teammate lifecycle change. */
export interface TeamMemberSnapshot {
  readonly id: SessionId
  readonly name: string
  readonly description: string
  /** Continuable-child transport, normally `spawn` or `fork`. */
  readonly provider: string
  /** LLM adapter route used by this teammate; absence inherits the Lead route. */
  readonly llmProvider?: string
  /** Provider-owned model id; absence inherits the Lead model. */
  readonly model?: string
  /** Child-only system persona; absence uses the mounted preset persona. */
  readonly persona?: string
  readonly context: 'fresh' | 'fork'
  readonly phase: TeamMemberPhase
  readonly error?: string
}

/** Current runtime-enriched roster row. */
export interface TeamMemberView {
  readonly id: SessionId
  readonly name: string
  readonly role: 'lead' | 'teammate'
  readonly status: 'running' | 'idle' | 'inactive' | 'provisioning' | 'failed'
  readonly description?: string
  /** Continuable-child transport, present only for teammates. */
  readonly provider?: string
  readonly llmProvider?: string
  readonly context?: 'fresh' | 'fork'
  readonly model?: string
  readonly persona?: string
  readonly diagnostics: string[]
}

/** Durable task lifecycle. */
export type TeamTaskStatus = 'pending' | 'in_progress' | 'completed' | 'deleted'

/** Whole durable task snapshot; every mutation increments {@link revision}. */
export interface TeamTaskSnapshot {
  readonly id: TeamTaskId
  readonly revision: number
  readonly subject: string
  readonly description: string
  readonly status: TeamTaskStatus
  readonly ownerId?: SessionId
  readonly blockedBy: TeamTaskId[]
  readonly writeScopes: string[]
}

/** Runtime-enriched task view returned to tools and hosts. */
export interface TeamTaskView {
  readonly id: TeamTaskId
  readonly revision: number
  readonly subject: string
  readonly description: string
  readonly status: TeamTaskStatus
  readonly blockedBy: TeamTaskId[]
  readonly writeScopes: string[]
  readonly ownerName?: string
  readonly ready: boolean
  readonly writeScopeWarnings: string[]
}

/** One peer message retained until its target Session records it. */
export interface TeamMessageSnapshot {
  readonly id: TeamMessageId
  readonly senderId: SessionId
  readonly senderName: string
  readonly targetId: SessionId
  readonly delivery: 'quiet' | 'wakeup'
  readonly content: ContentBlock[]
}

/** Source retained by the target Session for durable mailbox de-duplication. */
export interface TeamMessageSource {
  readonly kind: 'team-message'
  readonly teamId: TeamId
  readonly messageId: TeamMessageId
  readonly senderId: SessionId
  readonly senderName: string
}

/** Ordered deliberation stages within one debate round. */
export type TeamDebatePhase = 'positions' | 'critique' | 'rebuttal' | 'verification' | 'synthesis'

/** Human-controlled lifecycle of one structured debate. */
export type TeamDebateStatus = 'active' | 'paused' | 'completed'

/** One compact transition retained inside the whole debate snapshot. */
export interface TeamDebateTransition {
  readonly revision: number
  readonly round: number
  readonly phase: TeamDebatePhase
  readonly status: TeamDebateStatus
  readonly actor: string
  readonly note?: string
}

/** Durable content admitted for debate evidence and contributions. */
export type TeamDebateContentBlock = TextBlock | ImageBlock | FileBlock

/** One participant's immutable contribution to an exact debate phase. */
export interface TeamDebateContribution {
  readonly sequence: number
  readonly revision: number
  readonly round: number
  readonly phase: TeamDebatePhase
  readonly author: string
  readonly content: TeamDebateContentBlock[]
  readonly createdAt: number
}

/** Whole durable debate value written on every mutation. */
export interface TeamDebateSnapshot {
  readonly id: TeamDebateId
  readonly revision: number
  readonly topic: string
  /** Topic evidence admitted before the debate starts. */
  readonly evidence: TeamDebateContentBlock[]
  readonly status: TeamDebateStatus
  readonly phase: TeamDebatePhase
  readonly round: number
  readonly maxRounds: number
  readonly participants: string[]
  readonly contributions: TeamDebateContribution[]
  readonly history: TeamDebateTransition[]
}

/** Browser-safe durable Team state projected from the Lead Session. */
export interface TeamProjection {
  readonly teamId: TeamId
  readonly members: TeamMemberSnapshot[]
  readonly tasks: TeamTaskSnapshot[]
  readonly debate: TeamDebateSnapshot | null
}

/** Input for creating one structured debate from already admitted content. */
export interface StartTeamDebateRequest {
  readonly topic: string
  readonly evidence?: readonly TeamDebateContentBlock[]
  readonly participants: readonly string[]
  readonly maxRounds?: number
}

/** Browser Remote input for creating one structured debate. */
export interface StartTeamDebateRemoteRequest {
  readonly topic: string
  readonly attachments?: readonly EncodedAttachment[]
  readonly participants: readonly string[]
  readonly maxRounds?: number
}

/** Input for one participant's contribution to the current debate phase. */
export interface ContributeTeamDebateRequest {
  readonly debateId: TeamDebateId
  readonly expectedRevision: number
  readonly content: readonly TeamDebateContentBlock[]
}

/** Browser Remote input for one human-authored debate contribution. */
export interface ContributeTeamDebateRemoteRequest {
  readonly debateId: TeamDebateId
  readonly expectedRevision: number
  readonly content: string
  readonly attachments?: readonly EncodedAttachment[]
}

/** Supported debate mutations. */
export type TeamDebateAction = 'pause' | 'resume' | 'advance' | 'complete'

/** Compare-and-set mutation of the current debate. */
export interface UpdateTeamDebateRequest {
  readonly debateId: TeamDebateId
  readonly expectedRevision: number
  readonly action: TeamDebateAction
  readonly note?: string
}

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'team-message': TeamMessageSource
  }
}

/** Team-service deployment limits. */
export interface Config {
  /** Maximum immutable teammate names retained by one Team. */
  readonly maxMembers?: number
  /** Continuable-child transport used by fresh teammates. */
  readonly freshProvider?: string
  /** Continuable-child transport used by completed-prefix fork teammates. */
  readonly forkProvider?: string
  /** Maximum non-deleted tasks retained by one Team. */
  readonly maxTasks?: number
  /** Maximum rounds accepted by one structured debate. */
  readonly maxDebateRounds?: number
  /** Maximum queued-minus-delivered messages for one target member. */
  readonly maxPendingMessagesPerMember?: number
  /** Maximum UTF-8 bytes in one complete sender-framed delivery. */
  readonly maxMessageBytes?: number
  /** Maximum milliseconds allowed for Team-owned runtime disposal. */
  readonly disposalTimeoutMs?: number
}

/** Input for creating one durable teammate. */
export interface SpawnTeammateRequest {
  readonly name: string
  readonly description: string
  readonly prompt: ContentBlock[]
  readonly context: 'fresh' | 'fork'
  /** Continuable-child transport, normally `spawn` or `fork`. */
  readonly provider: string
  readonly llmProvider?: string
  readonly model?: string
  readonly persona?: string
  readonly signal: AbortSignal
}

/** Browser Remote input for creating one teammate. */
export interface SpawnTeamMemberRemoteRequest {
  readonly name: string
  readonly description: string
  readonly prompt: string
  readonly attachments?: readonly EncodedAttachment[]
  readonly context: 'fresh' | 'fork'
  readonly llmProvider?: string
  readonly model?: string
  readonly persona?: string
}

/** Browser Remote input for one durable guidance message. */
export interface GuideTeamMemberRemoteRequest {
  readonly target: string
  readonly content: string
  readonly attachments?: readonly EncodedAttachment[]
  readonly delivery: 'quiet' | 'wakeup'
}

/** Result after one teammate reaches a durable active or failed edge. */
export interface SpawnTeammateResult {
  readonly member: TeamMemberView
}

/** Input for one durable peer message. */
export interface SendTeamMessageRequest {
  readonly target: string
  readonly content: ContentBlock[]
  readonly delivery: 'quiet' | 'wakeup'
  readonly signal: AbortSignal
}

/** Result after a peer message enters the durable mailbox. */
export interface SendTeamMessageResult {
  readonly messageId: TeamMessageId
  readonly status: 'accepted' | 'queued'
}

/** Input for creating one shared task. */
export interface CreateTeamTaskRequest {
  readonly subject: string
  readonly description: string
  readonly blockedBy?: readonly TeamTaskId[]
  readonly writeScopes?: readonly string[]
}

/** Supported task mutation actions. */
export type TeamTaskAction =
  | 'claim'
  | 'release'
  | 'edit'
  | 'set_dependencies'
  | 'complete'
  | 'reopen'
  | 'reassign'
  | 'delete'

/** Compare-and-set mutation of one shared task. */
export interface UpdateTeamTaskRequest {
  readonly taskId: TeamTaskId
  readonly expectedRevision: number
  readonly action: TeamTaskAction
  readonly subject?: string
  readonly description?: string
  readonly blockedBy?: readonly TeamTaskId[]
  readonly writeScopes?: readonly string[]
  readonly owner?: string
}

/** Result of waiting for Team activity. */
export interface TeamWaitResult {
  readonly timedOut: boolean
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap {
    agentTeam: TeamProjection | null
  }
  interface SessionProjectionMap {
    agentTeam: TeamProjection | null
  }
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /** Whole teammate lifecycle value, stored only in the Team Lead Session. */
    'team/member': { version: 1; teamId: TeamId; member: TeamMemberSnapshot }
    /** Whole shared-task value, stored only in the Team Lead Session. */
    'team/task': { version: 1; teamId: TeamId; task: TeamTaskSnapshot }
    /** Whole structured-debate value, stored only in the Team Lead Session. */
    'team/debate': { version: 1; teamId: TeamId; debate: TeamDebateSnapshot }
    /** Durable mailbox enqueue, stored before delivery is attempted. */
    'team/message/queued': { version: 1; teamId: TeamId; message: TeamMessageSnapshot }
    /** Durable acknowledgement that the target Session recorded the message. */
    'team/message/delivered': {
      version: 1
      teamId: TeamId
      messageId: TeamMessageId
      targetId: SessionId
    }
  }
}
