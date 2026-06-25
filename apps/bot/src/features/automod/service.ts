/**
 * Automod service: the stateful brain behind the listeners.
 *
 * Owns strike persistence (via modCases), action escalation (warn -> mute),
 * raid detection (join-surge tracking), the in-memory flood tracker, the
 * optional AI scam-link judgement, and dashboard broadcasts. Registered on the
 * Sapphire container as `container.automod` by setupAutomod().
 */
import { and, eq, gte } from 'drizzle-orm'
import {
  type Guild,
  type GuildMember,
  type GuildTextBasedChannel,
  PermissionFlagsBits,
} from 'discord.js'
import { container } from '@sapphire/framework'
import { getDb, modCases } from '@nd/db'
import { getRouter } from '@nd/ai'
import { createLogger } from '@nd/core'
import { brandEmbed, warningEmbed } from '../../lib/embed.ts'
import { resolveAutomodSettings, type AutomodSettings } from './config.ts'
import { FloodTracker, type FilterHit } from './filters.ts'

const log = createLogger('automod')

/** What the service decided to do about a violation, surfaced for broadcasts. */
export type AutomodOutcome = 'deleted' | 'warned' | 'muted'

/** Sliding-window join counter per guild for raid detection. */
class RaidTracker {
  private readonly joins = new Map<string, number[]>()
  /** Guilds currently flagged as under a raid, so we alert once per surge. */
  private readonly active = new Set<string>()

  record(guildId: string, now: number, settings: AutomodSettings): { tripped: boolean; count: number } {
    const { raidJoinCount, raidWindowMs } = settings.thresholds
    const window = (this.joins.get(guildId) ?? []).filter((ts) => now - ts < raidWindowMs)
    window.push(now)
    this.joins.set(guildId, window)

    if (window.length >= raidJoinCount) {
      if (this.active.has(guildId)) return { tripped: false, count: window.length }
      this.active.add(guildId)
      return { tripped: true, count: window.length }
    }
    if (window.length <= 1) this.active.delete(guildId) // surge subsided
    return { tripped: false, count: window.length }
  }
}

export class AutomodService {
  private readonly flood = new FloodTracker()
  private readonly raid = new RaidTracker()
  private pruneTimer: ReturnType<typeof setInterval> | null = null

  /** Start the periodic pruning of in-memory trackers. Idempotent. */
  start(): void {
    if (this.pruneTimer) return
    this.pruneTimer = setInterval(() => this.flood.prune(Date.now()), 60_000)
    // Unref so this never keeps the process alive on its own.
    this.pruneTimer.unref?.()
    log.info('automod service started')
  }

  stop(): void {
    if (this.pruneTimer) clearInterval(this.pruneTimer)
    this.pruneTimer = null
  }

  settingsFor(guildId: string): Promise<AutomodSettings> {
    return resolveAutomodSettings(guildId)
  }

  /** Record a message in the flood tracker; returns a hit when the user floods. */
  trackMessage(guildId: string, userId: string, now: number, settings: AutomodSettings): FilterHit | null {
    return this.flood.record(`${guildId}:${userId}`, now, settings)
  }

  /**
   * Count recent strikes for a user from modCases, used to decide escalation.
   * Counts automod-authored warn/mute cases inside the escalation window.
   */
  private async recentStrikes(guildId: string, userId: string, settings: AutomodSettings): Promise<number> {
    const since = Date.now() - settings.thresholds.escalateWindowMs
    const rows = await getDb()
      .select({ id: modCases.id })
      .from(modCases)
      .where(
        and(
          eq(modCases.guildId, guildId),
          eq(modCases.userId, userId),
          eq(modCases.moderatorId, container.client.user?.id ?? 'automod'),
          gte(modCases.createdAt, since),
        ),
      )
    return rows.length
  }

  /** Persist an automod strike as a modCase and return its id. */
  private async persistCase(
    guildId: string,
    userId: string,
    action: 'warn' | 'mute',
    reason: string,
    durationMs: number | null,
  ): Promise<number> {
    const moderatorId = container.client.user?.id ?? 'automod'
    const expiresAt = durationMs ? Date.now() + durationMs : null
    const inserted = await getDb()
      .insert(modCases)
      .values({ guildId, userId, moderatorId, action, reason, durationMs, expiresAt })
      .returning({ id: modCases.id })
    return inserted[0]?.id ?? 0
  }

  /**
   * Apply the automod response to a violation: delete already happened in the
   * listener; here we record the strike, escalate to a timeout when the user
   * has tripped enough recently, alert mods, and broadcast. Returns the outcome.
   */
  async handleViolation(
    member: GuildMember,
    hit: FilterHit,
    channel: GuildTextBasedChannel,
    settings: AutomodSettings,
  ): Promise<AutomodOutcome> {
    const { guild } = member
    const priorStrikes = await this.recentStrikes(guild.id, member.id, settings)
    const totalStrikes = priorStrikes + 1
    const shouldMute = totalStrikes >= settings.thresholds.escalateAfter

    let outcome: AutomodOutcome = 'warned'
    let caseId = 0

    if (shouldMute) {
      caseId = await this.persistCase(
        guild.id,
        member.id,
        'mute',
        `Automod escalation (${hit.kind}): ${hit.reason}`,
        settings.thresholds.muteMs,
      )
      outcome = (await this.applyTimeout(member, settings.thresholds.muteMs, hit.reason)) ? 'muted' : 'warned'
    } else {
      caseId = await this.persistCase(guild.id, member.id, 'warn', `Automod (${hit.kind}): ${hit.reason}`, null)
    }

    await this.notifyChannel(channel, member, hit, outcome, totalStrikes, settings)
    this.broadcast('action', {
      guildId: guild.id,
      userId: member.id,
      kind: hit.kind,
      outcome,
      caseId,
      strikes: totalStrikes,
      ts: Date.now(),
    })
    return outcome
  }

  private async applyTimeout(member: GuildMember, durationMs: number, reason: string): Promise<boolean> {
    if (!member.guild.members.me?.permissions.has(PermissionFlagsBits.ModerateMembers)) return false
    if (!member.moderatable) return false
    try {
      await member.timeout(durationMs, `Automod: ${reason}`)
      return true
    } catch (err) {
      log.warn({ err, userId: member.id }, 'failed to apply automod timeout')
      return false
    }
  }

  /** Post a short, ephemeral-style notice in the channel where the violation happened. */
  private async notifyChannel(
    channel: GuildTextBasedChannel,
    member: GuildMember,
    hit: FilterHit,
    outcome: AutomodOutcome,
    strikes: number,
    settings: AutomodSettings,
  ): Promise<void> {
    if (!channel.isSendable()) return
    const action =
      outcome === 'muted'
        ? `muted for ${Math.round(settings.thresholds.muteMs / 60_000)} minutes`
        : 'warned'
    const embed = warningEmbed(
      'Automod',
      `${member} was ${action}. ${hit.reason} (strike ${strikes})`,
    )
    try {
      const sent = await channel.send({ embeds: [embed] })
      // Auto-clean the notice so the channel stays tidy.
      setTimeout(() => void sent.delete().catch(() => undefined), 8_000)
    } catch (err) {
      log.debug({ err }, 'could not post automod notice')
    }
  }

  /**
   * Optional AI judgement for a borderline link. Guarded by the `aiScamCheck`
   * setting. Returns true when the model judges the message a scam. Failures are
   * swallowed (fail-open) so the AI never blocks the message pipeline.
   */
  async judgeScam(content: string, settings: AutomodSettings): Promise<boolean> {
    if (!settings.aiScamCheck) return false
    try {
      const res = await getRouter().generate({
        intent: 'moderation',
        maxTokens: 8,
        system:
          'You are a Discord safety classifier. Reply with exactly YES if the message is a scam, ' +
          'phishing, malware, or fake free-nitro/gift link, otherwise reply NO. One word only.',
        prompt: content.slice(0, 800),
      })
      return /^\s*yes/i.test(res.text)
    } catch (err) {
      log.warn({ err }, 'ai scam check failed, treating as not-scam')
      return false
    }
  }

  // ---- Raid detection -----------------------------------------------------

  /** Record a join and alert mods when a surge crosses the raid threshold. */
  async onJoin(guild: Guild, settings: AutomodSettings): Promise<void> {
    const { tripped, count } = this.raid.record(guild.id, Date.now(), settings)
    if (!tripped) return
    log.warn({ guildId: guild.id, count }, 'raid surge detected')
    const embed = brandEmbed({
      tone: 'danger',
      title: 'Possible raid detected',
      description: `${count} members joined within ${Math.round(
        settings.thresholds.raidWindowMs / 1000,
      )} seconds. Review recent joins and consider raising the verification level.`,
    })
    await this.alert(guild, settings, embed)
    this.broadcast('raid', { guildId: guild.id, count, ts: Date.now() })
  }

  // ---- Quarantine scan ----------------------------------------------------

  /**
   * Scan a member's username/display name against the suspicious patterns. When
   * it matches, apply the quarantine role (if configured) and alert mods.
   */
  async scanMember(member: GuildMember, settings: AutomodSettings): Promise<boolean> {
    const name = `${member.user.username} ${member.displayName}`.toLowerCase()
    const match = settings.suspiciousNamePatterns.find((p) => p.length > 0 && name.includes(p))
    if (!match) return false

    let quarantined = false
    if (settings.quarantineRoleId && member.guild.members.me?.permissions.has(PermissionFlagsBits.ManageRoles)) {
      const role = member.guild.roles.cache.get(settings.quarantineRoleId)
      if (role && member.manageable && role.position < (member.guild.members.me.roles.highest.position ?? 0)) {
        try {
          await member.roles.add(role, 'Automod quarantine: suspicious name')
          quarantined = true
        } catch (err) {
          log.warn({ err, userId: member.id }, 'failed to apply quarantine role')
        }
      }
    }

    const embed = brandEmbed({
      tone: 'warning',
      title: 'Suspicious member flagged',
      description: [
        `${member} (${member.user.tag}) matched a suspicious name pattern: "${match}".`,
        quarantined ? 'A quarantine role was applied.' : 'No quarantine role applied. Review manually.',
      ].join('\n'),
    })
    await this.alert(member.guild, settings, embed)
    this.broadcast('quarantine', {
      guildId: member.guild.id,
      userId: member.id,
      pattern: match,
      quarantined,
      ts: Date.now(),
    })
    return true
  }

  // ---- Shared helpers -----------------------------------------------------

  /** Send an alert embed to the configured automod alert channel, if resolvable. */
  private async alert(guild: Guild, settings: AutomodSettings, embed: ReturnType<typeof brandEmbed>): Promise<void> {
    const channelId = settings.alertChannelId
    if (!channelId) return
    const channel = guild.channels.cache.get(channelId) ?? (await guild.channels.fetch(channelId).catch(() => null))
    if (!channel || !channel.isTextBased() || !channel.isSendable()) return
    try {
      await channel.send({ embeds: [embed] })
    } catch (err) {
      log.debug({ err }, 'could not send automod alert')
    }
  }

  private broadcast(event: string, data: Record<string, unknown>): void {
    container.api?.hub.broadcast('automod', event, data)
  }
}
