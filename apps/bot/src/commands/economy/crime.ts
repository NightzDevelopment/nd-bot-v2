import { Command } from '@sapphire/framework'
import type { Message } from 'discord.js'
import { t } from '@nd/i18n'
import type { Locale } from '@nd/core'
import { errorEmbed, successEmbed, warningEmbed } from '../../lib/embed.ts'
import { economyEnabled, economyService, formatDuration, money } from '../../features/economy/shared.ts'

export class CrimeCommand extends Command {
  public constructor(context: Command.LoaderContext, options: Command.Options) {
    super(context, {
      ...options,
      name: 'crime',
      description: 'Commit a crime for a high-risk, high-reward payout.',
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
    await interaction.reply({ embeds: [await this.build(interaction.guildId, interaction.user.id)] })
  }

  public override async messageRun(message: Message): Promise<void> {
    if (!message.inGuild()) {
      await message.reply({ embeds: [errorEmbed('Guild only', t('en', 'common.guild_only'))] })
      return
    }
    await message.reply({ embeds: [await this.build(message.guildId, message.author.id)] })
  }

  private async build(guildId: string, userId: string) {
    const locale: Locale = await this.container.config.getLocale(guildId)
    if (!(await economyEnabled(guildId))) {
      return errorEmbed('Economy disabled', t(locale, 'common.disabled'))
    }
    const result = await economyService().crime(guildId, userId)
    if (!result.ok) {
      return warningEmbed('Crime', t(locale, 'economy.crime.cooldown', { time: formatDuration(result.retryInMs) }))
    }
    if (result.success) {
      return successEmbed('Crime', t(locale, 'economy.crime.success', { amount: money(locale, result.amount) }))
        .addFields({ name: 'New wallet', value: money(locale, result.wallet), inline: true })
    }
    return errorEmbed('Crime', t(locale, 'economy.crime.fail', { amount: money(locale, result.amount) }))
      .addFields({ name: 'New wallet', value: money(locale, result.wallet), inline: true })
  }
}
