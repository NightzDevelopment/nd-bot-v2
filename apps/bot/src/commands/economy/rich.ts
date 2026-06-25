import { Command } from '@sapphire/framework'
import type { Message } from 'discord.js'
import { t } from '@nd/i18n'
import type { Locale } from '@nd/core'
import { brandEmbed, errorEmbed } from '../../lib/embed.ts'
import { economyEnabled, economyService, money } from '../../features/economy/shared.ts'

export class RichCommand extends Command {
  public constructor(context: Command.LoaderContext, options: Command.Options) {
    super(context, {
      ...options,
      name: 'rich',
      description: 'Show the richest members by net worth.',
      aliases: ['baltop', 'leaderboard'],
    })
  }

  public override registerApplicationCommands(registry: Command.Registry): void {
    registry.registerChatInputCommand((builder) =>
      builder.setName(this.name).setDescription(this.description),
    )
  }

  public override async chatInputRun(
    interaction: Command.ChatInputCommandInteraction,
  ): Promise<void> {
    if (!interaction.inGuild() || !interaction.guildId) {
      await interaction.reply({ embeds: [errorEmbed('Guild only', t('en', 'common.guild_only'))], ephemeral: true })
      return
    }
    await interaction.reply({ embeds: [await this.build(interaction.guildId)] })
  }

  public override async messageRun(message: Message): Promise<void> {
    if (!message.inGuild()) {
      await message.reply({ embeds: [errorEmbed('Guild only', t('en', 'common.guild_only'))] })
      return
    }
    await message.reply({ embeds: [await this.build(message.guildId)] })
  }

  private async build(guildId: string) {
    const locale: Locale = await this.container.config.getLocale(guildId)
    if (!(await economyEnabled(guildId))) {
      return errorEmbed('Economy disabled', t(locale, 'common.disabled'))
    }
    const rows = await economyService().leaderboard(guildId)
    if (rows.length === 0) {
      return brandEmbed({ tone: 'neutral', title: 'Richest members', description: t(locale, 'common.not_found') })
    }
    const lines = rows.map((row, i) => `${i + 1}. <@${row.userId}> ${money(locale, row.total)}`)
    return brandEmbed({ tone: 'primary', title: 'Richest members', description: lines.join('\n') })
  }
}
