/**
 * Agent tools for the ai-support assistant.
 *
 * Each tool is an @nd/ai AgentTool the agentic loop can call to pull LIVE data
 * from the database or retrieve knowledge documents. Tools never mutate state;
 * they are read only lookups so the assistant can answer grounded questions
 * about a member (warnings, economy, level) and the server knowledge base
 * (rules, FAQ, FiveM/Lua, store catalog).
 *
 * The `buildTools` factory binds the tools to a guild so member lookups are
 * scoped correctly. The Discord client (from the Sapphire container) is used to
 * resolve a display name from a mention or id, best effort.
 */
import { and, desc, eq } from 'drizzle-orm'
import type { Client } from 'discord.js'
import type { AgentTool } from '@nd/ai'
import { retrieve } from '@nd/ai'
import { economy, getDb, levels, modCases, modNotes, schema } from '@nd/db'

/** A relaxed args bag: Gemini passes plain JSON objects to tool execute(). */
type ToolArgs = Record<string, unknown>

function asString(value: unknown): string | null {
  if (typeof value === 'string') return value.trim() || null
  if (typeof value === 'number') return String(value)
  return null
}

/** Extract a snowflake id from a raw value that may be a mention like <@123>. */
function extractUserId(raw: unknown): string | null {
  const value = asString(raw)
  if (!value) return null
  const match = value.match(/\d{15,21}/)
  return match ? match[0] : null
}

/**
 * Resolve a user id to a readable display name without throwing. Falls back to
 * the bare id when the member or user cannot be fetched.
 */
async function resolveDisplayName(client: Client, guildId: string, userId: string): Promise<string> {
  try {
    const guild = client.guilds.cache.get(guildId) ?? (await client.guilds.fetch(guildId))
    const member = await guild.members.fetch(userId).catch(() => null)
    if (member) return member.displayName
  } catch {
    // fall through to user fetch
  }
  try {
    const user = await client.users.fetch(userId)
    return user.username
  } catch {
    return userId
  }
}

/**
 * Build the tool set bound to a guild. Pass the Sapphire container client so the
 * member lookup tool can resolve names.
 */
export function buildTools(client: Client, guildId: string): AgentTool[] {
  const memberLookup: AgentTool<ToolArgs> = {
    name: 'lookup_member',
    description:
      'Look up live moderation and account data for a server member: their open warnings and mod cases, ' +
      'recent mod notes, economy balance (wallet and bank), and current level and XP. ' +
      'Accepts a Discord user id or a mention. Use this to answer questions about a specific member.',
    parameters: {
      type: 'object',
      properties: {
        user: {
          type: 'string',
          description: 'The Discord user id or mention of the member to look up.',
        },
      },
      required: ['user'],
    },
    async execute(args) {
      const userId = extractUserId(args.user)
      if (!userId) return { error: 'No valid Discord user id or mention was provided.' }

      const db = getDb()

      const [cases, notes, balanceRows, levelRows] = await Promise.all([
        db
          .select({
            id: modCases.id,
            action: modCases.action,
            reason: modCases.reason,
            active: modCases.active,
            createdAt: modCases.createdAt,
          })
          .from(modCases)
          .where(and(eq(modCases.guildId, guildId), eq(modCases.userId, userId)))
          .orderBy(desc(modCases.createdAt))
          .limit(10),
        db
          .select({ note: modNotes.note, severity: modNotes.severity, createdAt: modNotes.createdAt })
          .from(modNotes)
          .where(and(eq(modNotes.guildId, guildId), eq(modNotes.userId, userId)))
          .orderBy(desc(modNotes.createdAt))
          .limit(5),
        db
          .select({ wallet: economy.wallet, bank: economy.bank })
          .from(economy)
          .where(and(eq(economy.guildId, guildId), eq(economy.userId, userId)))
          .limit(1),
        db
          .select({ level: levels.level, xp: levels.xp, messages: levels.messages })
          .from(levels)
          .where(and(eq(levels.guildId, guildId), eq(levels.userId, userId)))
          .limit(1),
      ])

      const balance = balanceRows[0] ?? { wallet: 0, bank: 0 }
      const level = levelRows[0] ?? { level: 0, xp: 0, messages: 0 }
      const warnings = cases.filter((c) => c.action === 'warn')
      const activeWarnings = warnings.filter((c) => c.active)
      const displayName = await resolveDisplayName(client, guildId, userId)

      return {
        userId,
        displayName,
        warnings: { total: warnings.length, active: activeWarnings.length },
        cases: cases.map((c) => ({
          id: c.id,
          action: c.action,
          reason: c.reason ?? 'No reason provided.',
          active: c.active,
          at: new Date(c.createdAt).toISOString(),
        })),
        notes: notes.map((n) => ({
          note: n.note,
          severity: n.severity,
          at: new Date(n.createdAt).toISOString(),
        })),
        economy: { wallet: balance.wallet, bank: balance.bank, total: balance.wallet + balance.bank },
        level: { level: level.level, xp: level.xp, messages: level.messages },
      }
    },
  }

  const knowledgeSearch: AgentTool<ToolArgs> = {
    name: 'search_knowledge_base',
    description:
      'Search the server knowledge base for relevant documents. The corpus covers server rules and ' +
      'policies, frequently asked questions, FiveM and Lua scripting help, and the store and product ' +
      'catalog. Use this for any factual question about the server, its rules, products, or scripting. ' +
      'Optionally restrict to one source bucket: rules, faq, fivem, store, or custom.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'The search query, in natural language.' },
        source: {
          type: 'string',
          description: 'Optional source filter: rules, faq, fivem, store, or custom.',
        },
      },
      required: ['query'],
    },
    async execute(args) {
      const query = asString(args.query)
      if (!query) return { error: 'A search query is required.' }
      const source = asString(args.source)
      const docs = await retrieve(query, 4, source ? { source } : {})
      if (docs.length === 0) {
        return { matches: [], note: 'No matching knowledge documents were found.' }
      }
      return {
        matches: docs.map((d) => ({
          title: d.title,
          source: d.source,
          content: d.content.length > 1200 ? `${d.content.slice(0, 1200)}...` : d.content,
        })),
      }
    },
  }

  const serverStats: AgentTool<ToolArgs> = {
    name: 'get_server_stats',
    description:
      'Get high level statistics about the current Discord server: its name, member count, and the ' +
      'number of knowledge base documents available. Use this for questions about the server itself.',
    parameters: { type: 'object', properties: {} },
    async execute() {
      const db = getDb()
      const guild = client.guilds.cache.get(guildId) ?? (await client.guilds.fetch(guildId).catch(() => null))
      const docs = await db.select({ source: schema.knowledgeDocs.source }).from(schema.knowledgeDocs)
      const bySource: Record<string, number> = {}
      for (const d of docs) bySource[d.source] = (bySource[d.source] ?? 0) + 1
      return {
        name: guild?.name ?? 'this server',
        memberCount: guild?.memberCount ?? null,
        knowledgeDocs: { total: docs.length, bySource },
      }
    },
  }

  return [memberLookup, knowledgeSearch, serverStats]
}
