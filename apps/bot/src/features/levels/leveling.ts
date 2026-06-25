/**
 * Levels: core service and XP math.
 *
 * One LevelingService instance owns the leveling logic for the whole bot:
 *   - the level curve (xp <-> level conversions),
 *   - granting XP for a message behind a per user cooldown,
 *   - reading rank/leaderboard data,
 *   - admin mutations (set level, give/take xp, reset),
 *   - resolving which level roles a member should hold.
 *
 * It is pure data + Drizzle. Discord side effects (announcing a level up,
 * assigning roles, broadcasting to the dashboard) live in the listener and
 * commands so this stays testable and free of gateway coupling.
 */
import { and, desc, eq, gt, sql } from 'drizzle-orm'
import { getDb, levelRoles, levels } from '@nd/db'
import type { DB } from '@nd/db'

/** Default XP granted per qualifying message when settings do not override it. */
export const DEFAULT_XP_PER_MESSAGE = 15
/** Minimum gap between two XP grants for the same member, in milliseconds. */
export const XP_COOLDOWN_MS = 60_000
/** Curve constant. xp needed to reach a level scales with this base step. */
const CURVE_BASE = 100
/** Curve growth factor per level. */
const CURVE_GROWTH = 50

/**
 * Total cumulative XP required to have reached `level`.
 *
 * Uses a smooth quadratic curve: each level costs a bit more than the last.
 * Level 0 costs 0. The closed form keeps lookups O(1) for any level.
 */
export function xpForLevel(level: number): number {
  if (level <= 0) return 0
  // sum_{n=1..level} (CURVE_BASE + CURVE_GROWTH * (n - 1))
  const n = level
  return CURVE_BASE * n + CURVE_GROWTH * ((n * (n - 1)) / 2)
}

/** The level a member with `xp` total experience has reached. */
export function levelForXp(xp: number): number {
  if (xp <= 0) return 0
  let level = 0
  while (xpForLevel(level + 1) <= xp) level++
  return level
}

/** Progress within the current level: { current, needed } toward the next level. */
export function levelProgress(xp: number): {
  level: number
  current: number
  needed: number
  floor: number
  ceil: number
} {
  const level = levelForXp(xp)
  const floor = xpForLevel(level)
  const ceil = xpForLevel(level + 1)
  return { level, current: xp - floor, needed: ceil - floor, floor, ceil }
}

export interface LevelRow {
  guildId: string
  userId: string
  xp: number
  level: number
  messages: number
  lastMessageAt: number | null
}

export interface RankResult {
  xp: number
  level: number
  messages: number
  rank: number
  total: number
}

/** Outcome of granting XP for a message. */
export interface XpGrant {
  awarded: number
  xp: number
  level: number
  previousLevel: number
  leveledUp: boolean
}

/** A configured level role mapping. */
export interface LevelRoleRow {
  level: number
  roleId: string
}

export class LevelingService {
  private readonly db: DB

  constructor(db: DB = getDb()) {
    this.db = db
  }

  /** Read a single member's level row, or null if they have no XP yet. */
  async getRow(guildId: string, userId: string): Promise<LevelRow | null> {
    const rows = await this.db
      .select()
      .from(levels)
      .where(and(eq(levels.guildId, guildId), eq(levels.userId, userId)))
      .limit(1)
    return rows[0] ?? null
  }

  /**
   * Grant XP for a message if the per user cooldown has elapsed. Returns null
   * when the grant is suppressed (still on cooldown), otherwise the new state
   * and whether the member crossed a level boundary.
   */
  async grantMessageXp(
    guildId: string,
    userId: string,
    amount: number,
    now: number = Date.now(),
  ): Promise<XpGrant | null> {
    const existing = await this.getRow(guildId, userId)

    if (existing?.lastMessageAt != null && now - existing.lastMessageAt < XP_COOLDOWN_MS) {
      return null
    }

    const previousXp = existing?.xp ?? 0
    const previousLevel = existing?.level ?? levelForXp(previousXp)
    const newXp = previousXp + amount
    const newLevel = levelForXp(newXp)

    await this.db
      .insert(levels)
      .values({
        guildId,
        userId,
        xp: newXp,
        level: newLevel,
        messages: 1,
        lastMessageAt: now,
      })
      .onConflictDoUpdate({
        target: [levels.guildId, levels.userId],
        set: {
          xp: newXp,
          level: newLevel,
          messages: sql`${levels.messages} + 1`,
          lastMessageAt: now,
        },
      })

    return {
      awarded: amount,
      xp: newXp,
      level: newLevel,
      previousLevel,
      leveledUp: newLevel > previousLevel,
    }
  }

  /** Compute a member's rank (1 based) and the total ranked members. */
  async getRank(guildId: string, userId: string): Promise<RankResult | null> {
    const row = await this.getRow(guildId, userId)
    if (!row) return null

    const ahead = await this.db
      .select({ count: sql<number>`count(*)` })
      .from(levels)
      .where(and(eq(levels.guildId, guildId), gt(levels.xp, row.xp)))

    const totalRows = await this.db
      .select({ count: sql<number>`count(*)` })
      .from(levels)
      .where(eq(levels.guildId, guildId))

    const rank = (ahead[0]?.count ?? 0) + 1
    const total = totalRows[0]?.count ?? 1

    return { xp: row.xp, level: row.level, messages: row.messages, rank, total }
  }

  /** Top members for a guild ordered by XP. */
  async leaderboard(guildId: string, limit = 10, offset = 0): Promise<LevelRow[]> {
    return this.db
      .select()
      .from(levels)
      .where(eq(levels.guildId, guildId))
      .orderBy(desc(levels.xp))
      .limit(limit)
      .offset(offset)
  }

  /** Count of members with any XP in a guild. */
  async memberCount(guildId: string): Promise<number> {
    const rows = await this.db
      .select({ count: sql<number>`count(*)` })
      .from(levels)
      .where(eq(levels.guildId, guildId))
    return rows[0]?.count ?? 0
  }

  /** Set a member's level directly, normalising XP to the floor of that level. */
  async setLevel(guildId: string, userId: string, level: number): Promise<LevelRow> {
    const safeLevel = Math.max(0, Math.floor(level))
    const xp = xpForLevel(safeLevel)
    await this.db
      .insert(levels)
      .values({ guildId, userId, xp, level: safeLevel, messages: 0 })
      .onConflictDoUpdate({
        target: [levels.guildId, levels.userId],
        set: { xp, level: safeLevel },
      })
    return (await this.getRow(guildId, userId)) as LevelRow
  }

  /**
   * Add (or, with a negative amount, remove) XP. XP never drops below zero.
   * Returns the new row plus the level transition so callers can react.
   */
  async addXp(
    guildId: string,
    userId: string,
    amount: number,
  ): Promise<{ row: LevelRow; previousLevel: number; leveledUp: boolean; leveledDown: boolean }> {
    const existing = await this.getRow(guildId, userId)
    const previousXp = existing?.xp ?? 0
    const previousLevel = existing?.level ?? levelForXp(previousXp)
    const newXp = Math.max(0, previousXp + amount)
    const newLevel = levelForXp(newXp)

    await this.db
      .insert(levels)
      .values({ guildId, userId, xp: newXp, level: newLevel, messages: 0 })
      .onConflictDoUpdate({
        target: [levels.guildId, levels.userId],
        set: { xp: newXp, level: newLevel },
      })

    const row = (await this.getRow(guildId, userId)) as LevelRow
    return {
      row,
      previousLevel,
      leveledUp: newLevel > previousLevel,
      leveledDown: newLevel < previousLevel,
    }
  }

  /** Reset a single member's level state. */
  async resetMember(guildId: string, userId: string): Promise<void> {
    await this.db
      .delete(levels)
      .where(and(eq(levels.guildId, guildId), eq(levels.userId, userId)))
  }

  /** Reset every member's level state for a guild. Returns the rows removed. */
  async resetGuild(guildId: string): Promise<void> {
    await this.db.delete(levels).where(eq(levels.guildId, guildId))
  }

  // ---- Level roles --------------------------------------------------------

  /** All configured level roles for a guild, ascending by level. */
  async listRoles(guildId: string): Promise<LevelRoleRow[]> {
    const rows = await this.db
      .select({ level: levelRoles.level, roleId: levelRoles.roleId })
      .from(levelRoles)
      .where(eq(levelRoles.guildId, guildId))
      .orderBy(levelRoles.level)
    return rows
  }

  /** Map (or remap) a role to a level. One role per level. */
  async setRole(guildId: string, level: number, roleId: string): Promise<void> {
    await this.db
      .insert(levelRoles)
      .values({ guildId, level, roleId })
      .onConflictDoUpdate({
        target: [levelRoles.guildId, levelRoles.level],
        set: { roleId },
      })
  }

  /** Remove the role mapping for a level. Returns true when a row was removed. */
  async removeRole(guildId: string, level: number): Promise<boolean> {
    const before = await this.db
      .select({ level: levelRoles.level })
      .from(levelRoles)
      .where(and(eq(levelRoles.guildId, guildId), eq(levelRoles.level, level)))
      .limit(1)
    if (before.length === 0) return false
    await this.db
      .delete(levelRoles)
      .where(and(eq(levelRoles.guildId, guildId), eq(levelRoles.level, level)))
    return true
  }

  /**
   * The role ids a member should hold at `level`: every configured level role
   * whose threshold they meet. Callers decide whether to stack or keep only the
   * highest. This returns all earned roles ascending; the highest is last.
   */
  async earnedRoles(guildId: string, level: number): Promise<LevelRoleRow[]> {
    const all = await this.listRoles(guildId)
    return all.filter((r) => r.level <= level)
  }
}
