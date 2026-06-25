/**
 * Community feature service.
 *
 * Owns the side effecting logic for polls, giveaways, suggestions, and channel
 * counters so commands, listeners, the resume loops, and the API routes share a
 * single implementation. Everything here is idempotent where it matters: closing
 * an already closed poll, ending an already ended giveaway, or refreshing a
 * counter that has not changed are all safe to call repeatedly. That property is
 * what makes the restart safe resume loop in `setupCommunity` correct.
 *
 * All DB access is Drizzle only (@nd/db). All user facing strings go through
 * @nd/i18n with the guild locale, falling back to plain English where a key does
 * not yet exist (those gaps are reported back for the locale files to gain).
 */
import { and, eq } from 'drizzle-orm'
import { ChannelType, type Client, type Guild, type GuildBasedChannel } from 'discord.js'
import { getDb, schema } from '@nd/db'
import { t } from '@nd/i18n'
import { container } from '@sapphire/framework'
import { brandEmbed } from '../../lib/embed.ts'

/** Functional reaction emojis (escapes only, never literal glyphs). */
export const POLL_LETTER_EMOJIS = [
  '\u{1F1E6}', // A
  '\u{1F1E7}', // B
  '\u{1F1E8}', // C
  '\u{1F1E9}', // D
  '\u{1F1EA}', // E
  '\u{1F1EB}', // F
  '\u{1F1EC}', // G
  '\u{1F1ED}', // H
  '\u{1F1EE}', // I
  '\u{1F1EF}', // J
] as const

/** Tada, used as the giveaway entry button emoji. */
export const GIVEAWAY_EMOJI = '\u{1F389}'

/** customId prefixes for the component interactions this feature owns. */
export const CUSTOM_ID = {
  giveawayEnter: 'community:giveaway:enter',
  suggestApprove: 'community:suggest:approve',
  suggestDeny: 'community:suggest:deny',
} as const

export type GiveawayRow = typeof schema.giveaways.$inferSelect
export type PollRow = typeof schema.polls.$inferSelect
export type SuggestionRow = typeof schema.suggestions.$inferSelect
export type CounterRow = typeof schema.counters.$inferSelect

/** A short random id for giveaways (the giveaways table uses a text primary key). */
export function newGiveawayId(): string {
  return `gw_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
}

export class CommunityService {
  private readonly db = getDb()

  // ---- Polls --------------------------------------------------------------

  async createPoll(input: {
    guildId: string
    channelId: string
    messageId: string
    question: string
    options: string[]
    endsAt: number | null
  }): Promise<PollRow> {
    const rows = await this.db
      .insert(schema.polls)
      .values({
        guildId: input.guildId,
        channelId: input.channelId,
        messageId: input.messageId,
        question: input.question,
        options: input.options,
        endsAt: input.endsAt,
        closed: false,
      })
      .returning()
    const row = rows[0]
    if (!row) throw new Error('failed to insert poll')
    container.api?.hub.broadcast('community', 'poll_created', {
      id: row.id,
      guildId: row.guildId,
      question: row.question,
    })
    return row
  }

  /**
   * Tally reactions on a poll message and close it. Idempotent: a poll already
   * marked closed is skipped. Returns the closed row, or null if nothing to do.
   */
  async closePoll(client: Client, pollId: number): Promise<PollRow | null> {
    const rows = await this.db.select().from(schema.polls).where(eq(schema.polls.id, pollId)).limit(1)
    const poll = rows[0]
    if (!poll || poll.closed) return null

    // Mark closed first so concurrent loop ticks do not double process.
    await this.db.update(schema.polls).set({ closed: true }).where(eq(schema.polls.id, pollId))

    const options = Array.isArray(poll.options) ? (poll.options as string[]) : []
    const locale = await container.config.getLocale(poll.guildId)

    const channel = await this.fetchTextChannel(client, poll.channelId)
    let message = channel ? await channel.messages.fetch(poll.messageId).catch(() => null) : null

    const tally: Array<{ option: string; votes: number; emoji: string }> = []
    if (message) {
      for (let i = 0; i < options.length; i++) {
        const emoji = POLL_LETTER_EMOJIS[i]
        const optionText = options[i]
        if (emoji === undefined || optionText === undefined) continue
        const reaction = message.reactions.cache.get(emoji)
        // The bot's own reaction is not a vote, so subtract one when present.
        const raw = reaction?.count ?? 0
        const votes = Math.max(0, raw - 1)
        tally.push({ option: optionText, votes, emoji })
      }
    }

    const totalVotes = tally.reduce((sum, item) => sum + item.votes, 0)
    const winner = tally.reduce<{ option: string; votes: number } | null>((best, item) => {
      if (!best || item.votes > best.votes) return { option: item.option, votes: item.votes }
      return best
    }, null)

    const lines = tally.map((item) => `${item.emoji} ${item.option}: ${item.votes}`)
    const description =
      totalVotes === 0 || !winner
        ? t(locale, 'community.poll.no_votes')
        : t(locale, 'community.poll.closed', { option: winner.option, votes: winner.votes })

    const embed = brandEmbed({
      tone: 'neutral',
      title: poll.question,
      description: [description, '', ...lines].join('\n'),
      footer: 'Poll closed',
    })

    if (message) {
      await message.edit({ embeds: [embed], components: [] }).catch(() => null)
    }

    container.api?.hub.broadcast('community', 'poll_closed', {
      id: poll.id,
      guildId: poll.guildId,
      winner: winner?.option ?? null,
      votes: winner?.votes ?? 0,
    })

    return { ...poll, closed: true }
  }

  /** Close any open poll whose endsAt has passed. Called by the resume loop. */
  async sweepDuePolls(client: Client): Promise<void> {
    const now = Date.now()
    const open = await this.db.select().from(schema.polls).where(eq(schema.polls.closed, false))
    for (const poll of open) {
      if (poll.endsAt !== null && poll.endsAt <= now) {
        await this.closePoll(client, poll.id).catch(() => null)
      }
    }
  }

  async listPolls(guildId: string): Promise<PollRow[]> {
    return this.db.select().from(schema.polls).where(eq(schema.polls.guildId, guildId))
  }

  // ---- Giveaways ----------------------------------------------------------

  async createGiveaway(input: {
    guildId: string
    channelId: string
    messageId: string
    prize: string
    winnerCount: number
    hostId: string
    endsAt: number
  }): Promise<GiveawayRow> {
    const id = newGiveawayId()
    const rows = await this.db
      .insert(schema.giveaways)
      .values({
        id,
        guildId: input.guildId,
        channelId: input.channelId,
        messageId: input.messageId,
        prize: input.prize,
        winnerCount: input.winnerCount,
        hostId: input.hostId,
        endsAt: input.endsAt,
        ended: false,
      })
      .returning()
    const row = rows[0]
    if (!row) throw new Error('failed to insert giveaway')
    container.api?.hub.broadcast('community', 'giveaway_created', {
      id: row.id,
      guildId: row.guildId,
      prize: row.prize,
      endsAt: row.endsAt,
    })
    return row
  }

  async getGiveaway(id: string): Promise<GiveawayRow | null> {
    const rows = await this.db.select().from(schema.giveaways).where(eq(schema.giveaways.id, id)).limit(1)
    return rows[0] ?? null
  }

  /**
   * Collect entrants from the entry reaction on the giveaway message.
   * Reactions are the durable store of entries, so this survives restarts.
   */
  private async collectEntrants(client: Client, giveaway: GiveawayRow): Promise<string[]> {
    const channel = await this.fetchTextChannel(client, giveaway.channelId)
    if (!channel) return []
    const message = await channel.messages.fetch(giveaway.messageId).catch(() => null)
    if (!message) return []
    const reaction = message.reactions.cache.get(GIVEAWAY_EMOJI)
    if (!reaction) return []
    const users = await reaction.users.fetch().catch(() => null)
    if (!users) return []
    return users.filter((user) => !user.bot).map((user) => user.id)
  }

  private pickWinners(entrants: string[], count: number, exclude: Set<string> = new Set()): string[] {
    const pool = entrants.filter((id) => !exclude.has(id))
    const winners: string[] = []
    for (let i = 0; i < count && pool.length > 0; i++) {
      const index = Math.floor(Math.random() * pool.length)
      const [picked] = pool.splice(index, 1)
      if (picked !== undefined) winners.push(picked)
    }
    return winners
  }

  /**
   * Draw a giveaway and announce winners. Idempotent: an already ended giveaway
   * is skipped, which is exactly what makes the resume loop safe to run on every
   * boot. Returns the winners (may be empty).
   */
  async endGiveaway(client: Client, id: string): Promise<{ winners: string[]; row: GiveawayRow } | null> {
    const giveaway = await this.getGiveaway(id)
    if (!giveaway || giveaway.ended) return null

    // Flag ended up front so a concurrent loop tick does not re draw.
    await this.db.update(schema.giveaways).set({ ended: true }).where(eq(schema.giveaways.id, id))

    const locale = await container.config.getLocale(giveaway.guildId)
    const entrants = await this.collectEntrants(client, giveaway)
    const winners = this.pickWinners(entrants, giveaway.winnerCount)

    await this.announceGiveawayResult(client, giveaway, winners, locale)
    container.api?.hub.broadcast('community', 'giveaway_ended', {
      id: giveaway.id,
      guildId: giveaway.guildId,
      prize: giveaway.prize,
      winners,
    })

    return { winners, row: { ...giveaway, ended: true } }
  }

  /** Reroll an ended giveaway, optionally excluding the previous winners. */
  async rerollGiveaway(
    client: Client,
    id: string,
    excludeUserIds: string[] = [],
  ): Promise<{ winners: string[]; row: GiveawayRow } | null> {
    const giveaway = await this.getGiveaway(id)
    if (!giveaway) return null

    const locale = await container.config.getLocale(giveaway.guildId)
    const entrants = await this.collectEntrants(client, giveaway)
    const winners = this.pickWinners(entrants, giveaway.winnerCount, new Set(excludeUserIds))
    if (winners.length === 0) return { winners, row: giveaway }

    const channel = await this.fetchTextChannel(client, giveaway.channelId)
    if (channel) {
      const mentions = winners.map((winnerId) => `<@${winnerId}>`).join(', ')
      await channel
        .send({
          content: mentions,
          embeds: [
            brandEmbed({
              tone: 'success',
              title: t(locale, 'community.giveaway.rerolled', { prize: giveaway.prize, user: mentions }),
            }),
          ],
        })
        .catch(() => null)
    }

    container.api?.hub.broadcast('community', 'giveaway_rerolled', {
      id: giveaway.id,
      guildId: giveaway.guildId,
      prize: giveaway.prize,
      winners,
    })
    return { winners, row: giveaway }
  }

  private async announceGiveawayResult(
    client: Client,
    giveaway: GiveawayRow,
    winners: string[],
    locale: Awaited<ReturnType<typeof container.config.getLocale>>,
  ): Promise<void> {
    const channel = await this.fetchTextChannel(client, giveaway.channelId)
    if (!channel) return

    const message = await channel.messages.fetch(giveaway.messageId).catch(() => null)
    if (message) {
      const endedEmbed = brandEmbed({
        tone: 'neutral',
        title: t(locale, 'community.giveaway.ended', { prize: giveaway.prize }),
        description:
          winners.length === 0
            ? t(locale, 'community.giveaway.no_entries')
            : winners.map((winnerId) => `<@${winnerId}>`).join(', '),
        footer: 'Giveaway ended',
      })
      await message.edit({ embeds: [endedEmbed], components: [] }).catch(() => null)
    }

    if (winners.length === 0) {
      await channel
        .send({
          embeds: [
            brandEmbed({
              tone: 'warning',
              title: t(locale, 'community.giveaway.ended', { prize: giveaway.prize }),
              description: t(locale, 'community.giveaway.no_entries'),
            }),
          ],
        })
        .catch(() => null)
      return
    }

    const mentions = winners.map((winnerId) => `<@${winnerId}>`).join(', ')
    await channel
      .send({
        content: mentions,
        embeds: [
          brandEmbed({
            tone: 'success',
            title: t(locale, 'community.giveaway.winner', { user: mentions, prize: giveaway.prize }),
          }),
        ],
      })
      .catch(() => null)
  }

  /** End any giveaway whose endsAt has passed and is not yet ended. Resume loop. */
  async sweepDueGiveaways(client: Client): Promise<void> {
    const now = Date.now()
    const open = await this.db.select().from(schema.giveaways).where(eq(schema.giveaways.ended, false))
    for (const giveaway of open) {
      if (giveaway.endsAt <= now) {
        await this.endGiveaway(client, giveaway.id).catch(() => null)
      }
    }
  }

  async listGiveaways(guildId: string): Promise<GiveawayRow[]> {
    return this.db.select().from(schema.giveaways).where(eq(schema.giveaways.guildId, guildId))
  }

  // ---- Suggestions --------------------------------------------------------

  async createSuggestion(input: {
    guildId: string
    userId: string
    content: string
    messageId: string | null
  }): Promise<SuggestionRow> {
    const rows = await this.db
      .insert(schema.suggestions)
      .values({
        guildId: input.guildId,
        userId: input.userId,
        content: input.content,
        status: 'open',
        messageId: input.messageId,
      })
      .returning()
    const row = rows[0]
    if (!row) throw new Error('failed to insert suggestion')
    container.api?.hub.broadcast('community', 'suggestion_created', {
      id: row.id,
      guildId: row.guildId,
      userId: row.userId,
    })
    return row
  }

  async getSuggestion(id: number): Promise<SuggestionRow | null> {
    const rows = await this.db.select().from(schema.suggestions).where(eq(schema.suggestions.id, id)).limit(1)
    return rows[0] ?? null
  }

  async attachSuggestionMessage(id: number, messageId: string): Promise<void> {
    await this.db.update(schema.suggestions).set({ messageId }).where(eq(schema.suggestions.id, id))
  }

  /** Set a suggestion's status. Idempotent for an already resolved suggestion. */
  async setSuggestionStatus(
    id: number,
    status: 'approved' | 'denied',
  ): Promise<SuggestionRow | null> {
    const current = await this.getSuggestion(id)
    if (!current || current.status !== 'open') return null
    await this.db.update(schema.suggestions).set({ status }).where(eq(schema.suggestions.id, id))
    container.api?.hub.broadcast('community', 'suggestion_updated', {
      id,
      guildId: current.guildId,
      status,
    })
    return { ...current, status }
  }

  async listSuggestions(guildId: string): Promise<SuggestionRow[]> {
    return this.db.select().from(schema.suggestions).where(eq(schema.suggestions.guildId, guildId))
  }

  // ---- Counters -----------------------------------------------------------

  async listCounters(guildId: string): Promise<CounterRow[]> {
    return this.db.select().from(schema.counters).where(eq(schema.counters.guildId, guildId))
  }

  async upsertCounter(input: {
    guildId: string
    channelId: string
    kind: string
    template: string
  }): Promise<void> {
    await this.db
      .insert(schema.counters)
      .values(input)
      .onConflictDoUpdate({
        target: [schema.counters.guildId, schema.counters.channelId],
        set: { kind: input.kind, template: input.template },
      })
  }

  async removeCounter(guildId: string, channelId: string): Promise<void> {
    await this.db
      .delete(schema.counters)
      .where(and(eq(schema.counters.guildId, guildId), eq(schema.counters.channelId, channelId)))
  }

  /** Resolve the numeric value for a counter kind against a live guild. */
  private counterValue(guild: Guild, kind: string): number {
    switch (kind) {
      case 'members':
        return guild.memberCount
      case 'online':
        return guild.members.cache.filter(
          (member) => !member.user.bot && member.presence != null && member.presence.status !== 'offline',
        ).size
      case 'boosters':
        return guild.premiumSubscriptionCount ?? 0
      default:
        return guild.memberCount
    }
  }

  /**
   * Rename every counter channel to its rendered template. Renames are rate
   * limited hard by Discord (about twice per ten minutes per channel), so the
   * loop interval that calls this is intentionally slow and we skip a rename
   * when the name already matches.
   */
  async refreshCounters(client: Client): Promise<void> {
    const all = await this.db.select().from(schema.counters)
    for (const counter of all) {
      const guild = client.guilds.cache.get(counter.guildId)
      if (!guild) continue
      const channel = guild.channels.cache.get(counter.channelId)
      if (!channel) continue

      const value = this.counterValue(guild, counter.kind)
      const rendered = counter.template.replace(/\{count\}/g, value.toLocaleString('en-US'))
      if (channel.name === rendered) continue

      await channel.setName(rendered).catch(() => null)
      container.api?.hub.broadcast('community', 'counter_updated', {
        guildId: counter.guildId,
        channelId: counter.channelId,
        kind: counter.kind,
        count: value,
      })
    }
  }

  // ---- Shared -------------------------------------------------------------

  /** Fetch a channel and narrow it to one the bot can send text into. */
  private async fetchTextChannel(
    client: Client,
    channelId: string,
  ): Promise<Extract<GuildBasedChannel, { type: ChannelType.GuildText | ChannelType.GuildAnnouncement }> | null> {
    const channel = await client.channels.fetch(channelId).catch(() => null)
    if (
      channel &&
      (channel.type === ChannelType.GuildText || channel.type === ChannelType.GuildAnnouncement)
    ) {
      return channel
    }
    return null
  }
}
