import { Args, Command } from '@sapphire/framework'
import type { Message, User } from 'discord.js'
import { t } from '@nd/i18n'
import type { Locale } from '@nd/core'
import { errorEmbed, successEmbed } from '../../lib/embed.ts'
import { economyEnabled, economyService, money } from '../../features/economy/shared.ts'
import { parseAmount } from '../../features/economy/parse.ts'

export class PayCommand extends Command {
  public constructor(context: Command.LoaderContext, options: Command.Options) {
    super(context, {
      ...options,
      name: 'pay',
      description: 'Transfer coins from your wallet to another member.',
    })
  }

  public override registerApplicationCommands(registry: Command.Registry): void {
    registry.registerChatInputCommand((builder) =>
      builder
        .setName(this.name)
        .setDescription(this.description)
        .addUserOption((opt) => opt.setName('user').setDescription('Who to pay.').setRequired(true))
        .addIntegerOption((opt) =>
          opt.setName('amount').setDescription('How much to pay.').setRequired(true).setMinValue(1),
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
    const target = interaction.options.getUser('user', true)
    const amount = interaction.options.getInteger('amount', true)
    await interaction.reply({ embeds: [await this.build(interaction.guildId, interaction.user.id, target, amount)] })
  }

  public override async messageRun(message: Message, args: Args): Promise<void> {
    if (!message.inGuild()) {
      await message.reply({ embeds: [errorEmbed('Guild only', t('en', 'common.guild_only'))] })
      return
    }
    const locale: Locale = await this.container.config.getLocale(message.guildId)
    const target = message.mentions.users.first()
    if (!target) {
      await message.reply({ embeds: [errorEmbed('Pay', t(locale, 'common.member_not_found'))] })
      return
    }
    const raw = await args.pick('string').catch(() => null)
    const amount = parseAmount(raw)
    if (amount === null || amount <= 0) {
      await message.reply({ embeds: [errorEmbed('Pay', t(locale, 'common.invalid_amount'))] })
      return
    }
    await message.reply({ embeds: [await this.build(message.guildId, message.author.id, target, amount)] })
  }

  private async build(guildId: string, fromId: string, target: User, amount: number) {
    const locale: Locale = await this.container.config.getLocale(guildId)
    if (!(await economyEnabled(guildId))) {
      return errorEmbed('Economy disabled', t(locale, 'common.disabled'))
    }
    if (target.id === fromId) {
      return errorEmbed('Pay', t(locale, 'economy.pay.self'))
    }
    if (target.bot) {
      return errorEmbed('Pay', t(locale, 'common.member_not_found'))
    }
    const result = await economyService().pay(guildId, fromId, target.id, amount)
    if (!result.ok) {
      return errorEmbed(
        'Pay',
        t(locale, 'economy.insufficient_funds', { amount: money(locale, result.shortBy) }),
      )
    }
    return successEmbed(
      'Pay',
      t(locale, 'economy.pay.success', { amount: money(locale, amount), user: target.toString() }),
    ).addFields({ name: 'Your wallet', value: money(locale, result.fromWallet), inline: true })
  }
}
