/**
 * `/resetlevels`: wipe level data. Manage Guild only.
 *
 * With a `user` option, resets just that member. Without it, resets the whole
 * guild's leveling data. Broadcasts a `levels_reset` event to the dashboard.
 */
import { Command, container } from '@sapphire/framework'
import { type Message, PermissionFlagsBits } from 'discord.js'
import { t } from '@nd/i18n'
import { successEmbed } from '../../lib/embed.ts'

export class ResetLevelsCommand extends Command {
  public constructor(context: Command.LoaderContext, options: Command.Options) {
    super(context, {
      ...options,
      name: 'resetlevels',
      aliases: ['levelsreset'],
      description: 'Reset leveling data for a member or the whole server.',
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
          opt.setName('user').setDescription('Reset only this member (omit to reset everyone).').setRequired(false),
        ),
    )
  }

  public override async chatInputRun(
    interaction: Command.ChatInputCommandInteraction,
  ): Promise<void> {
    if (!interaction.inGuild()) {
      await interaction.reply({ content: t('en', 'common.guild_only'), ephemeral: true })
      return
    }
    const user = interaction.options.getUser('user')
    const locale = await container.config.getLocale(interaction.guildId)

    if (user) {
      await container.leveling.resetMember(interaction.guildId, user.id)
      container.api?.hub.broadcast('levels', 'levels_reset', {
        guildId: interaction.guildId,
        userId: user.id,
        ts: Date.now(),
      })
      await interaction.reply({
        embeds: [successEmbed(t(locale, 'common.success'), t(locale, 'levels.reset.success', { user: user.username }))],
      })
      return
    }

    await container.leveling.resetGuild(interaction.guildId)
    container.api?.hub.broadcast('levels', 'levels_reset', {
      guildId: interaction.guildId,
      userId: null,
      ts: Date.now(),
    })
    await interaction.reply({
      embeds: [successEmbed(t(locale, 'common.success'), 'Reset leveling data for the whole server.')],
    })
  }

  public override async messageRun(message: Message): Promise<void> {
    if (!message.inGuild()) return
    const user = message.mentions.users.first()
    const locale = await container.config.getLocale(message.guildId)

    if (user) {
      await container.leveling.resetMember(message.guildId, user.id)
      container.api?.hub.broadcast('levels', 'levels_reset', { guildId: message.guildId, userId: user.id, ts: Date.now() })
      await message.reply({
        embeds: [successEmbed(t(locale, 'common.success'), t(locale, 'levels.reset.success', { user: user.username }))],
      })
      return
    }

    await container.leveling.resetGuild(message.guildId)
    container.api?.hub.broadcast('levels', 'levels_reset', { guildId: message.guildId, userId: null, ts: Date.now() })
    await message.reply({
      embeds: [successEmbed(t(locale, 'common.success'), 'Reset leveling data for the whole server.')],
    })
  }
}
