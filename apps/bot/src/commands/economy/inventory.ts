import { Command } from '@sapphire/framework'
import type { Message, User } from 'discord.js'
import { t } from '@nd/i18n'
import type { Locale } from '@nd/core'
import { brandEmbed, errorEmbed } from '../../lib/embed.ts'
import { economyEnabled, economyService } from '../../features/economy/shared.ts'

export class InventoryCommand extends Command {
  public constructor(context: Command.LoaderContext, options: Command.Options) {
    super(context, {
      ...options,
      name: 'inventory',
      description: 'Show the items you own.',
      aliases: ['inv'],
    })
  }

  public override registerApplicationCommands(registry: Command.Registry): void {
    registry.registerChatInputCommand((builder) =>
      builder
        .setName(this.name)
        .setDescription(this.description)
        .addUserOption((opt) =>
          opt.setName('user').setDescription('Whose inventory to view.').setRequired(false),
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
    await interaction.reply({ embeds: [await this.build(interaction.guildId, target)] })
  }

  public override async messageRun(message: Message): Promise<void> {
    if (!message.inGuild()) {
      await message.reply({ embeds: [errorEmbed('Guild only', t('en', 'common.guild_only'))] })
      return
    }
    const target = message.mentions.users.first() ?? message.author
    await message.reply({ embeds: [await this.build(message.guildId, target)] })
  }

  private async build(guildId: string, target: User) {
    const locale: Locale = await this.container.config.getLocale(guildId)
    if (!(await economyEnabled(guildId))) {
      return errorEmbed('Economy disabled', t(locale, 'common.disabled'))
    }
    const service = economyService()
    const entries = await service.inventory(guildId, target.id)
    if (entries.length === 0) {
      return brandEmbed({
        tone: 'neutral',
        title: `Inventory: ${target.username}`,
        description: t(locale, 'common.not_found'),
      })
    }
    // Resolve display names from the shop catalog where possible.
    const shop = await service.listShop(guildId)
    const names = new Map(shop.map((item) => [item.key, item.name]))
    const lines = entries.map((entry) => {
      const name = names.get(entry.itemKey) ?? entry.itemKey
      return `${name} (${entry.itemKey}) x${entry.qty}`
    })
    return brandEmbed({
      tone: 'primary',
      title: `Inventory: ${target.username}`,
      description: lines.join('\n'),
    })
  }
}
