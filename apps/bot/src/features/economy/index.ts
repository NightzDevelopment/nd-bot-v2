/**
 * Economy feature wiring.
 *
 * `setupEconomy()` is called once during integration boot. It:
 *   1. registers the shared `EconomyService` on the Sapphire container so every
 *      command resolves the same instance (and the same DB connection),
 *   2. mounts the dashboard read/write API routes under `/api/guilds/:id/economy`.
 *
 * Commands live under `commands/economy/` and auto-load by directory, so they
 * are not referenced here.
 */
import { container } from '@sapphire/framework'
import { json, problem } from '../../api/server.ts'
import { EconomyService } from './service.ts'

// Augment the container so `container.economy` is typed everywhere. Declaration
// merging across feature files is safe.
declare module '@sapphire/pieces' {
  interface Container {
    /** Currency, shop, and inventory service. */
    economy: EconomyService
  }
}

export { EconomyService } from './service.ts'
export { ECONOMY_DEFAULTS } from './service.ts'

function registerRoutes(): void {
  const router = container.api?.router
  if (!router) return

  // Net-worth leaderboard for a guild.
  router.get('/api/guilds/:id/economy/leaderboard', async ({ params, url }) => {
    const guildId = params.id
    if (!guildId) return problem(400, 'missing guild id')
    const limitRaw = Number(url.searchParams.get('limit'))
    const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(100, Math.floor(limitRaw)) : 10
    const rows = await container.economy.leaderboard(guildId, limit)
    return json({ guildId, leaderboard: rows })
  })

  // A single account plus recent transactions.
  router.get('/api/guilds/:id/economy/members/:userId', async ({ params }) => {
    const guildId = params.id
    const userId = params.userId
    if (!guildId || !userId) return problem(400, 'missing id')
    const account = await container.economy.account(guildId, userId)
    const transactions = await container.economy.transactions(guildId, userId, 25)
    return json({ account, transactions })
  })

  // The shop catalog.
  router.get('/api/guilds/:id/economy/shop', async ({ params }) => {
    const guildId = params.id
    if (!guildId) return problem(400, 'missing guild id')
    const items = await container.economy.listShop(guildId)
    return json({ guildId, items })
  })

  // Admin: adjust a wallet by a signed delta (e.g. grant/deduct from dashboard).
  router.post(
    '/api/guilds/:id/economy/members/:userId/adjust',
    async ({ params, req }) => {
      const guildId = params.id
      const userId = params.userId
      if (!guildId || !userId) return problem(400, 'missing id')
      let body: unknown
      try {
        body = await req.json()
      } catch {
        return problem(400, 'invalid json body')
      }
      const { delta, reason } = (body ?? {}) as { delta?: unknown; reason?: unknown }
      if (typeof delta !== 'number' || !Number.isFinite(delta) || delta === 0) {
        return problem(400, 'delta must be a non-zero number')
      }
      const result = await container.economy.adminAdjust(
        guildId,
        userId,
        Math.round(delta),
        typeof reason === 'string' && reason.length > 0 ? reason : 'admin',
      )
      return json({ ok: true, account: result })
    },
    { requireAdmin: true },
  )
}

/** Integration entrypoint. Safe to call once after the container + API exist. */
export function setupEconomy(): void {
  if (!container.economy) {
    container.economy = new EconomyService()
  }
  registerRoutes()
}
