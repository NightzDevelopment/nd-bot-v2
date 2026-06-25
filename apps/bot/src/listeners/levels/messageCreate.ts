/**
 * Levels: XP grant listener.
 *
 * On every human guild message this awards XP (settings.thresholds.xpPerMessage,
 * default 15) behind a per user cooldown enforced in the service. When the
 * member crosses a level boundary it announces the level up in the configured
 * channel (or the originating channel), grants any earned level roles, and
 * broadcasts a `level_up` event to the dashboard.
 *
 * Sapphire auto loads this file from `src/listeners`.
 */
import { Events, Listener, container } from '@sapphire/framework'
import type { GuildTextBasedChannel, Message } from 'discord.js'
import { t } from '@nd/i18n'
import { brandEmbed } from '../../lib/embed.ts'
import { DEFAULT_XP_PER_MESSAGE } from '../../features/levels/leveling.ts'
import { syncLevelRoles } from '../../features/levels/roles.ts'

/** Stack lower tier roles by default (kept until config exposes a toggle). */
const STACK_ROLES = true

export class LevelsMessageListener extends Listener<typeof Events.MessageCreate> {
  public constructor(context: Listener.LoaderContext, options: Listener.Options) {
    super(context, { ...options, event: Events.MessageCreate })
  }

  public override async run(message: Message): Promise<void> {
    if (message.author.bot || message.system) return
    if (!message.inGuild()) return

    const guildId = message.guildId
    const settings = await container.config.getSettings(guildId)
    if (!settings.modules.levels.enabled) return

    const xpPerMessage = settings.thresholds.xpPerMessage ?? DEFAULT_XP_PER_MESSAGE
    if (xpPerMessage <= 0) return

    const service = container.leveling
    const grant = await service.grantMessageXp(guildId, message.author.id, xpPerMessage)
    if (!grant || !grant.leveledUp) return

    await this.handleLevelUp(message, grant.level, settings.modules.levels.logChannelId)
  }

  private async handleLevelUp(
    message: Message<true>,
    level: number,
    logChannelId: string | null,
  ): Promise<void> {
    const guildId = message.guildId
    const userId = message.author.id
    const locale = await container.config.getLocale(guildId)

    // Grant level roles (best effort) and collect any that were newly added.
    let earnedRoleNames: string[] = []
    const member = message.member
    if (member) {
      try {
        const { added } = await syncLevelRoles(container.leveling, member, level, STACK_ROLES)
        earnedRoleNames = added.map((r) => r.name)
      } catch (err) {
        container.logger.warn({ err, guildId, userId }, 'level role sync failed')
      }
    }

    const lines = [t(locale, 'levels.level_up', { user: `<@${userId}>`, level })]
    for (const roleName of earnedRoleNames) {
      lines.push(t(locale, 'levels.level_up_role', { role: roleName, level }))
    }

    const embed = brandEmbed({ tone: 'success', title: 'Level up', description: lines.join('\n') })

    const target = await this.resolveAnnounceChannel(message, logChannelId)
    if (target) {
      try {
        await target.send({ embeds: [embed] })
      } catch (err) {
        container.logger.warn({ err, guildId, channelId: target.id }, 'level up announce failed')
      }
    }

    container.api?.hub.broadcast('levels', 'level_up', {
      guildId,
      userId,
      level,
      roles: earnedRoleNames,
      ts: Date.now(),
    })
  }

  /** Prefer the configured log channel, falling back to where the message landed. */
  private async resolveAnnounceChannel(
    message: Message<true>,
    logChannelId: string | null,
  ): Promise<GuildTextBasedChannel | null> {
    if (logChannelId) {
      const channel = await message.guild.channels.fetch(logChannelId).catch(() => null)
      if (channel?.isTextBased() && channel.isSendable()) return channel
    }
    const origin = message.channel
    return origin.isTextBased() && origin.isSendable() ? origin : null
  }
}
