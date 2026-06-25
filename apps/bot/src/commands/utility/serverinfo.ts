/**
 * /serverinfo: a branded summary of the current guild.
 *
 * Owner, creation date, member/channel/role/emoji counts, boost tier, and the
 * verification level. Guild only. No emojis in output.
 */
import { Command, container } from '@sapphire/framework'
import { ChannelType, type Guild, GuildVerificationLevel, type Message } from 'discord.js'
import { t } from '@nd/i18n'
import { brandEmbed, errorEmbed } from '../../lib/embed.ts'

const VERIFICATION_LABEL: Record<GuildVerificationLevel, string> = {
  [GuildVerificationLevel.None]: 'None',
  [GuildVerificationLevel.Low]: 'Low',
  [GuildVerificationLevel.Medium]: 'Medium',
  [GuildVerificationLevel.High]: 'High',
  [GuildVerificationLevel.VeryHigh]: 'Very high',
}

export class ServerInfoCommand extends Command {
  public constructor(context: Command.LoaderContext, options: Command.Options) {
    super(context, {
      ...options,
      name: 'serverinfo',
      description: 'Show information about this server.',
    })
  }

  public override registerApplicationCommands(registry: Command.Registry): void {
    registry.registerChatInputCommand((builder) =>
      builder.setName(this.name).setDescription(this.description).setDMPermission(false),
    )
  }

  public override async chatInputRun(
    interaction: Command.ChatInputCommandInteraction,
  ): Promise<void> {
    const guild = interaction.guild
    if (!guild) {
      const locale = await container.config.getLocale('')
      await interaction.reply({ embeds: [errorEmbed('Server info', t(locale, 'common.guild_only'))], ephemeral: true })
      return
    }
    await interaction.reply({ embeds: [await this.build(guild)] })
  }

  public override async messageRun(message: Message): Promise<void> {
    if (!message.guild) {
      const locale = await container.config.getLocale('')
      await message.reply({ embeds: [errorEmbed('Server info', t(locale, 'common.guild_only'))] })
      return
    }
    await message.reply({ embeds: [await this.build(message.guild)] })
  }

  private async build(guild: Guild) {
    const locale = await container.config.getLocale(guild.id)
    const owner = await guild.fetchOwner().catch(() => null)

    const channels = guild.channels.cache
    const textChannels = channels.filter((c) => c.type === ChannelType.GuildText).size
    const voiceChannels = channels.filter(
      (c) => c.type === ChannelType.GuildVoice || c.type === ChannelType.GuildStageVoice,
    ).size
    const categories = channels.filter((c) => c.type === ChannelType.GuildCategory).size

    const embed = brandEmbed({
      tone: 'primary',
      // utility.serverinfo.title: "Server information for {guild}"
      title: t(locale, 'utility.serverinfo.title', { guild: guild.name }),
    })

    const icon = guild.iconURL({ size: 256 })
    if (icon) embed.setThumbnail(icon)

    embed.addFields(
      { name: 'Owner', value: owner ? `${owner.user.tag}` : 'Unknown', inline: true },
      { name: 'Members', value: String(guild.memberCount), inline: true },
      { name: 'Created', value: `<t:${Math.floor(guild.createdTimestamp / 1000)}:D>`, inline: true },
      {
        name: 'Channels',
        value: `${textChannels} text, ${voiceChannels} voice, ${categories} categories`,
        inline: false,
      },
      { name: 'Roles', value: String(guild.roles.cache.size), inline: true },
      { name: 'Emojis', value: String(guild.emojis.cache.size), inline: true },
      {
        name: 'Boosts',
        value: `Tier ${guild.premiumTier} (${guild.premiumSubscriptionCount ?? 0} boosts)`,
        inline: true,
      },
      { name: 'Verification', value: VERIFICATION_LABEL[guild.verificationLevel], inline: true },
    )

    embed.setFooter({ text: `Server id ${guild.id}` })
    return embed
  }
}
