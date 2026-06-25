/**
 * `/poll create` - reaction based polls persisted to the polls table.
 *
 * The bot posts an embed listing lettered options, reacts with one regional
 * indicator per option, and (when a duration is given) stores `endsAt` so the
 * community resume loop closes and tallies the poll automatically. Votes live in
 * the message reactions, so they survive restarts with no extra state.
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
import { brandEmbed, errorEmbed } from '../../lib/embed.ts'
import { POLL_LETTER_EMOJIS } from '../../features/community/service.ts'

const MAX_OPTIONS = POLL_LETTER_EMOJIS.length

/** Parse a duration like "30m", "2h", "1d" into milliseconds, or null. */
function parseDuration(input: string | null): number | null {
  if (!input) return null
  const match = /^(\d+)\s*(s|m|h|d)$/i.exec(input.trim())
  if (!match) return null
  const value = Number(match[1])
  const unit = (match[2] ?? '').toLowerCase()
  const factor = unit === 's' ? 1000 : unit === 'm' ? 60_000 : unit === 'h' ? 3_600_000 : 86_400_000
  return value * factor
}

export class PollCommand extends Command {
  public constructor(context: Command.LoaderContext, options: Command.Options) {
    super(context, {
      ...options,
      name: 'poll',
      description: 'Create a poll members can vote on with reactions.',
    })
  }

  public override registerApplicationCommands(registry: Command.Registry): void {
    registry.registerChatInputCommand((builder) =>
      builder
        .setName(this.name)
        .setDescription(this.description)
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages.toString())
        .addSubcommand((sub) =>
          sub
            .setName('create')
            .setDescription('Create a poll.')
            .addStringOption((opt) =>
              opt.setName('question').setDescription('The poll question.').setRequired(true),
            )
            .addStringOption((opt) =>
              opt
                .setName('options')
                .setDescription('Options separated by a vertical bar, for example: Red | Green | Blue')
                .setRequired(true),
            )
            .addStringOption((opt) =>
              opt
                .setName('duration')
                .setDescription('Optional auto close time, for example 30m, 2h, 1d.')
                .setRequired(false),
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

    const locale = await this.container.config.getLocale(interaction.guildId)
    const question = interaction.options.getString('question', true)
    const rawOptions = interaction.options.getString('options', true)
    const durationMs = parseDuration(interaction.options.getString('duration'))

    const options = rawOptions
      .split('|')
      .map((part) => part.trim())
      .filter((part) => part.length > 0)
      .slice(0, MAX_OPTIONS)

    if (options.length < 2) {
      await interaction.reply({
        embeds: [errorEmbed(t(locale, 'community.poll.too_few_options'))],
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

    const endsAt = durationMs ? Date.now() + durationMs : null
    const embed = this.buildPollEmbed(question, options, endsAt)

    await interaction.reply({
      content: t(locale, 'community.poll.created', { question }),
      flags: MessageFlags.Ephemeral,
    })

    const message = await (channel as TextChannel).send({ embeds: [embed] })
    await this.applyReactions(message, options.length)

    await this.container.community.createPoll({
      guildId: interaction.guildId,
      channelId: channel.id,
      messageId: message.id,
      question,
      options,
      endsAt,
    })
  }

  public override async messageRun(message: Message): Promise<void> {
    if (!message.inGuild()) return
    const locale = await this.container.config.getLocale(message.guildId)
    await message.reply({
      embeds: [
        brandEmbed({
          tone: 'neutral',
          title: 'Use the slash command',
          description: 'Run /poll create to start a poll.',
        }),
      ],
    })
    void locale
  }

  private buildPollEmbed(question: string, options: string[], endsAt: number | null) {
    const lines = options.map((option, index) => `${POLL_LETTER_EMOJIS[index]} ${option}`)
    if (endsAt !== null) {
      lines.push('', `Closes <t:${Math.floor(endsAt / 1000)}:R>`)
    }
    return brandEmbed({
      tone: 'primary',
      title: question,
      description: lines.join('\n'),
      footer: 'Poll',
    })
  }

  private async applyReactions(message: Message, optionCount: number): Promise<void> {
    for (let i = 0; i < optionCount; i++) {
      const emoji = POLL_LETTER_EMOJIS[i]
      if (emoji === undefined) continue
      await message.react(emoji).catch(() => null)
    }
  }
}
