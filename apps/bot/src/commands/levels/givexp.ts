/**
 * `/givexp` (alias `takexp` via negative amount): add or remove XP. Manage Guild.
 *
 * A positive amount grants XP, a negative amount removes it (floored at zero).
 * Re syncs level roles when the change crosses a level and broadcasts to the
 * dashboard.
 */
import { Command, container } from '@sapphire/framework'
import { type Message, PermissionFlagsBits } from 'discord.js'
import { t } from '@nd/i18n'
import { errorEmbed, successEmbed } from '../../lib/embed.ts'
import { syncLevelRoles } from '../../features/levels/roles.ts'

const STACK_ROLES = true

export class GiveXpCommand extends Command {
  public constructor(context: Command.LoaderContext, options: Command.Options) {
    super(context, {
      ...options,
      name: 'givexp',
      aliases: ['addxp'],
      description: 'Give or remove XP from a member.',
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
          opt
            .setName('amount')
            .setDescription('XP to add (use a negative number to remove).')
            .setRequired(true),
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
    const amount = interaction.options.getInteger('amount', true)
    if (amount === 0) {
      await interaction.reply({ embeds: [errorEmbed(t('en', 'common.invalid_amount'))], ephemeral: true })
      return
    }

    const locale = await container.config.getLocale(interaction.guildId)
    const result = await container.leveling.addXp(interaction.guildId, user.id, amount)

    if (result.leveledUp || result.leveledDown) {
      const member = await interaction.guild.members.fetch(user.id).catch(() => null)
      if (member) {
        await syncLevelRoles(container.leveling, member, result.row.level, STACK_ROLES).catch(() => undefined)
      }
    }

    container.api?.hub.broadcast('levels', 'xp_changed', {
      guildId: interaction.guildId,
      userId: user.id,
      amount,
      xp: result.row.xp,
      level: result.row.level,
      ts: Date.now(),
    })

    const key = amount > 0 ? 'levels.xp_given' : 'levels.xp_taken'
    await interaction.reply({
      embeds: [
        successEmbed(
          t(locale, 'common.success'),
          t(locale, key, { amount: Math.abs(amount), user: user.username }),
        ),
      ],
    })
  }

  public override async messageRun(message: Message): Promise<void> {
    if (!message.inGuild() || !message.guild) return
    const user = message.mentions.users.first()
    const parts = message.content.trim().split(/\s+/)
    const amount = Number.parseInt(parts[parts.length - 1] ?? '', 10)

    if (!user || Number.isNaN(amount) || amount === 0) {
      await message.reply({ embeds: [errorEmbed('Usage', 'givexp @user <amount>')] })
      return
    }

    const locale = await container.config.getLocale(message.guildId)
    const result = await container.leveling.addXp(message.guildId, user.id, amount)

    if (result.leveledUp || result.leveledDown) {
      const member = await message.guild.members.fetch(user.id).catch(() => null)
      if (member) {
        await syncLevelRoles(container.leveling, member, result.row.level, STACK_ROLES).catch(() => undefined)
      }
    }

    container.api?.hub.broadcast('levels', 'xp_changed', {
      guildId: message.guildId,
      userId: user.id,
      amount,
      xp: result.row.xp,
      level: result.row.level,
      ts: Date.now(),
    })

    const key = amount > 0 ? 'levels.xp_given' : 'levels.xp_taken'
    await message.reply({
      embeds: [
        successEmbed(t(locale, 'common.success'), t(locale, key, { amount: Math.abs(amount), user: user.username })),
      ],
    })
  }
}
