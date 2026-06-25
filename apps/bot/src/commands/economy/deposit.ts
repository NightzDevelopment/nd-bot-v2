import { Args, Command } from '@sapphire/framework'
import type { Message } from 'discord.js'
import { t } from '@nd/i18n'
import type { Locale } from '@nd/core'
import { errorEmbed, successEmbed } from '../../lib/embed.ts'
import { economyEnabled, economyService, money } from '../../features/economy/shared.ts'
import { ALL, parseAmountOrAll } from '../../features/economy/parse.ts'

export class DepositCommand extends Command {
  public constructor(context: Command.LoaderContext, options: Command.Options) {
    super(context, {
      ...options,
      name: 'deposit',
      description: 'Move coins from your wallet into the bank.',
      aliases: ['dep'],
    })
  }

  public override registerApplicationCommands(registry: Command.Registry): void {
    registry.registerChatInputCommand((builder) =>
      builder
        .setName(this.name)
        .setDescription(this.description)
        .addStringOption((opt) =>
          opt
            .setName('amount')
            .setDescription('How much to deposit, or "all".')
            .setRequired(true),
        ),
    )
  }

  public override async chatInputRun(
    interaction: Command.ChatInputCommandInteraction,
  ): Promise<void> {
    if (!interaction.inGuild() || !interaction.guildId) {
      await interaction.reply({ embeds: [errorEmbed('Guild only', t('en', 'common.guild_only'))], ephemeral: true })
      return
    }
    const raw = interaction.options.getString('amount', true)
    await interaction.reply({ embeds: [await this.build(interaction.guildId, interaction.user.id, raw)] })
  }

  public override async messageRun(message: Message, args: Args): Promise<void> {
    if (!message.inGuild()) {
      await message.reply({ embeds: [errorEmbed('Guild only', t('en', 'common.guild_only'))] })
      return
    }
    const raw = await args.pick('string').catch(() => null)
    await message.reply({ embeds: [await this.build(message.guildId, message.author.id, raw)] })
  }

  private async build(guildId: string, userId: string, raw: string | null) {
    const locale: Locale = await this.container.config.getLocale(guildId)
    if (!(await economyEnabled(guildId))) {
      return errorEmbed('Economy disabled', t(locale, 'common.disabled'))
    }
    const parsed = parseAmountOrAll(raw)
    if (parsed === null) {
      return errorEmbed('Deposit', t(locale, 'common.invalid_amount'))
    }
    const amount = parsed === ALL ? null : parsed
    const result = await economyService().deposit(guildId, userId, amount)
    if (!result.ok) {
      return errorEmbed('Deposit', t(locale, 'common.invalid_amount'))
    }
    return successEmbed('Deposit', t(locale, 'economy.deposit.success', { amount: money(locale, result.moved) }))
      .addFields(
        { name: 'Wallet', value: money(locale, result.wallet), inline: true },
        { name: 'Bank', value: money(locale, result.bank), inline: true },
      )
  }
}
