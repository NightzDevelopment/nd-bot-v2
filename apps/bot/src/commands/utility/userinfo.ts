/**
 * /userinfo: a branded summary of a user (defaults to the caller).
 *
 * Account creation, server join date, top roles, and key flags. Works on both
 * members (in a guild) and bare users. No emojis in output.
 */
import { Command, container } from '@sapphire/framework'
import { type GuildMember, type Message, type User } from 'discord.js'
import { t } from '@nd/i18n'
import { brandEmbed } from '../../lib/embed.ts'

export class UserInfoCommand extends Command {
  public constructor(context: Command.LoaderContext, options: Command.Options) {
    super(context, {
      ...options,
      name: 'userinfo',
      description: 'Show information about a user.',
    })
  }

  public override registerApplicationCommands(registry: Command.Registry): void {
    registry.registerChatInputCommand((builder) =>
      builder
        .setName(this.name)
        .setDescription(this.description)
        .addUserOption((o) =>
          o.setName('user').setDescription('The user to inspect. Defaults to you.').setRequired(false),
        ),
    )
  }

  public override async chatInputRun(
    interaction: Command.ChatInputCommandInteraction,
  ): Promise<void> {
    const user = interaction.options.getUser('user') ?? interaction.user
    const member =
      interaction.guild?.members.cache.get(user.id) ??
      (await interaction.guild?.members.fetch(user.id).catch(() => null)) ??
      null
    await interaction.reply({ embeds: [await this.build(user, member)] })
  }

  public override async messageRun(message: Message): Promise<void> {
    const user = message.mentions.users.first() ?? message.author
    const member = message.guild?.members.cache.get(user.id) ?? null
    await message.reply({ embeds: [await this.build(user, member)] })
  }

  private async build(user: User, member: GuildMember | null) {
    const guildId = member?.guild.id ?? ''
    const locale = await container.config.getLocale(guildId)
    const full = await user.fetch().catch(() => user)

    const embed = brandEmbed({
      tone: 'primary',
      // utility.userinfo.title: "User information for {user}"
      title: t(locale, 'utility.userinfo.title', { user: full.tag }),
    })

    const avatar = (member ?? full).displayAvatarURL({ size: 256 })
    embed.setThumbnail(avatar)

    embed.addFields(
      { name: 'Username', value: full.tag, inline: true },
      { name: 'Id', value: full.id, inline: true },
      { name: 'Bot', value: full.bot ? 'Yes' : 'No', inline: true },
      { name: 'Account created', value: `<t:${Math.floor(full.createdTimestamp / 1000)}:D>`, inline: true },
    )

    if (member) {
      if (member.joinedTimestamp) {
        embed.addFields({
          name: 'Joined server',
          value: `<t:${Math.floor(member.joinedTimestamp / 1000)}:D>`,
          inline: true,
        })
      }

      const roles = member.roles.cache
        .filter((r) => r.id !== guildId)
        .sort((a, b) => b.position - a.position)
        .map((r) => `<@&${r.id}>`)
        .slice(0, 15)

      if (roles.length > 0) {
        embed.addFields({ name: `Roles (${member.roles.cache.size - 1})`, value: roles.join(' '), inline: false })
      }

      if (member.nickname) {
        embed.addFields({ name: 'Nickname', value: member.nickname, inline: true })
      }
    }

    const accent = full.accentColor
    if (typeof accent === 'number') embed.setColor(accent)

    return embed
  }
}
