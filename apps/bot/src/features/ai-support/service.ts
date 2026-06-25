/**
 * AiSupportService: the brain of the ai-support feature.
 *
 * Wraps the @nd/ai agentic loop with the bot's live data tools, per user
 * conversation memory, and RAG. Both the /ask command and the AI channel
 * listener call `ask()`; it loads recent memory, runs the agent with the guild
 * scoped tools, persists the new turn, broadcasts the answer to the dashboard,
 * and returns a concise reply.
 *
 * The service is registered on the Sapphire container in `index.ts` so commands
 * and listeners share one instance.
 */
import { container } from '@sapphire/framework'
import type { Client } from 'discord.js'
import { recall, remember, runAgent } from '@nd/ai'
import { getDb, schema } from '@nd/db'
import { buildTools } from './tools.ts'

/** Maximum characters of an answer; Discord messages cap at 2000 but we stay tight. */
const MAX_ANSWER_LENGTH = 1800
/** How many prior turns to feed the agent for continuity. */
const MEMORY_TURNS = 12
/** Default per channel toggle when settings do not yet carry ai channel ids. */
const DEFAULT_AI_CHANNEL_IDS: string[] = []

const SYSTEM_PROMPT = [
  'You are the support assistant for the Nightz Development Discord server.',
  'You help members with server rules, FAQs, FiveM and Lua scripting, and the store catalog.',
  'You can look up live member data (warnings, mod cases, economy balance, level) and search the',
  'knowledge base. Always prefer calling a tool to get real data over guessing.',
  'Answer concisely and directly. Keep replies under a few short paragraphs.',
  'Do not use emojis. Do not use em dashes or en dashes. Write plainly.',
  'If you do not have enough information after using your tools, say so honestly and suggest opening a ticket.',
].join(' ')

export interface AskInput {
  guildId: string
  channelId: string
  userId: string
  /** Display name for nicer logging and dashboard context. */
  authorName: string
  question: string
}

export interface AskOutput {
  answer: string
  provider: string
  model: string
  iterations: number
}

export class AiSupportService {
  constructor(private readonly client: Client) {}

  /**
   * Whether a channel is configured as an AI support channel. Reads the guild
   * settings module slice; the channel id list is not yet a typed settings
   * field, so we look for a best effort `channelIds` array and fall back to a
   * local default. Listed as a needed settings field in the result.
   */
  async isAiChannel(guildId: string, channelId: string): Promise<boolean> {
    const settings = await container.config.getSettings(guildId)
    const mod = settings.modules.aiSupport
    if (!mod.enabled) return false
    const ids = readChannelIds(mod) ?? DEFAULT_AI_CHANNEL_IDS
    return ids.includes(channelId)
  }

  /** Whether the ai-support module is enabled for a guild at all. */
  async isEnabled(guildId: string): Promise<boolean> {
    const settings = await container.config.getSettings(guildId)
    return settings.modules.aiSupport.enabled
  }

  /**
   * Answer a question. Runs the agent with live tools and memory, persists the
   * exchange, and broadcasts to the dashboard. Throws only on a hard provider
   * failure; callers should present a friendly fallback.
   */
  async ask(input: AskInput): Promise<AskOutput> {
    const { guildId, channelId, userId, authorName, question } = input
    const trimmed = question.trim()

    const history = await recall(userId, MEMORY_TURNS)
    const tools = buildTools(this.client, guildId)

    const result = await runAgent({
      system: SYSTEM_PROMPT,
      history: history.map((h) => ({ role: h.role, content: h.content })),
      prompt: trimmed,
      intent: 'support',
      tools,
      maxIterations: 6,
    })

    const answer = sanitize(result.text)

    await remember(userId, 'user', trimmed, { guildId })
    await remember(userId, 'model', answer, { guildId })

    void this.recordAnalytics(guildId, userId, channelId)

    container.api?.hub.broadcast('ai', 'answered', {
      guildId,
      channelId,
      userId,
      authorName,
      question: trimmed,
      answer,
      provider: result.provider,
      model: result.model,
      iterations: result.iterations,
      at: Date.now(),
    })

    return {
      answer,
      provider: result.provider,
      model: result.model,
      iterations: result.iterations,
    }
  }

  private async recordAnalytics(guildId: string, userId: string, channelId: string): Promise<void> {
    try {
      await getDb()
        .insert(schema.analyticsEvents)
        .values({ guildId, type: 'ai', userId, channelId, meta: { feature: 'ai-support' } })
    } catch (err) {
      container.logger.warn({ err }, 'ai-support: failed to record analytics event')
    }
  }
}

/** Read a best effort channel id list from the module toggle blob. */
function readChannelIds(mod: unknown): string[] | null {
  if (mod && typeof mod === 'object' && 'channelIds' in mod) {
    const value = (mod as { channelIds?: unknown }).channelIds
    if (Array.isArray(value) && value.every((v) => typeof v === 'string')) return value
  }
  return null
}

/** Trim, collapse, and cap an answer; never return an empty string. */
export function sanitize(text: string): string {
  const cleaned = text.trim().replace(/\n{3,}/g, '\n\n')
  if (!cleaned) return 'I could not find an answer for that. Consider opening a ticket for help.'
  if (cleaned.length <= MAX_ANSWER_LENGTH) return cleaned
  return `${cleaned.slice(0, MAX_ANSWER_LENGTH - 3)}...`
}
