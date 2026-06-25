/**
 * Automod message filter listener.
 *
 * On every guild message it resolves the guild's automod settings, runs the
 * content filters plus the stateful flood tracker, and on a hit deletes the
 * message and hands off to the service for strike + escalation handling. Members
 * with ManageMessages are exempt. Sapphire auto loads this from src/listeners.
 */
import { Events, Listener } from '@sapphire/framework'
import { type Message, PermissionFlagsBits } from 'discord.js'
import { resolveAutomodSettings } from '../../features/automod/config.ts'
import { extractDomains, runContentFilters, type FilterHit } from '../../features/automod/filters.ts'

export class AutomodMessageListener extends Listener<typeof Events.MessageCreate> {
  public constructor(context: Listener.LoaderContext, options: Listener.Options) {
    super(context, { ...options, event: Events.MessageCreate })
  }

  public override async run(message: Message): Promise<void> {
    if (!message.inGuild()) return
    if (message.author.bot || message.system) return
    if (message.webhookId) return

    const member = message.member
    if (!member) return
    // Exempt moderators from automod.
    if (member.permissions.has(PermissionFlagsBits.ManageMessages)) return

    const settings = await resolveAutomodSettings(message.guildId)
    if (!settings.enabled) return

    const mentionCount =
      message.mentions.users.size +
      message.mentions.roles.size +
      (message.mentions.everyone ? 1 : 0)

    let hit: FilterHit | null = runContentFilters(
      { content: message.content, mentionCount },
      settings,
    )

    // Stateful flood detection runs on every message, even clean ones.
    const floodHit = this.container.automod.trackMessage(
      message.guildId,
      message.author.id,
      message.createdTimestamp,
      settings,
    )
    hit ??= floodHit

    // Optional AI scam judgement for messages that carry a link but did not
    // already trip a hard filter. Guarded by setting inside judgeScam.
    if (!hit && settings.aiScamCheck && extractDomains(message.content).length > 0) {
      const scam = await this.container.automod.judgeScam(message.content, settings)
      if (scam) hit = { kind: 'link_filter', reason: 'AI flagged this link as a likely scam.' }
    }

    if (!hit) return

    // Delete first so the offending content is gone quickly.
    if (message.deletable) {
      await message.delete().catch(() => undefined)
    }

    const channel = message.channel
    if (!channel.isTextBased() || channel.isDMBased()) return
    await this.container.automod.handleViolation(member, hit, channel, settings)
  }
}
