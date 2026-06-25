import { Args, Command } from '@sapphire/framework'
import type { Message } from 'discord.js'
import { t } from '@nd/i18n'
import type { Locale } from '@nd/core'
import { errorEmbed, successEmbed } from '../../lib/embed.ts'
import { economyEnabled, economyService, money } from '../../features/economy/shared.ts'
import { parseAmount } from '../../features/economy/parse.ts'

export class BuyCommand extends Command {
  public constructor(context: Command.LoaderContext, options: Command.Options) {
    super(context, {
      ...options,
      name: 'buy',
      description: 'Buy an item from the shop by its key.',
    })
  }

  public override registerApplicationCommands(registry: Command.Registry): void {
    registry.registerChatInputCommand((builder) =>
      builder
        .setName(this.name)
        .setDescription(this.description)
        .addStringOption((opt) => opt.setName('item').setDescription('The item key.').setRequired(true))
        .addIntegerOption((opt) =>
          opt.setName('quantity').setDescription('How many to buy.').setRequired(false).setMinValue(1),
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
    const key = interaction.options.getString('item', true)
    const qty = interaction.options.getInteger('quantity') ?? 1
    await interaction.reply({ embeds: [await this.build(interaction.guildId, interaction.user.id, key, qty)] })
  }

  public override async messageRun(message: Message, args: Args): Promise<void> {
    if (!message.inGuild()) {
      await message.reply({ embeds: [errorEmbed('Guild only', t('en', 'common.guild_only'))] })
      return
    }
    const locale: Locale = await this.container.config.getLocale(message.guildId)
    const key = await args.pick('string').catch(() => null)
    if (!key) {
      await message.reply({ embeds: [errorEmbed('Buy', t(locale, 'economy.shop.not_found'))] })
      return
    }
    const qty = parseAmount(await args.pick('string').catch(() => null)) ?? 1
    await message.reply({ embeds: [await this.build(message.guildId, message.author.id, key, qty)] })
  }

  private async build(guildId: string, userId: string, key: string, qty: number) {
    const locale: Locale = await this.container.config.getLocale(guildId)
    if (!(await economyEnabled(guildId))) {
      return errorEmbed('Economy disabled', t(locale, 'common.disabled'))
    }
    const service = economyService()
    const item = await service.findItem(guildId, key)
    if (!item) {
      return errorEmbed('Buy', t(locale, 'economy.shop.not_found'))
    }
    const result = await service.buy(guildId, userId, item, qty)
    if (!result.ok) {
      if (result.reason === 'funds') {
        return errorEmbed(
          'Buy',
          t(locale, 'economy.insufficient_funds', { amount: money(locale, result.shortBy ?? 0) }),
        )
      }
      return errorEmbed('Buy', t(locale, 'common.not_found'))
    }
    const label = qty > 1 ? `${qty}x ${item.name}` : item.name
    return successEmbed(
      'Buy',
      t(locale, 'economy.shop.bought', { item: label, amount: money(locale, result.spent) }),
    ).addFields({ name: 'Wallet', value: money(locale, result.wallet), inline: true })
  }
}
