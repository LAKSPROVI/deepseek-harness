/** Browser-safe projection of durable Agent Teams state. */

import { z } from 'zod'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { TeamProjection } from './types.ts'

const memberSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  provider: z.string(),
  llmProvider: z.string().optional(),
  model: z.string().optional(),
  persona: z.string().optional(),
  context: z.enum(['fresh', 'fork']),
  phase: z.enum(['provisioning', 'active', 'failed']),
  error: z.string().optional(),
}).strict()

const taskSchema = z.object({
  id: z.string(),
  revision: z.number().int().positive(),
  subject: z.string(),
  description: z.string(),
  status: z.enum(['pending', 'in_progress', 'completed', 'deleted']),
  ownerId: z.string().optional(),
  blockedBy: z.array(z.string()),
  writeScopes: z.array(z.string()),
}).strict()

const debatePhaseSchema = z.enum(['positions', 'critique', 'rebuttal', 'verification', 'synthesis'])
const debateStatusSchema = z.enum(['active', 'paused', 'completed'])
const attachmentIdSchema = z.string().min(1)
const contentBlockSchema = z.union([
  z.object({ type: z.literal('text'), text: z.string() }).strict(),
  z.object({
    type: z.literal('image'),
    attachment: z.object({
      attachmentId: attachmentIdSchema,
      mediaType: z.enum(['image/png', 'image/jpeg', 'image/webp', 'image/gif']),
      bytes: z.number().int().nonnegative(), width: z.number().int().positive(), height: z.number().int().positive(),
      name: z.string().optional(),
      originalDimensions: z.object({ width: z.number().int().positive(), height: z.number().int().positive() }).strict().optional(),
    }).strict(),
  }).strict(),
  z.object({
    type: z.literal('file'),
    attachment: z.object({
      attachmentId: attachmentIdSchema, mediaType: z.string(), bytes: z.number().int().nonnegative(), name: z.string().optional(),
    }).strict(),
  }).strict(),
])
const debateTransitionSchema = z.object({
  revision: z.number().int().positive(),
  round: z.number().int().positive(),
  phase: debatePhaseSchema,
  status: debateStatusSchema,
  actor: z.string(),
  note: z.string().optional(),
}).strict()
const debateContributionSchema = z.object({
  sequence: z.number().int().positive(),
  revision: z.number().int().positive(),
  round: z.number().int().positive(),
  phase: debatePhaseSchema,
  author: z.string(),
  content: z.array(contentBlockSchema),
  createdAt: z.number().int().nonnegative(),
}).strict()
const debateSchema = z.object({
  id: z.string(),
  revision: z.number().int().positive(),
  topic: z.string(),
  evidence: z.array(contentBlockSchema),
  status: debateStatusSchema,
  phase: debatePhaseSchema,
  round: z.number().int().positive(),
  maxRounds: z.number().int().positive(),
  participants: z.array(z.string()),
  contributions: z.array(debateContributionSchema),
  history: z.array(debateTransitionSchema),
}).strict()

/** Persisted and wire validation for the whole Team projection. */
export const teamProjectionSchema = z.object({
  teamId: z.string(),
  members: z.array(memberSchema),
  tasks: z.array(taskSchema),
  debate: debateSchema.nullable(),
}).strict() as unknown as z.ZodType<TeamProjection>

function empty(teamId: TeamProjection['teamId']): TeamProjection {
  return { teamId, members: [], tasks: [], debate: null }
}

/** Pure whole-value projection transition. */
export function applyTeamProjection(
  state: TeamProjection | null,
  event: SessionEvent,
): TeamProjection | null {
  if (event.type !== 'team/member' && event.type !== 'team/task' && event.type !== 'team/debate') return state
  const teamId = event.data.teamId
  const current = state?.teamId === teamId ? state : empty(teamId)
  switch (event.type) {
    case 'team/member': {
      const members = current.members.filter(member => member.id !== event.data.member.id)
      return { ...current, members: [...members, event.data.member] }
    }
    case 'team/task': {
      const tasks = current.tasks.filter(task => task.id !== event.data.task.id)
      return { ...current, tasks: [...tasks, event.data.task] }
    }
    case 'team/debate':
      return { ...current, debate: event.data.debate }
  }
}
