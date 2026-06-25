/**
 * Claude provider: wraps @anthropic-ai/sdk Messages API for plain generation.
 * Reads key + model from @nd/core env. Used for technical/code intents and as
 * the router's fallback away from Gemini.
 */
import Anthropic from '@anthropic-ai/sdk'
import { loadEnv } from '@nd/core'
import type { AIProvider, GenerateOptions, GenerateResult } from '../index.ts'

let client: Anthropic | null = null

function getClient(): Anthropic {
  if (client) return client
  const { ANTHROPIC_API_KEY } = loadEnv()
  if (!ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY is not configured')
  }
  client = new Anthropic({ apiKey: ANTHROPIC_API_KEY })
  return client
}

function claudeModel(): string {
  return loadEnv().ANTHROPIC_MODEL
}

const DEFAULT_MAX_TOKENS = 1024

function toClaudeMessages(opts: GenerateOptions): Anthropic.MessageParam[] {
  const messages: Anthropic.MessageParam[] = (opts.history ?? []).map((turn) => ({
    role: turn.role === 'model' ? ('assistant' as const) : ('user' as const),
    content: turn.content,
  }))
  messages.push({ role: 'user', content: opts.prompt })
  return messages
}

export interface ClaudeCallResult {
  text: string
  model: string
  inputTokens?: number
  outputTokens?: number
}

export async function claudeGenerateText(opts: GenerateOptions): Promise<ClaudeCallResult> {
  const model = claudeModel()
  const message = await getClient().messages.create({
    model,
    max_tokens: opts.maxTokens ?? DEFAULT_MAX_TOKENS,
    ...(opts.system ? { system: opts.system } : {}),
    messages: toClaudeMessages(opts),
  })

  const text = message.content
    .map((block) => (block.type === 'text' ? block.text : ''))
    .join('')

  return {
    text,
    model,
    inputTokens: message.usage.input_tokens,
    outputTokens: message.usage.output_tokens,
  }
}

export const claudeProvider: AIProvider = {
  name: 'claude',
  async generate(opts: GenerateOptions): Promise<GenerateResult> {
    const r = await claudeGenerateText(opts)
    return { text: r.text, provider: 'claude', model: r.model, cached: false }
  },
}
