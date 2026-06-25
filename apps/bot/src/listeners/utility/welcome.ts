/**
 * guildMemberAdd: post a welcome message to the configured welcome channel.
 *
 * Reads `channels.welcomeId` from guild config. The utility module must be
 * enabled. The greeting uses the `utility.welcome.default` locale string as the
 * template (settings has no per guild welcome template field yet), interpolating
 * {user}, {guild}, and {memberCount}.
 */
import { Events, Listener, container } from '@sapphire/framework'
import type { GuildMember } from 'discord.js'
import { t } from '@nd/i18n'
import { brandEmbed } from '../../lib/embed.ts'
import { renderGreeting } from '../../features/utility/greetings.ts'

export class WelcomeListener extends Listener<typeof Events.GuildMemberAdd> {
  public constructor(context: Listener.LoaderContext, options: Listener.Options) {
    super(context, { ...options, event: Events.GuildMemberAdd })
  }

  public override async run(member: GuildMember): Promise<void> {
    const settings = await container.config.getSettings(member.guild.id)
    if (!settings.modules.utility.enabled) return

    const channelId = settings.channels.welcomeId
    if (!channelId) return

    const channel = member.guild.channels.cache.get(channelId) ?? (await member.guild.channels.fetch(channelId).catch(() => null))
    if (!channel || !channel.isTextBased() || !channel.isSendable()) return

    const locale = await container.config.getLocale(member.guild.id)
    // utility.welcome.default: "Welcome to {guild}, {user}."
    const template = t(locale, 'utility.welcome.default')
    const description = renderGreeting(template, {
      user: `<@${member.id}>`,
      guild: member.guild.name,
      memberCount: member.guild.memberCount,
    })

    const embed = brandEmbed({ tone: 'success', title: 'Welcome', description }).setFooter({
      text: `Member ${member.guild.memberCount}`,
    })
    const avatar = member.displayAvatarURL({ size: 128 })
    if (avatar) embed.setThumbnail(avatar)

    await channel.send({ embeds: [embed] }).catch((err) => {
      container.logger.warn({ err, guildId: member.guild.id }, 'utility: failed to send welcome message')
    })

    container.api?.hub.broadcast('utility', 'member_welcomed', {
      guildId: member.guild.id,
      userId: member.id,
      memberCount: member.guild.memberCount,
    })
  }
}
