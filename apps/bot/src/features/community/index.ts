/**
 * Community feature wiring.
 *
 * `setupCommunity()` is called once from the central registry during
 * integration. It:
 *   1. registers the CommunityService on the Sapphire container,
 *   2. registers read only dashboard API routes for polls, giveaways,
 *      suggestions, and counters,
 *   3. starts three restart safe background loops:
 *        - poll sweep      (close polls past endsAt),
 *        - giveaway sweep  (draw giveaways past endsAt, idempotent on ended),
 *        - counter refresh (rename counter channels to their templates).
 *
 * The loops are idempotent: on every boot the giveaway sweep redraws any
 * giveaway whose endsAt has already passed but is not flagged ended, so a crash
 * mid draw or downtime across an end time still resolves correctly.
 *
 * This file augments the Sapphire Container via declaration merging (safe across
 * files) so `container.community` is typed everywhere.
 */
import { container } from '@sapphire/framework'
import { createLogger } from '@nd/core'
import { CommunityService } from './service.ts'
import { json, problem } from '../../api/server.ts'

const log = createLogger('community')

/** How often to sweep for due polls and giveaways. */
const SWEEP_INTERVAL_MS = 30_000
/** How often to refresh counter channel names (slow: Discord rate limits renames hard). */
const COUNTER_INTERVAL_MS = 5 * 60_000

declare module '@sapphire/pieces' {
  interface Container {
    /** Community feature service: polls, giveaways, suggestions, counters. */
    community: CommunityService
  }
}

let timers: ReturnType<typeof setInterval>[] = []

export function setupCommunity(): void {
  const service = new CommunityService()
  container.community = service

  registerRoutes()
  startLoops()

  log.info('community feature ready')
}

/** Stop the background loops. Useful for a clean shutdown or hot reload. */
export function teardownCommunity(): void {
  for (const timer of timers) clearInterval(timer)
  timers = []
}

function registerRoutes(): void {
  const router = container.api?.router
  if (!router) {
    log.warn('api router unavailable; community routes not registered')
    return
  }

  router.get('/api/guilds/:guildId/community/polls', async ({ params }) => {
    const guildId = params.guildId
    if (!guildId) return problem(400, 'missing guildId')
    return json({ polls: await container.community.listPolls(guildId) })
  })

  router.get('/api/guilds/:guildId/community/giveaways', async ({ params }) => {
    const guildId = params.guildId
    if (!guildId) return problem(400, 'missing guildId')
    return json({ giveaways: await container.community.listGiveaways(guildId) })
  })

  router.get('/api/guilds/:guildId/community/suggestions', async ({ params }) => {
    const guildId = params.guildId
    if (!guildId) return problem(400, 'missing guildId')
    return json({ suggestions: await container.community.listSuggestions(guildId) })
  })

  router.get('/api/guilds/:guildId/community/counters', async ({ params }) => {
    const guildId = params.guildId
    if (!guildId) return problem(400, 'missing guildId')
    return json({ counters: await container.community.listCounters(guildId) })
  })

  // Admin gated: force a giveaway to end now.
  router.post(
    '/api/guilds/:guildId/community/giveaways/:id/end',
    async ({ params }) => {
      const id = params.id
      if (!id) return problem(400, 'missing id')
      const result = await container.community.endGiveaway(container.client, id)
      if (!result) return problem(404, 'giveaway not found or already ended')
      return json({ ok: true, winners: result.winners })
    },
    { requireAdmin: true },
  )
}

function startLoops(): void {
  const client = container.client

  const runSweep = (): void => {
    if (!client.isReady()) return
    void container.community.sweepDuePolls(client).catch((err: unknown) => log.error({ err }, 'poll sweep failed'))
    void container.community
      .sweepDueGiveaways(client)
      .catch((err: unknown) => log.error({ err }, 'giveaway sweep failed'))
  }

  const runCounters = (): void => {
    if (!client.isReady()) return
    void container.community
      .refreshCounters(client)
      .catch((err: unknown) => log.error({ err }, 'counter refresh failed'))
  }

  // Run once on boot so anything that expired during downtime resolves
  // immediately, then on an interval.
  runSweep()
  runCounters()

  timers.push(setInterval(runSweep, SWEEP_INTERVAL_MS))
  timers.push(setInterval(runCounters, COUNTER_INTERVAL_MS))
}

export { CommunityService } from './service.ts'
