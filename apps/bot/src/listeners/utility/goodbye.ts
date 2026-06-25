/**
 * guildMemberRemove: post a goodbye message to the welcome channel.
 *
 * Settings has no dedicated goodbye channel field yet, so this reuses
 * `channels.welcomeId`. The utility module must be enabled. The message uses the
 * `utility.goodbye.default` locale string as the template, interpolating {user},
 * {guild}, and {memberCount}.
 */
import { Events, Listener, container } from '@sapphire/framework'
import type { GuildMember, PartialGuildMember } from 'discord.js'
import { t } from '@nd/i18n'
import { brandEmbed } from '../../lib/embed.ts'
import { renderGreeting } from '../../features/utility/greetings.ts'

export class GoodbyeListener extends Listener<typeof Events.GuildMemberRemove> {
  public constructor(context: Listener.LoaderContext, options: Listener.Options) {
    super(context, { ...options, event: Events.GuildMemberRemove })
  }

  public override async run(member: GuildMember | PartialGuildMember): Promise<void> {
    const settings = await container.config.getSettings(member.guild.id)
    if (!settings.modules.utility.enabled) return

    const channelId = settings.channels.welcomeId
    if (!channelId) return

    const channel = member.guild.channels.cache.get(channelId) ?? (await member.guild.channels.fetch(channelId).catch(() => null))
    if (!channel || !channel.isTextBased() || !channel.isSendable()) return

    const locale = await container.config.getLocale(member.guild.id)
    const tag = member.user?.tag ?? `user ${member.id}`
    // utility.goodbye.default: "{user} has left the server."
    const template = t(locale, 'utility.goodbye.default')
    const description = renderGreeting(template, {
      user: tag,
      guild: member.guild.name,
      memberCount: member.guild.memberCount,
    })

    const embed = brandEmbed({ tone: 'neutral', title: 'Member left', description })

    await channel.send({ embeds: [embed] }).catch((err) => {
      container.logger.warn({ err, guildId: member.guild.id }, 'utility: failed to send goodbye message')
    })

    container.api?.hub.broadcast('utility', 'member_left', {
      guildId: member.guild.id,
      userId: member.id,
      memberCount: member.guild.memberCount,
    })
  }
}
