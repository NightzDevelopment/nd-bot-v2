/**
 * `/giveaway start | end | reroll`.
 *
 * Entries are stored as a reaction on the giveaway message, so they are durable
 * across restarts and the resume loop can draw winners with no extra state. A
 * giveaway whose endsAt has passed is drawn by the loop in `setupCommunity`;
 * `/giveaway end` just forces that now, and `/giveaway reroll` redraws an ended
 * one excluding nobody by default.
 */
import { Command } from '@sapphire/framework'
import {
  ChannelType,
  MessageFlags,
  PermissionFlagsBits,
  type Message,
  type TextChannel,
} from 'discord.js'
import { t } from '@nd/i18n'
import { brandEmbed, errorEmbed, successEmbed } from '../../lib/embed.ts'
import { GIVEAWAY_EMOJI } from '../../features/community/service.ts'

function parseDuration(input: string): number | null {
  const match = /^(\d+)\s*(s|m|h|d)$/i.exec(input.trim())
  if (!match) return null
  const value = Number(match[1])
  const unit = (match[2] ?? '').toLowerCase()
  const factor = unit === 's' ? 1000 : unit === 'm' ? 60_000 : unit === 'h' ? 3_600_000 : 86_400_000
  return value * factor
}

export class GiveawayCommand extends Command {
  public constructor(context: Command.LoaderContext, options: Command.Options) {
    super(context, {
      ...options,
      name: 'giveaway',
      description: 'Run a giveaway with automatic winner selection.',
    })
  }

  public override registerApplicationCommands(registry: Command.Registry): void {
    registry.registerChatInputCommand((builder) =>
      builder
        .setName(this.name)
        .setDescription(this.description)
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild.toString())
        .addSubcommand((sub) =>
          sub
            .setName('start')
            .setDescription('Start a giveaway.')
            .addStringOption((opt) =>
              opt.setName('prize').setDescription('What is being given away.').setRequired(true),
            )
            .addStringOption((opt) =>
              opt
                .setName('duration')
                .setDescription('How long the giveaway runs, for example 1h, 12h, 2d.')
                .setRequired(true),
            )
            .addIntegerOption((opt) =>
              opt
                .setName('winners')
                .setDescription('Number of winners (default 1).')
                .setMinValue(1)
                .setMaxValue(20)
                .setRequired(false),
            ),
        )
        .addSubcommand((sub) =>
          sub
            .setName('end')
            .setDescription('End a giveaway now and draw winners.')
            .addStringOption((opt) =>
              opt.setName('id').setDescription('The giveaway id.').setRequired(true),
            ),
        )
        .addSubcommand((sub) =>
          sub
            .setName('reroll')
            .setDescription('Reroll the winners of an ended giveaway.')
            .addStringOption((opt) =>
              opt.setName('id').setDescription('The giveaway id.').setRequired(true),
            ),
        ),
    )
  }

  public override async chatInputRun(
    interaction: Command.ChatInputCommandInteraction,
  ): Promise<void> {
    if (!interaction.inGuild() || !interaction.guildId) {
      const locale = await this.container.config.getLocale('0')
      await interaction.reply({
        embeds: [errorEmbed(t(locale, 'common.guild_only'))],
        flags: MessageFlags.Ephemeral,
      })
      return
    }

    const sub = interaction.options.getSubcommand(true)
    if (sub === 'start') return this.start(interaction, interaction.guildId)
    if (sub === 'end') return this.end(interaction, interaction.guildId)
    if (sub === 'reroll') return this.reroll(interaction, interaction.guildId)
  }

  private async start(
    interaction: Command.ChatInputCommandInteraction,
    guildId: string,
  ): Promise<void> {
    const locale = await this.container.config.getLocale(guildId)
    const prize = interaction.options.getString('prize', true)
    const durationRaw = interaction.options.getString('duration', true)
    const winnerCount = interaction.options.getInteger('winners') ?? 1

    const durationMs = parseDuration(durationRaw)
    if (durationMs === null || durationMs <= 0) {
      await interaction.reply({
        embeds: [errorEmbed('Invalid duration', 'Use a value like 1h, 12h, or 2d.')],
        flags: MessageFlags.Ephemeral,
      })
      return
    }

    const channel = interaction.channel
    if (!channel || channel.type !== ChannelType.GuildText) {
      await interaction.reply({
        embeds: [errorEmbed(t(locale, 'common.guild_only'))],
        flags: MessageFlags.Ephemeral,
      })
      return
    }

    const endsAt = Date.now() + durationMs

    await interaction.reply({
      embeds: [
        successEmbed(t(locale, 'community.giveaway.created', { prize, time: `<t:${Math.floor(endsAt / 1000)}:R>` })),
      ],
      flags: MessageFlags.Ephemeral,
    })

    const embed = brandEmbed({
      tone: 'primary',
      title: prize,
      description: [
        t(locale, 'community.giveaway.created', { prize, time: `<t:${Math.floor(endsAt / 1000)}:R>` }),
        '',
        `React with ${GIVEAWAY_EMOJI} to enter.`,
        `Winners: ${winnerCount}`,
        `Hosted by <@${interaction.user.id}>`,
      ].join('\n'),
      footer: 'Giveaway',
    })

    const message = await (channel as TextChannel).send({ embeds: [embed] })
    await message.react(GIVEAWAY_EMOJI).catch(() => null)

    const row = await this.container.community.createGiveaway({
      guildId,
      channelId: channel.id,
      messageId: message.id,
      prize,
      winnerCount,
      hostId: interaction.user.id,
      endsAt,
    })

    // Surface the id so a host can end or reroll it.
    await message
      .edit({ embeds: [brandEmbed({ ...embedOptions(embed), exactFooter: `Giveaway | id ${row.id}` })] })
      .catch(() => null)
  }

  private async end(
    interaction: Command.ChatInputCommandInteraction,
    guildId: string,
  ): Promise<void> {
    const locale = await this.container.config.getLocale(guildId)
    const id = interaction.options.getString('id', true)

    const giveaway = await this.container.community.getGiveaway(id)
    if (!giveaway || giveaway.guildId !== guildId) {
      await interaction.reply({
        embeds: [errorEmbed(t(locale, 'common.not_found'))],
        flags: MessageFlags.Ephemeral,
      })
      return
    }

    const result = await this.container.community.endGiveaway(this.container.client, id)
    if (!result) {
      await interaction.reply({
        embeds: [errorEmbed(t(locale, 'community.giveaway.ended', { prize: giveaway.prize }))],
        flags: MessageFlags.Ephemeral,
      })
      return
    }

    await interaction.reply({
      embeds: [successEmbed(t(locale, 'community.giveaway.ended', { prize: giveaway.prize }))],
      flags: MessageFlags.Ephemeral,
    })
  }

  private async reroll(
    interaction: Command.ChatInputCommandInteraction,
    guildId: string,
  ): Promise<void> {
    const locale = await this.container.config.getLocale(guildId)
    const id = interaction.options.getString('id', true)

    const giveaway = await this.container.community.getGiveaway(id)
    if (!giveaway || giveaway.guildId !== guildId) {
      await interaction.reply({
        embeds: [errorEmbed(t(locale, 'common.not_found'))],
        flags: MessageFlags.Ephemeral,
      })
      return
    }

    const result = await this.container.community.rerollGiveaway(this.container.client, id)
    if (!result || result.winners.length === 0) {
      await interaction.reply({
        embeds: [errorEmbed(t(locale, 'community.giveaway.no_entries'))],
        flags: MessageFlags.Ephemeral,
      })
      return
    }

    const mentions = result.winners.map((winnerId) => `<@${winnerId}>`).join(', ')
    await interaction.reply({
      embeds: [successEmbed(t(locale, 'community.giveaway.rerolled', { prize: giveaway.prize, user: mentions }))],
      flags: MessageFlags.Ephemeral,
    })
  }

  public override async messageRun(message: Message): Promise<void> {
    if (!message.inGuild()) return
    await message.reply({
      embeds: [
        brandEmbed({
          tone: 'neutral',
          title: 'Use the slash command',
          description: 'Run /giveaway start to begin a giveaway.',
        }),
      ],
    })
  }
}

/** Pull the fields back off an embed so we can rebuild it with a new footer. */
function embedOptions(embed: ReturnType<typeof brandEmbed>): {
  tone: 'primary'
  title: string
  description: string
} {
  const data = embed.data
  return {
    tone: 'primary',
    title: data.title ?? '',
    description: data.description ?? '',
  }
}
