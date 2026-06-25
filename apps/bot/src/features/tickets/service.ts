/**
 * TicketService: the lifecycle engine behind the tickets feature.
 *
 * Owns creating the private ticket channel under the configured category,
 * persisting to `tickets` + `ticket_messages`, claim/close transitions,
 * transcript capture on close, and optional AI triage (category + priority)
 * on open. Commands and the interaction listener call into this service so the
 * rules live in one place. Every state change broadcasts on the "tickets" WS
 * topic for the live dashboard.
 */
import {
  ChannelType,
  type CategoryChannel,
  type Guild,
  type GuildMember,
  type GuildTextBasedChannel,
  OverwriteType,
  PermissionFlagsBits,
  type TextChannel,
} from 'discord.js'
import { container } from '@sapphire/framework'
import { and, desc, eq } from 'drizzle-orm'
import { getDb, tickets, ticketMessages } from '@nd/db'
import { createLogger } from '@nd/core'
import { getRouter } from '@nd/ai'
import { DEFAULT_CATEGORIES, DEFAULT_MAX_OPEN_PER_USER, PRIORITIES, type TicketPriority } from './constants.ts'

const log = createLogger('tickets')

/** A persisted ticket row. */
export type TicketRow = typeof tickets.$inferSelect

/** Outcome of an open attempt. */
export type OpenResult =
  | { ok: true; ticket: TicketRow; channel: TextChannel }
  | { ok: false; reason: 'disabled' | 'no_category' | 'limit_reached' | 'create_failed'; existingChannelId?: string }

/** Outcome of a claim attempt. */
export type ClaimResult =
  | { ok: true; ticket: TicketRow }
  | { ok: false; reason: 'not_a_ticket' | 'already_claimed' | 'closed'; claimedBy?: string }

/** Outcome of a close attempt. */
export type CloseResult =
  | { ok: true; ticket: TicketRow; transcript: string; messageCount: number }
  | { ok: false; reason: 'not_a_ticket' | 'already_closed' }

/** Suggested triage from the AI layer. */
export interface Triage {
  category: string
  priority: TicketPriority
  summary: string
}

const db = getDb()

export class TicketService {
  /** Broadcast a tickets event to the dashboard, guarding the optional API. */
  private broadcast(event: string, data: unknown): void {
    container.api?.hub.broadcast('tickets', event, data)
  }

  /** Find an open (or claimed) ticket for a member, if any. */
  async findOpenForUser(guildId: string, userId: string): Promise<TicketRow | null> {
    const rows = await db
      .select()
      .from(tickets)
      .where(and(eq(tickets.guildId, guildId), eq(tickets.userId, userId)))
      .orderBy(desc(tickets.id))
    return rows.find((r) => r.status !== 'closed') ?? null
  }

  /** Resolve the ticket row tied to a given channel id, if any. */
  async findByChannel(channelId: string): Promise<TicketRow | null> {
    const rows = await db.select().from(tickets).where(eq(tickets.channelId, channelId)).limit(1)
    return rows[0] ?? null
  }

  /** Count how many tickets a member currently has open. */
  private async openCount(guildId: string, userId: string): Promise<number> {
    const rows = await db
      .select({ status: tickets.status })
      .from(tickets)
      .where(and(eq(tickets.guildId, guildId), eq(tickets.userId, userId)))
    return rows.filter((r) => r.status !== 'closed').length
  }

  /**
   * Open a ticket: enforce the per user limit, create a locked down channel under
   * the configured category, persist the row, seed the first message, and post a
   * control panel. AI triage runs best effort and never blocks the open.
   */
  async open(
    guild: Guild,
    member: GuildMember,
    options: { category?: string | undefined; subject?: string | undefined } = {},
  ): Promise<OpenResult> {
    const settings = await container.config.getSettings(guild.id)
    if (!settings.modules.tickets.enabled) return { ok: false, reason: 'disabled' }

    const categoryId = settings.channels.ticketCategoryId
    if (!categoryId) return { ok: false, reason: 'no_category' }

    const existing = await this.findOpenForUser(guild.id, member.id)
    const maxOpen = DEFAULT_MAX_OPEN_PER_USER
    if (existing && (await this.openCount(guild.id, member.id)) >= maxOpen) {
      return { ok: false, reason: 'limit_reached', existingChannelId: existing.channelId }
    }

    const parent = guild.channels.cache.get(categoryId)
    if (!parent || parent.type !== ChannelType.GuildCategory) {
      return { ok: false, reason: 'no_category' }
    }

    const staffRoleIds = [...settings.roles.modIds, ...settings.roles.adminIds]
    const channel = await this.createChannel(guild, parent, member, staffRoleIds).catch((err) => {
      log.error({ err, guildId: guild.id, userId: member.id }, 'failed to create ticket channel')
      return null
    })
    if (!channel) return { ok: false, reason: 'create_failed' }

    const subject = options.subject?.slice(0, 200) ?? null
    const category = options.category ?? null

    const inserted = await db
      .insert(tickets)
      .values({
        guildId: guild.id,
        channelId: channel.id,
        userId: member.id,
        category,
        subject,
        status: 'open',
      })
      .returning()
    const ticket = inserted[0]
    if (!ticket) {
      await channel.delete('ticket persistence failed').catch(() => undefined)
      return { ok: false, reason: 'create_failed' }
    }

    if (subject) {
      await this.recordMessage(ticket.id, member.id, subject)
    }

    this.broadcast('opened', {
      id: ticket.id,
      guildId: guild.id,
      channelId: channel.id,
      userId: member.id,
      category,
      subject,
      status: 'open',
      createdAt: ticket.createdAt,
    })

    return { ok: true, ticket, channel }
  }

  /** Create the private text channel with per member + staff overwrites. */
  private async createChannel(
    guild: Guild,
    parent: CategoryChannel,
    member: GuildMember,
    staffRoleIds: string[],
  ): Promise<TextChannel> {
    const safeName = member.user.username.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 24) || 'member'
    const overwrites = [
      { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel], type: OverwriteType.Role },
      {
        id: member.id,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ReadMessageHistory,
          PermissionFlagsBits.AttachFiles,
        ],
        type: OverwriteType.Member,
      },
      ...staffRoleIds.map((id) => ({
        id,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ReadMessageHistory,
          PermissionFlagsBits.ManageMessages,
        ],
        type: OverwriteType.Role as const,
      })),
    ]

    return guild.channels.create({
      name: `ticket-${safeName}`,
      type: ChannelType.GuildText,
      parent: parent.id,
      permissionOverwrites: overwrites,
      topic: `Ticket for ${member.user.tag} (${member.id})`,
    })
  }

  /** Claim a ticket for a staff member. */
  async claim(channelId: string, staffId: string): Promise<ClaimResult> {
    const ticket = await this.findByChannel(channelId)
    if (!ticket) return { ok: false, reason: 'not_a_ticket' }
    if (ticket.status === 'closed') return { ok: false, reason: 'closed' }
    if (ticket.claimedBy && ticket.claimedBy !== staffId) {
      return { ok: false, reason: 'already_claimed', claimedBy: ticket.claimedBy }
    }

    const updated = await db
      .update(tickets)
      .set({ status: 'claimed', claimedBy: staffId })
      .where(eq(tickets.id, ticket.id))
      .returning()
    const next = updated[0] ?? ticket
    this.broadcast('claimed', { id: ticket.id, guildId: ticket.guildId, channelId, claimedBy: staffId })
    return { ok: true, ticket: next }
  }

  /** Release a claim. Returns the ticket back to the open state. */
  async unclaim(channelId: string): Promise<ClaimResult> {
    const ticket = await this.findByChannel(channelId)
    if (!ticket) return { ok: false, reason: 'not_a_ticket' }
    if (ticket.status === 'closed') return { ok: false, reason: 'closed' }

    const updated = await db
      .update(tickets)
      .set({ status: 'open', claimedBy: null })
      .where(eq(tickets.id, ticket.id))
      .returning()
    const next = updated[0] ?? ticket
    this.broadcast('unclaimed', { id: ticket.id, guildId: ticket.guildId, channelId })
    return { ok: true, ticket: next }
  }

  /**
   * Close a ticket: capture a transcript from the persisted messages (topped up
   * with the live channel history), mark the row closed, and broadcast. The
   * caller deletes or archives the channel after posting the summary.
   */
  async close(channel: GuildTextBasedChannel, closedById: string): Promise<CloseResult> {
    const ticket = await this.findByChannel(channel.id)
    if (!ticket) return { ok: false, reason: 'not_a_ticket' }
    if (ticket.status === 'closed') return { ok: false, reason: 'already_closed' }

    await this.captureChannelHistory(ticket.id, channel)
    const stored = await db
      .select()
      .from(ticketMessages)
      .where(eq(ticketMessages.ticketId, ticket.id))
      .orderBy(ticketMessages.id)

    const transcript = this.renderTranscript(ticket, stored)
    const now = Date.now()
    const updated = await db
      .update(tickets)
      .set({ status: 'closed', closedBy: closedById, closedAt: now })
      .where(eq(tickets.id, ticket.id))
      .returning()
    const next = updated[0] ?? { ...ticket, status: 'closed', closedBy: closedById, closedAt: now }

    this.broadcast('closed', {
      id: ticket.id,
      guildId: ticket.guildId,
      channelId: channel.id,
      closedBy: closedById,
      closedAt: now,
      messageCount: stored.length,
    })

    return { ok: true, ticket: next, transcript, messageCount: stored.length }
  }

  /** Persist a single ticket message. */
  async recordMessage(ticketId: number, authorId: string, content: string): Promise<void> {
    const trimmed = content.trim()
    if (!trimmed) return
    await db.insert(ticketMessages).values({ ticketId, authorId, content: trimmed.slice(0, 2000) })
  }

  /**
   * Top up persisted messages with anything from the live channel that was not
   * captured through the message listener (e.g. messages sent before the bot
   * restarted). Best effort and deduplicated by content + author + minute.
   */
  private async captureChannelHistory(ticketId: number, channel: GuildTextBasedChannel): Promise<void> {
    try {
      const existing = await db
        .select({ authorId: ticketMessages.authorId, content: ticketMessages.content })
        .from(ticketMessages)
        .where(eq(ticketMessages.ticketId, ticketId))
      const seen = new Set(existing.map((m) => `${m.authorId}:${m.content}`))

      const fetched = await channel.messages.fetch({ limit: 100 })
      const ordered = [...fetched.values()].reverse()
      for (const msg of ordered) {
        if (msg.author.bot) continue
        const content = msg.content.trim()
        if (!content) continue
        const key = `${msg.author.id}:${content.slice(0, 2000)}`
        if (seen.has(key)) continue
        seen.add(key)
        await this.recordMessage(ticketId, msg.author.id, content)
      }
    } catch (err) {
      log.warn({ err, ticketId }, 'could not top up ticket history from channel')
    }
  }

  /** Render a plain text transcript for the summary embed / archive. */
  private renderTranscript(ticket: TicketRow, messages: { authorId: string; content: string; createdAt: number }[]): string {
    const header = [
      `Ticket #${ticket.id}`,
      `Opened by: ${ticket.userId}`,
      ticket.subject ? `Subject: ${ticket.subject}` : null,
      ticket.category ? `Category: ${ticket.category}` : null,
      ticket.priority ? `Priority: ${ticket.priority}` : null,
      `Opened at: ${new Date(ticket.createdAt).toISOString()}`,
    ]
      .filter(Boolean)
      .join('\n')

    const body = messages
      .map((m) => `[${new Date(m.createdAt).toISOString()}] ${m.authorId}: ${m.content}`)
      .join('\n')

    return `${header}\n\n${body || 'No messages were recorded.'}`
  }

  /**
   * Best effort AI triage. Asks the router for a category + priority + one line
   * summary as JSON. Failures (no API key, parse error) return null so the open
   * flow is never blocked.
   */
  async triage(subject: string): Promise<Triage | null> {
    const categories = DEFAULT_CATEGORIES.map((c) => c.value).join(', ')
    const prompt = [
      'Classify this Discord support ticket. Respond with ONLY compact JSON, no prose.',
      `Shape: {"category": one of [${categories}], "priority": one of [${PRIORITIES.join(', ')}], "summary": short one sentence}.`,
      `Ticket: ${subject.slice(0, 500)}`,
    ].join('\n')

    try {
      const result = await getRouter().generate({ prompt, intent: 'triage', maxTokens: 200 })
      const parsed = this.parseTriage(result.text)
      if (parsed) this.broadcast('triaged', parsed)
      return parsed
    } catch (err) {
      log.warn({ err }, 'ticket triage failed')
      return null
    }
  }

  /** Extract the triage JSON from a model response, validating the enums. */
  private parseTriage(text: string): Triage | null {
    const match = text.match(/\{[\s\S]*\}/)
    if (!match) return null
    let raw: unknown
    try {
      raw = JSON.parse(match[0])
    } catch {
      return null
    }
    if (typeof raw !== 'object' || raw === null) return null
    const obj = raw as Record<string, unknown>
    const category = typeof obj.category === 'string' ? obj.category : 'other'
    const priorityRaw = typeof obj.priority === 'string' ? obj.priority.toLowerCase() : 'normal'
    const priority = (PRIORITIES as readonly string[]).includes(priorityRaw)
      ? (priorityRaw as TicketPriority)
      : 'normal'
    const summary = typeof obj.summary === 'string' ? obj.summary.slice(0, 300) : ''
    return { category, priority, summary }
  }

  /** Apply triage output to the persisted ticket. */
  async applyTriage(ticketId: number, triage: Triage): Promise<void> {
    await db
      .update(tickets)
      .set({ priority: triage.priority, category: triage.category })
      .where(eq(tickets.id, ticketId))
  }

  /** List recent tickets for the dashboard API. */
  async listForGuild(guildId: string, limit = 50): Promise<TicketRow[]> {
    return db
      .select()
      .from(tickets)
      .where(eq(tickets.guildId, guildId))
      .orderBy(desc(tickets.id))
      .limit(limit)
  }

  /** Fetch the transcript text for a ticket id (dashboard API). */
  async transcriptFor(ticketId: number): Promise<{ ticket: TicketRow; transcript: string } | null> {
    const rows = await db.select().from(tickets).where(eq(tickets.id, ticketId)).limit(1)
    const ticket = rows[0]
    if (!ticket) return null
    const messages = await db
      .select()
      .from(ticketMessages)
      .where(eq(ticketMessages.ticketId, ticketId))
      .orderBy(ticketMessages.id)
    return { ticket, transcript: this.renderTranscript(ticket, messages) }
  }
}
