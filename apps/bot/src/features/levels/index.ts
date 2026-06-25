/**
 * Levels feature wiring.
 *
 * `setupLevels()` is the single entry point the central registry calls during
 * integration. It:
 *   - registers the shared LevelingService on the Sapphire container so the
 *     XP listener and every command share one instance,
 *   - registers the dashboard read APIs (leaderboard, a member's rank, the
 *     configured level roles) on the API router when it is available.
 *
 * Commands (src/commands/levels) and the XP listener (src/listeners/levels)
 * auto load by directory, so they are not referenced here.
 */
import { container } from '@sapphire/framework'
import { json, problem } from '../../api/server.ts'
import { LevelingService } from './leveling.ts'

declare module '@sapphire/pieces' {
  interface Container {
    /** Shared leveling service backed by @nd/db (levels + level_roles). */
    leveling: LevelingService
  }
}

const DASHBOARD_LIMIT = 50

export function setupLevels(): void {
  // One shared service for the listener and all commands.
  container.leveling = new LevelingService()

  const router = container.api?.router
  if (!router) {
    container.logger.warn('levels: api router unavailable, dashboard routes not registered')
    return
  }

  // Top members for a guild. Optional ?limit and ?offset query params.
  router.get('/api/guilds/:guildId/levels/leaderboard', async ({ params, url }) => {
    const guildId = params.guildId
    if (!guildId) return problem(400, 'missing guild id')
    const limit = clampInt(url.searchParams.get('limit'), DASHBOARD_LIMIT, 1, 100)
    const offset = clampInt(url.searchParams.get('offset'), 0, 0, 100_000)

    const [rows, total] = await Promise.all([
      container.leveling.leaderboard(guildId, limit, offset),
      container.leveling.memberCount(guildId),
    ])

    return json({
      total,
      limit,
      offset,
      entries: rows.map((row, i) => ({
        rank: offset + i + 1,
        userId: row.userId,
        xp: row.xp,
        level: row.level,
        messages: row.messages,
      })),
    })
  })

  // A single member's rank within a guild.
  router.get('/api/guilds/:guildId/levels/members/:userId', async ({ params }) => {
    const guildId = params.guildId
    const userId = params.userId
    if (!guildId || !userId) return problem(400, 'missing guild or user id')
    const result = await container.leveling.getRank(guildId, userId)
    if (!result) return problem(404, 'member has no level data')
    return json({ userId, ...result })
  })

  // Configured level role rewards for a guild.
  router.get('/api/guilds/:guildId/levels/roles', async ({ params }) => {
    const guildId = params.guildId
    if (!guildId) return problem(400, 'missing guild id')
    const roles = await container.leveling.listRoles(guildId)
    return json({ roles })
  })

  container.logger.info('levels: feature ready')
}

/** Parse an int query param into a clamped value, falling back to a default. */
function clampInt(raw: string | null, fallback: number, min: number, max: number): number {
  if (raw === null) return fallback
  const n = Number.parseInt(raw, 10)
  if (Number.isNaN(n)) return fallback
  return Math.min(max, Math.max(min, n))
}
