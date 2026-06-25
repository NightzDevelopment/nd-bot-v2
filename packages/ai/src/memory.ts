/**
 * Per-user conversation memory backed by the ai_memory table. remember()
 * appends a turn; recall() reads the most recent turns in chronological order.
 */
import { and, desc, eq } from 'drizzle-orm'
import { getDb, schema } from '@nd/db'

export type MemoryRole = 'user' | 'model'

export interface MemoryTurn {
  role: MemoryRole
  content: string
  createdAt: number
}

export interface RememberOptions {
  guildId?: string | undefined
}

/** Append one conversation turn for a user. */
export async function remember(
  userId: string,
  role: MemoryRole,
  content: string,
  opts: RememberOptions = {},
): Promise<void> {
  const db = getDb()
  await db.insert(schema.aiMemory).values({
    userId,
    role,
    content,
    guildId: opts.guildId ?? null,
  })
}

/**
 * Recall the most recent turns for a user, returned oldest-first so they can be
 * fed straight into a GenerateOptions.history array.
 */
export async function recall(userId: string, limit = 20): Promise<MemoryTurn[]> {
  const db = getDb()
  const rows = await db
    .select({
      role: schema.aiMemory.role,
      content: schema.aiMemory.content,
      createdAt: schema.aiMemory.createdAt,
    })
    .from(schema.aiMemory)
    .where(eq(schema.aiMemory.userId, userId))
    .orderBy(desc(schema.aiMemory.createdAt))
    .limit(limit)

  return rows
    .map((r) => ({
      role: r.role === 'model' ? ('model' as const) : ('user' as const),
      content: r.content,
      createdAt: r.createdAt,
    }))
    .reverse()
}

/** Recall turns scoped to a single guild for a user. */
export async function recallForGuild(
  userId: string,
  guildId: string,
  limit = 20,
): Promise<MemoryTurn[]> {
  const db = getDb()
  const rows = await db
    .select({
      role: schema.aiMemory.role,
      content: schema.aiMemory.content,
      createdAt: schema.aiMemory.createdAt,
    })
    .from(schema.aiMemory)
    .where(and(eq(schema.aiMemory.userId, userId), eq(schema.aiMemory.guildId, guildId)))
    .orderBy(desc(schema.aiMemory.createdAt))
    .limit(limit)

  return rows
    .map((r) => ({
      role: r.role === 'model' ? ('model' as const) : ('user' as const),
      content: r.content,
      createdAt: r.createdAt,
    }))
    .reverse()
}
