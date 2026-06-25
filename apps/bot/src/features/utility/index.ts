/**
 * Utility feature wiring.
 *
 * `setupUtility()` is the single entry point the central registry calls during
 * integration. It:
 *   1. constructs the UtilityService and registers it on the Sapphire container,
 *   2. starts the restart safe reminder scheduler (resumes overdue reminders and
 *      arms the next timer),
 *   3. registers read only dashboard API routes for reminders and reaction roles.
 *
 * Commands (commands/utility) and listeners (listeners/utility) auto load by
 * directory and reach the service through `container.utility`.
 */
import { container } from '@sapphire/framework'
import { json, problem } from '../../api/server.ts'
import { UtilityService } from './service.ts'

declare module '@sapphire/pieces' {
  interface Container {
    /** Utility feature service: reminders scheduler + helpers. */
    utility: UtilityService
  }
}

export function setupUtility(): void {
  const service = new UtilityService()
  container.utility = service

  // Resume reminders: fire anything overdue, then schedule the next.
  service.start()

  registerRoutes()
  container.logger.info('utility feature ready')
}

/** Register the dashboard API surface for the utility feature. */
function registerRoutes(): void {
  const router = container.api?.router
  if (!router) return

  // List a user's pending reminders (admin scoped, read only).
  router.get(
    '/api/utility/reminders/:userId',
    async ({ params }) => {
      const userId = params.userId
      if (!userId) return problem(400, 'missing userId')
      const rows = await container.utility.listReminders(userId)
      return json({ reminders: rows })
    },
    { requireAdmin: true },
  )
}
