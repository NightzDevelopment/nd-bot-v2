import { Command } from '@sapphire/framework'
import type { Message, User } from 'discord.js'
import { t } from '@nd/i18n'
import { brandEmbed, errorEmbed } from '../../lib/embed.ts'
import { economyEnabled, economyService, money } from '../../features/economy/shared.ts'

export class BalanceCommand extends Command {
  public constructor(context: Command.LoaderContext, options: Command.Options) {
    super(context, {
      ...options,
      name: 'balance',
      description: 'Show your wallet and bank balance.',
      aliases: ['bal'],
    })
  }

  public override registerApplicationCommands(registry: Command.Registry): void {
    registry.registerChatInputCommand((builder) =>
      builder
        .setName(this.name)
        .setDescription(this.description)
        .addUserOption((opt) =>
          opt.setName('user').setDescription('Whose balance to view.').setRequired(false),
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
    const target = interaction.options.getUser('user') ?? interaction.user
    await interaction.reply({ embeds: [await this.build(interaction.guildId, target, interaction.user.id)] })
  }

  public override async messageRun(message: Message): Promise<void> {
    if (!message.inGuild()) {
      await message.reply({ embeds: [errorEmbed('Guild only', t('en', 'common.guild_only'))] })
      return
    }
    const target = message.mentions.users.first() ?? message.author
    await message.reply({ embeds: [await this.build(message.guildId, target, message.author.id)] })
  }

  private async build(guildId: string, target: User, invokerId: string) {
    const locale = await this.container.config.getLocale(guildId)
    if (!(await economyEnabled(guildId))) {
      return errorEmbed('Economy disabled', t(locale, 'common.disabled'))
    }
    const acct = await economyService().account(guildId, target.id)
    const isSelf = target.id === invokerId
    const description = isSelf
      ? t(locale, 'economy.balance.self', { wallet: money(locale, acct.wallet), bank: money(locale, acct.bank) })
      : t(locale, 'economy.balance.other', {
          user: target.toString(),
          wallet: money(locale, acct.wallet),
          bank: money(locale, acct.bank),
        })

    return brandEmbed({ tone: 'primary', title: 'Balance', description })
      .addFields(
        { name: 'Wallet', value: money(locale, acct.wallet), inline: true },
        { name: 'Bank', value: money(locale, acct.bank), inline: true },
        { name: 'Net worth', value: money(locale, acct.wallet + acct.bank), inline: true },
      )
  }
}
