/**
 * Model-facing `jev_decide` tool over the TypeSafe AI System One API. The tool
 * owns its schema, validation, and presentation; the API key never rides
 * config or logs — it is read from `TYPESAFE_API_KEY` at execution time.
 * @module @deepseek-ai/dsh-tool-jev
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'tool-jev'

/** Services required by the jev tool. */
export const inject = ['tools']

/** Default cooperative tool-call timeout budget (ms) for jev_decide. */
export const DEFAULT_JEV_TOOL_TIMEOUT_MS = 15_000

/** Default TypeSafe AI endpoint for one System One request. */
export const DEFAULT_JEV_API_URL = 'https://api.typesafe.ai/v1/systemone'

/** Default System One model id. */
export const DEFAULT_JEV_MODEL = 'jev-latest'

/** Plugin config: endpoint, model, and per-call budget. */
export interface Config {
  /** Register the tool. Defaults to true. */
  enabled?: boolean
  /** TypeSafe AI System One endpoint. Defaults to the public API. */
  apiUrl?: string
  /** System One model id. Defaults to jev-latest. */
  model?: string
  /** Cooperative timeout budget (ms) for one jev_decide call. Defaults to 15000. */
  timeoutMs?: number
}

export const Config: z<Config> = z.object({
  enabled: z.boolean().default(true),
  apiUrl: z.string().default(DEFAULT_JEV_API_URL),
  model: z.string().default(DEFAULT_JEV_MODEL),
  timeoutMs: z.number().default(DEFAULT_JEV_TOOL_TIMEOUT_MS),
})

/** One question evaluated against the state: a Choice, Score, or Noul primitive. */
export interface JevQuestion {
  readonly name: string
  readonly type: 'choice' | 'score' | 'noul'
  readonly instructions: string
  /** choice: named options; score: rubric array from weakest to strongest. */
  readonly criteria?: unknown
}

/** Validated jev_decide input after schema and manual validation. */
export interface JevRequest {
  readonly state: string
  readonly model: string
  readonly questions: Readonly<Record<string, JevQuestion>>
}

/**
 * Validate value constraints the schema DSL cannot express: non-blank state
 * and question fields, unique question names, and criteria per primitive.
 * @param args - the schema-validated jev_decide arguments.
 * @returns the parsed request keyed by question name.
 */
export function parseJevArgs(args: Record<string, unknown>): JevRequest {
  const state = typeof args.state === 'string' ? args.state.trim() : ''
  if (state.length === 0) throw new Error('jev_decide: state must be a non-blank string')
  const list = args.questions
  if (!Array.isArray(list) || list.length === 0) {
    throw new Error('jev_decide: questions must be a non-empty array')
  }
  const questions: Record<string, JevQuestion> = {}
  for (const raw of list) {
    if (typeof raw !== 'object' || raw === null) throw new Error('jev_decide: every question must be an object')
    const q = raw as Record<string, unknown>
    const qName = typeof q.name === 'string' ? q.name.trim() : ''
    if (qName.length === 0) throw new Error('jev_decide: every question requires a non-blank name')
    if (qName in questions) throw new Error(`jev_decide: question name "${qName}" is reused`)
    const type = q.type
    if (type !== 'choice' && type !== 'score' && type !== 'noul') {
      throw new Error(`jev_decide: question "${qName}" type must be choice, score, or noul`)
    }
    const instructions = typeof q.instructions === 'string' ? q.instructions.trim() : ''
    if (instructions.length === 0) throw new Error(`jev_decide: question "${qName}" instructions must be non-blank`)
    if (type === 'choice' && (typeof q.criteria !== 'object' || q.criteria === null || Object.keys(q.criteria as object).length === 0)) {
      throw new Error(`jev_decide: question "${qName}" (choice) requires a non-empty criteria object of named options`)
    }
    if (type === 'score' && (!Array.isArray(q.criteria) || q.criteria.length === 0)) {
      throw new Error(`jev_decide: question "${qName}" (score) requires a non-empty criteria rubric array`)
    }
    questions[qName] = { name: qName, type, instructions, ...(q.criteria === undefined ? {} : { criteria: q.criteria }) }
  }
  return {
    state,
    model: typeof args.model === 'string' && args.model.trim().length > 0 ? args.model.trim() : DEFAULT_JEV_MODEL,
    questions,
  }
}

/**
 * Render one jev_decide answer set as the model-facing text.
 * @param value - the structured tool output to serialize.
 * @returns a JSON-fenced text representation of the output.
 */
export function formatJevOutput(value: unknown): string {
  return '```json\n' + JSON.stringify(value, null, 2) + '\n```'
}

/**
 * Register the `jev_decide` tool.
 * @param ctx - context carrying the tools service.
 * @param config - plugin config; schemastery has applied the defaults.
 */
export function apply(ctx: Context, config: Config): void {
  if (!config.enabled) return
  const timeoutMs = config.timeoutMs ?? DEFAULT_JEV_TOOL_TIMEOUT_MS
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1) {
    throw new Error('tool-jev: timeoutMs must be a positive integer')
  }
  const apiUrl = config.apiUrl ?? DEFAULT_JEV_API_URL
  const defaultModel = config.model?.trim() || DEFAULT_JEV_MODEL

  ctx.tools.register(defineTool({
    name: 'jev_decide',
    description: 'Evaluate typed questions (choice / score / noul) about a state through the TypeSafe (Jev) System One API and return structured answers with probabilities and calibrated confidence. Each question must be one well-scoped judgment; list several questions in one call to have them evaluated in parallel.',
    parameters: {
      state: { type: 'string', required: true, description: 'The text or JSON state that every question is evaluated against.' },
      model: { type: 'string', description: `System One model id. Defaults to ${defaultModel}.` },
      questions: {
        type: 'array',
        required: true,
        description: 'Questions to evaluate in parallel; each must be one well-scoped judgment.',
        items: {
          type: 'object',
          additionalProperties: true,
          properties: {
            name: { type: 'string', description: 'Answer key for this question; unique in the list.' },
            type: { type: 'string', enum: ['choice', 'score', 'noul'], description: 'Question primitive.' },
            instructions: { type: 'string', description: 'One well-scoped question about the state.' },
            criteria: { type: 'json', description: 'choice: named options object. score: rubric array from weakest to strongest. Absent for noul.' },
          },
        },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          model: { type: 'string', required: true },
          answersJson: { type: 'string', required: true },
          usage: { type: 'json', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: formatJevOutput(value) }],
      presentationMeta: () => ({ kind: 'generic' as const }),
    },
    timeoutMs,
    // API reads do not mutate parent-agent state.
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const model = typeof args.model === 'string' && args.model.trim().length > 0 ? args.model : defaultModel
      const request = parseJevArgs({ ...args, model })
      const apiKey = process.env.TYPESAFE_API_KEY
      if (apiKey === undefined || apiKey.length === 0) {
        throw new Error('jev_decide: TYPESAFE_API_KEY is not set in the harness environment')
      }
      const response = await fetch(apiUrl, {
        method: 'POST',
        redirect: 'error',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          state: request.state,
          model: request.model,
          questions: request.questions,
        }),
        signal: exec.signal,
      })
      if (!response.ok) {
        const text = await response.text()
        throw new Error(`jev_decide: TypeSafe API ${String(response.status)}: ${text.slice(0, 400)}`)
      }
      const value = await response.json() as Record<string, unknown>
      return {
        model: typeof value.model === 'string' ? value.model : '',
        answersJson: JSON.stringify(value.answers ?? {}),
        usage: value.usage as { input_tokens: number; output_tokens: number },
      }
    },
  }))
}
