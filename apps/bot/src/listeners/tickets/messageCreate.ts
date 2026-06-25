/**
 * Ticket message capture.
 *
 * Persists human messages sent inside a ticket channel to `ticket_messages` so
 * the transcript on close reflects the real conversation. Cheap guard first: we
 * only hit the DB lookup when the message is a non bot guild text message, and
 * the service resolves whether the channel is actually a ticket.
 */
import { Events, Listener, container } from '@sapphire/framework'
import type { Message } from 'discord.js'

export class TicketMessageListener extends Listener<typeof Events.MessageCreate> {
  public constructor(context: Listener.LoaderContext, options: Listener.Options) {
    super(context, { ...options, event: Events.MessageCreate })
  }

  public override async run(message: Message): Promise<void> {
    if (message.author.bot) return
    if (!message.inGuild()) return
    const content = message.content.trim()
    if (!content) return

    const ticket = await container.tickets.findByChannel(message.channelId)
    if (!ticket || ticket.status === 'closed') return

    await container.tickets.recordMessage(ticket.id, message.author.id, content)
  }
}
