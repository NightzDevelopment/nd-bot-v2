/**
 * Tickets feature wiring.
 *
 * `setupTickets()` is called once from the central registry during integration.
 * It registers the TicketService on the Sapphire container so commands and the
 * interaction listener can reach it, and mounts the dashboard API routes for
 * listing tickets and reading transcripts. Commands and the listener auto load
 * by directory, so there is nothing else to register here.
 */
import { container } from '@sapphire/framework'
import { createLogger } from '@nd/core'
import { json, problem } from '../../api/server.ts'
import { TicketService } from './service.ts'

const log = createLogger('tickets')

declare module '@sapphire/pieces' {
  interface Container {
    /** Ticket lifecycle engine: open/claim/close, transcripts, AI triage. */
    tickets: TicketService
  }
}

/** Build the helper used by ui pieces to fetch the shared service. */
export function getTicketService(): TicketService {
  return container.tickets
}

/** Register the tickets service + dashboard API routes. Idempotent. */
export function setupTickets(): void {
  if (!container.tickets) {
    container.tickets = new TicketService()
  }

  const router = container.api?.router
  if (router) {
    // List recent tickets for a guild.
    router.get('/api/guilds/:guildId/tickets', async ({ params }) => {
      const guildId = params.guildId
      if (!guildId) return problem(400, 'missing guild id')
      const rows = await container.tickets.listForGuild(guildId)
      return json({ tickets: rows })
    })

    // Read a single ticket transcript.
    router.get('/api/tickets/:ticketId/transcript', async ({ params }) => {
      const idText = params.ticketId
      const ticketId = idText ? Number.parseInt(idText, 10) : Number.NaN
      if (!Number.isInteger(ticketId)) return problem(400, 'invalid ticket id')
      const result = await container.tickets.transcriptFor(ticketId)
      if (!result) return problem(404, 'ticket not found')
      return json(result)
    })

    log.info('tickets API routes registered')
  } else {
    log.warn('api router unavailable at setup; tickets routes skipped')
  }
}
