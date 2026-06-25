/**
 * `/setlevel`: set a member's level directly. Manage Guild only.
 *
 * Normalises the member's XP to the floor of the chosen level and re syncs
 * their level roles. Broadcasts a `level_set` event to the dashboard.
 */
import { Command, container } from '@sapphire/framework'
import { type Message, PermissionFlagsBits } from 'discord.js'
import { t } from '@nd/i18n'
import { errorEmbed, successEmbed } from '../../lib/embed.ts'
import { syncLevelRoles } from '../../features/levels/roles.ts'

const STACK_ROLES = true

export class SetLevelCommand extends Command {
  public constructor(context: Command.LoaderContext, options: Command.Options) {
    super(context, {
      ...options,
      name: 'setlevel',
      description: 'Set a member\'s level.',
      requiredUserPermissions: [PermissionFlagsBits.ManageGuild],
    })
  }

  public override registerApplicationCommands(registry: Command.Registry): void {
    registry.registerChatInputCommand((builder) =>
      builder
        .setName(this.name)
        .setDescription(this.description)
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .addUserOption((opt) =>
          opt.setName('user').setDescription('The member to update.').setRequired(true),
        )
        .addIntegerOption((opt) =>
          opt.setName('level').setDescription('The level to set.').setMinValue(0).setMaxValue(1000).setRequired(true),
        ),
    )
  }

  public override async chatInputRun(
    interaction: Command.ChatInputCommandInteraction,
  ): Promise<void> {
    if (!interaction.inGuild() || !interaction.guild) {
      await interaction.reply({ content: t('en', 'common.guild_only'), ephemeral: true })
      return
    }
    const user = interaction.options.getUser('user', true)
    const level = interaction.options.getInteger('level', true)
    const locale = await container.config.getLocale(interaction.guildId)

    await container.leveling.setLevel(interaction.guildId, user.id, level)

    const member = await interaction.guild.members.fetch(user.id).catch(() => null)
    if (member) {
      await syncLevelRoles(container.leveling, member, level, STACK_ROLES).catch(() => undefined)
    }

    container.api?.hub.broadcast('levels', 'level_set', {
      guildId: interaction.guildId,
      userId: user.id,
      level,
      ts: Date.now(),
    })

    await interaction.reply({
      embeds: [
        successEmbed(
          t(locale, 'common.success'),
          `Set ${user.username} to level ${level}.`,
        ),
      ],
    })
  }

  public override async messageRun(message: Message): Promise<void> {
    if (!message.inGuild() || !message.guild) return
    const user = message.mentions.users.first()
    const parts = message.content.trim().split(/\s+/)
    const levelArg = parts[parts.length - 1]
    const level = Number.parseInt(levelArg ?? '', 10)

    if (!user || Number.isNaN(level) || level < 0) {
      await message.reply({ embeds: [errorEmbed('Usage', 'setlevel @user <level>')] })
      return
    }

    const locale = await container.config.getLocale(message.guildId)
    await container.leveling.setLevel(message.guildId, user.id, level)

    const member = await message.guild.members.fetch(user.id).catch(() => null)
    if (member) {
      await syncLevelRoles(container.leveling, member, level, STACK_ROLES).catch(() => undefined)
    }

    container.api?.hub.broadcast('levels', 'level_set', {
      guildId: message.guildId,
      userId: user.id,
      level,
      ts: Date.now(),
    })

    await message.reply({
      embeds: [successEmbed(t(locale, 'common.success'), `Set ${user.username} to level ${level}.`)],
    })
  }
}
