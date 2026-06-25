/**
 * Automation feature wiring.
 *
 * setupAutomation() is called once from the central registry during integration.
 * It:
 *   - constructs the AutomationService and registers it on the container,
 *   - registers the dashboard API routes (list rules, toggle, run-now),
 *   - starts the scheduler loop that fires `scheduled` triggers.
 *
 * Commands and listeners auto-load by directory; they reach the service through
 * `container.automation`.
 */
import { container } from '@sapphire/framework'
import { and, eq } from 'drizzle-orm'
import { automationRules, getDb } from '@nd/db'
import { json, problem } from '../../api/server.ts'
import { AutomationService } from './service.ts'

declare module '@sapphire/pieces' {
  interface Container {
    /** Rules engine: loads, caches and dispatches automation rules. */
    automation: AutomationService | undefined
  }
}

/** How often the scheduler loop wakes to check `scheduled` triggers. */
const SCHEDULER_TICK_MS = 60_000

let schedulerTimer: ReturnType<typeof setInterval> | null = null

export function setupAutomation(): void {
  const service = new AutomationService()
  container.automation = service

  registerRoutes()
  startScheduler(service)

  container.logger.info('automation feature ready')
}

/** Stop the scheduler loop. Exposed for clean shutdown / tests. */
export function teardownAutomation(): void {
  if (schedulerTimer) {
    clearInterval(schedulerTimer)
    schedulerTimer = null
  }
}

function startScheduler(service: AutomationService): void {
  if (schedulerTimer) return
  schedulerTimer = setInterval(() => {
    void service.runScheduled(Date.now()).catch((err) => {
      container.logger.warn({ err }, 'automation scheduler tick failed')
    })
  }, SCHEDULER_TICK_MS)
  // Do not keep the process alive solely for this timer.
  schedulerTimer.unref?.()
}

function registerRoutes(): void {
  const router = container.api?.router
  if (!router) return

  // List a guild's rules for the dashboard Automation section.
  router.get('/api/guilds/:guildId/automation/rules', async ({ params }) => {
    const db = getDb()
    const rows = await db
      .select()
      .from(automationRules)
      .where(eq(automationRules.guildId, params.guildId as string))
    return json({ rules: rows })
  })

  // Enable or disable a rule.
  router.post(
    '/api/guilds/:guildId/automation/rules/:id/toggle',
    async ({ params, req }) => {
      const id = Number(params.id)
      if (!Number.isInteger(id)) return problem(400, 'invalid rule id')
      const body = (await req.json().catch(() => ({}))) as { enabled?: boolean }
      const enabled = body.enabled ?? true
      const db = getDb()
      const updated = await db
        .update(automationRules)
        .set({ enabled })
        .where(and(eq(automationRules.id, id), eq(automationRules.guildId, params.guildId as string)))
        .returning({ id: automationRules.id })
      if (!updated[0]) return problem(404, 'rule not found')
      container.automation?.invalidate(params.guildId as string)
      container.api?.hub.broadcast('automation', enabled ? 'rule_enabled' : 'rule_disabled', {
        guildId: params.guildId,
        id,
      })
      return json({ ok: true, id, enabled })
    },
    { requireAdmin: true },
  )

  // Delete a rule.
  router.post(
    '/api/guilds/:guildId/automation/rules/:id/delete',
    async ({ params }) => {
      const id = Number(params.id)
      if (!Number.isInteger(id)) return problem(400, 'invalid rule id')
      const db = getDb()
      const deleted = await db
        .delete(automationRules)
        .where(and(eq(automationRules.id, id), eq(automationRules.guildId, params.guildId as string)))
        .returning({ id: automationRules.id })
      if (!deleted[0]) return problem(404, 'rule not found')
      container.automation?.invalidate(params.guildId as string)
      container.api?.hub.broadcast('automation', 'rule_deleted', { guildId: params.guildId, id })
      return json({ ok: true, id })
    },
    { requireAdmin: true },
  )
}
