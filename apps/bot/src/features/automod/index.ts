/**
 * Automod feature wiring.
 *
 * `setupAutomod()` is the single entry point the central registry calls during
 * integration. It:
 *   - registers the AutomodService on the Sapphire container,
 *   - starts the in-memory tracker pruning loop,
 *   - registers read-only dashboard API routes (status + recent cases).
 *
 * Listeners (src/listeners/automod) and the /automod command
 * (src/commands/automod) auto-load by directory, so they are not wired here.
 */
import { container } from '@sapphire/framework'
import { and, desc, eq } from 'drizzle-orm'
import { getDb, modCases } from '@nd/db'
import { json, problem } from '../../api/server.ts'
import { resolveAutomodSettings } from './config.ts'
import { AutomodService } from './service.ts'

declare module '@sapphire/pieces' {
  interface Container {
    /** Automatic moderation service: filters, escalation, raid + quarantine. */
    automod: AutomodService
  }
}

let started = false

export function setupAutomod(): void {
  if (started) return
  started = true

  const service = new AutomodService()
  container.automod = service
  service.start()

  registerRoutes()
}

function registerRoutes(): void {
  const router = container.api?.router
  if (!router) return

  // Effective automod settings for a guild (admin only).
  router.get(
    '/api/guilds/:guildId/automod',
    async ({ params }) => {
      const guildId = params.guildId
      if (!guildId) return problem(400, 'missing guildId')
      const settings = await resolveAutomodSettings(guildId)
      return json({ settings })
    },
    { requireAdmin: true },
  )

  // Recent automod-authored mod cases for a guild (admin only).
  router.get(
    '/api/guilds/:guildId/automod/cases',
    async ({ params, url }) => {
      const guildId = params.guildId
      if (!guildId) return problem(400, 'missing guildId')
      const limit = Math.min(Math.max(Number(url.searchParams.get('limit') ?? 25), 1), 100)
      const botId = container.client.user?.id ?? 'automod'
      const rows = await getDb()
        .select()
        .from(modCases)
        .where(and(eq(modCases.guildId, guildId), eq(modCases.moderatorId, botId)))
        .orderBy(desc(modCases.createdAt))
        .limit(limit)
      return json({ cases: rows })
    },
    { requireAdmin: true },
  )
}
