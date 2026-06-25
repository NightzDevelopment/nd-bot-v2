/**
 * `/levels` (aliases `leaderboard`, `lb`, `top`): the XP leaderboard.
 *
 * Lists the top members by XP for the guild. Slash command takes an optional
 * `page` to paginate in blocks of ten.
 */
import { Command, container } from '@sapphire/framework'
import type { Guild, Message } from 'discord.js'
import { t } from '@nd/i18n'
import { brandEmbed } from '../../lib/embed.ts'
import { formatXp } from '../../features/levels/card.ts'

const PAGE_SIZE = 10

export class LeaderboardCommand extends Command {
  public constructor(context: Command.LoaderContext, options: Command.Options) {
    super(context, {
      ...options,
      name: 'levels',
      aliases: ['leaderboard', 'lb', 'top'],
      description: 'Show the server XP leaderboard.',
    })
  }

  public override registerApplicationCommands(registry: Command.Registry): void {
    registry.registerChatInputCommand((builder) =>
      builder
        .setName(this.name)
        .setDescription(this.description)
        .addIntegerOption((opt) =>
          opt.setName('page').setDescription('Page number (10 per page).').setMinValue(1).setRequired(false),
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
    const page = interaction.options.getInteger('page') ?? 1
    await interaction.deferReply()
    const embed = await this.render(interaction.guild, page)
    await interaction.editReply({ embeds: [embed] })
  }

  public override async messageRun(message: Message): Promise<void> {
    if (!message.inGuild()) return
    const arg = message.content.trim().split(/\s+/)[1]
    const page = Math.max(1, Number.parseInt(arg ?? '1', 10) || 1)
    const embed = await this.render(message.guild, page)
    await message.reply({ embeds: [embed] })
  }

  private async render(guild: Guild, page: number) {
    const locale = await container.config.getLocale(guild.id)
    const total = await container.leveling.memberCount(guild.id)
    const pages = Math.max(1, Math.ceil(total / PAGE_SIZE))
    const safePage = Math.min(Math.max(1, page), pages)
    const offset = (safePage - 1) * PAGE_SIZE

    const rows = await container.leveling.leaderboard(guild.id, PAGE_SIZE, offset)

    const embed = brandEmbed({
      tone: 'primary',
      title: t(locale, 'levels.leaderboard.title'),
      exactFooter: `Page ${safePage} of ${pages} | ${total} ranked`,
    })

    if (rows.length === 0) {
      embed.setDescription(t(locale, 'levels.leaderboard.empty'))
      return embed
    }

    const lines = await Promise.all(
      rows.map(async (row, i) => {
        const rank = offset + i + 1
        const name = await this.resolveName(guild, row.userId)
        return t(locale, 'levels.leaderboard.row', {
          rank,
          user: name,
          level: row.level,
          xp: formatXp(row.xp),
        })
      }),
    )

    embed.setDescription(lines.join('\n'))
    return embed
  }

  /** Prefer a display name from cache, fall back to a mention. */
  private async resolveName(guild: Guild, userId: string): Promise<string> {
    const cached = guild.members.cache.get(userId)
    if (cached) return cached.displayName
    const member = await guild.members.fetch(userId).catch(() => null)
    return member?.displayName ?? `<@${userId}>`
  }
}
