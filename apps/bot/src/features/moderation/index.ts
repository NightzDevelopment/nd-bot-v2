/**
 * Moderation feature wiring.
 *
 * `setupModeration()` is called once from the central registry during
 * integration. It:
 *   - registers a small read-only moderation service on the Sapphire container,
 *   - registers dashboard API routes (recent cases, per-member cases + notes),
 *   - starts a background sweep that closes out expired temporary cases.
 *
 * Commands and listeners auto-load by directory, so they are not registered
 * here. This file owns everything cross-cutting.
 */
import { container } from '@sapphire/framework'
import { createLogger } from '@nd/core'
import { json, problem } from '../../api/server.ts'
import {
  addNote,
  clearWarnings,
  getCase,
  listCases,
  listNotes,
  listWarnings,
  sweepExpiredCases,
} from './service.ts'

const log = createLogger('moderation')

/** The service surface exposed on the container for other code + the API. */
export interface ModerationService {
  listCases: typeof listCases
  listWarnings: typeof listWarnings
  clearWarnings: typeof clearWarnings
  getCase: typeof getCase
  listNotes: typeof listNotes
  addNote: typeof addNote
}

declare module '@sapphire/pieces' {
  interface Container {
    /** Moderation read/write helpers shared with the dashboard API. */
    moderation: ModerationService
  }
}

/** How often the expired-case sweep runs. */
const SWEEP_INTERVAL_MS = 60_000

let sweepTimer: ReturnType<typeof setInterval> | null = null

export function setupModeration(): void {
  container.moderation = {
    listCases,
    listWarnings,
    clearWarnings,
    getCase,
    listNotes,
    addNote,
  }

  registerRoutes()
  startSweep()
  log.info('moderation feature ready')
}

function registerRoutes(): void {
  const router = container.api?.router
  if (!router) {
    log.warn('api router unavailable, skipping moderation routes')
    return
  }

  // Recent cases for a guild member.
  router.get(
    '/api/guilds/:guildId/moderation/members/:userId/cases',
    async ({ params }) => {
      const guildId = params.guildId
      const userId = params.userId
      if (!guildId || !userId) return problem(400, 'guildId and userId required')
      const cases = await listCases(guildId, userId, 100)
      return json({ cases })
    },
    { requireAdmin: true },
  )

  // Notes for a guild member.
  router.get(
    '/api/guilds/:guildId/moderation/members/:userId/notes',
    async ({ params }) => {
      const guildId = params.guildId
      const userId = params.userId
      if (!guildId || !userId) return problem(400, 'guildId and userId required')
      const notes = await listNotes(guildId, userId, 100)
      return json({ notes })
    },
    { requireAdmin: true },
  )

  // Single case lookup.
  router.get('/api/guilds/:guildId/moderation/cases/:caseId', async ({ params }) => {
    const guildId = params.guildId
    const caseId = Number(params.caseId)
    if (!guildId || !Number.isInteger(caseId)) return problem(400, 'valid guildId and caseId required')
    const record = await getCase(guildId, caseId)
    if (!record) return problem(404, 'case not found')
    return json({ case: record })
  }, { requireAdmin: true })
}

function startSweep(): void {
  if (sweepTimer) return
  sweepTimer = setInterval(() => {
    void sweepExpiredCases()
      .then((closed) => {
        if (closed > 0) log.debug({ closed }, 'closed expired moderation cases')
      })
      .catch((err: unknown) => log.error({ err }, 'expired-case sweep failed'))
  }, SWEEP_INTERVAL_MS)
  // Do not keep the process alive solely for the sweep.
  sweepTimer.unref?.()
}
