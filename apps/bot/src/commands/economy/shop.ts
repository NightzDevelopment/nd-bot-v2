import { Command } from '@sapphire/framework'
import type { Message } from 'discord.js'
import { t } from '@nd/i18n'
import type { Locale } from '@nd/core'
import { brandEmbed, errorEmbed } from '../../lib/embed.ts'
import { economyEnabled, economyService, money } from '../../features/economy/shared.ts'

export class ShopCommand extends Command {
  public constructor(context: Command.LoaderContext, options: Command.Options) {
    super(context, {
      ...options,
      name: 'shop',
      description: 'Browse items available to buy.',
      aliases: ['store'],
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
    const items = await economyService().listShop(guildId)
    if (items.length === 0) {
      return brandEmbed({ tone: 'neutral', title: 'Shop', description: t(locale, 'common.not_found') })
    }
    const embed = brandEmbed({
      tone: 'primary',
      title: 'Shop',
      description: 'Use the item key with buy and sell.',
    })
    for (const item of items.slice(0, 25)) {
      const stock = item.stock === null ? 'unlimited' : `${item.stock} left`
      const desc = item.description ? `${item.description}\n` : ''
      embed.addFields({
        name: `${item.name} (${item.key})`,
        value: `${desc}Price: ${money(locale, item.price)} | Stock: ${stock}`,
        inline: false,
      })
    }
    return embed
  }
}
