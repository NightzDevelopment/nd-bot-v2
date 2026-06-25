/**
 * `/rank` (alias `level`): show a member's level, XP, and rank as a card embed.
 *
 * Works as a slash command (optional `user` option) or a message command
 * (optional mention). Defaults to the caller.
 */
import { Command, container } from '@sapphire/framework'
import type { Message, User } from 'discord.js'
import { t } from '@nd/i18n'
import { errorEmbed } from '../../lib/embed.ts'
import { buildRankCard } from '../../features/levels/card.ts'

export class RankCommand extends Command {
  public constructor(context: Command.LoaderContext, options: Command.Options) {
    super(context, {
      ...options,
      name: 'rank',
      aliases: ['level'],
      description: 'Show your level, XP, and rank, or those of another member.',
    })
  }

  public override registerApplicationCommands(registry: Command.Registry): void {
    registry.registerChatInputCommand((builder) =>
      builder
        .setName(this.name)
        .setDescription(this.description)
        .addUserOption((opt) =>
          opt.setName('user').setDescription('The member to look up.').setRequired(false),
        ),
    )
  }

  public override async chatInputRun(
    interaction: Command.ChatInputCommandInteraction,
  ): Promise<void> {
    if (!interaction.inGuild()) {
      await interaction.reply({ embeds: [errorEmbed('Server only', 'Use this in a server.')], ephemeral: true })
      return
    }
    const target = interaction.options.getUser('user') ?? interaction.user
    await interaction.deferReply()
    const embed = await this.render(interaction.guildId, target)
    await interaction.editReply({ embeds: [embed] })
  }

  public override async messageRun(message: Message): Promise<void> {
    if (!message.inGuild()) return
    const target = message.mentions.users.first() ?? message.author
    const embed = await this.render(message.guildId, target)
    await message.reply({ embeds: [embed] })
  }

  private async render(guildId: string, user: User) {
    const locale = await container.config.getLocale(guildId)
    const result = await container.leveling.getRank(guildId, user.id)

    if (!result) {
      return errorEmbed(t(locale, 'levels.leaderboard.empty'), `${user.username} has not earned any XP yet.`)
    }

    return buildRankCard({
      displayName: user.username,
      avatarUrl: user.displayAvatarURL({ size: 128 }),
      xp: result.xp,
      level: result.level,
      rank: result.rank,
      total: result.total,
      messages: result.messages,
    })
  }
}
