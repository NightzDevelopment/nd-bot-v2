/**
 * `/suggest` - members submit a suggestion, persisted to the suggestions table.
 *
 * The suggestion is posted as an embed with Approve and Deny buttons that staff
 * (Manage Server) press. The button handler lives in
 * `listeners/community/interactionCreate.ts`; the customIds are defined on the
 * CommunityService so both sides agree on the wire format.
 */
import { Command } from '@sapphire/framework'
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  MessageFlags,
  type Message,
  type TextChannel,
} from 'discord.js'
import { t } from '@nd/i18n'
import { brandEmbed, errorEmbed } from '../../lib/embed.ts'
import { CUSTOM_ID } from '../../features/community/service.ts'

export class SuggestCommand extends Command {
  public constructor(context: Command.LoaderContext, options: Command.Options) {
    super(context, {
      ...options,
      name: 'suggest',
      description: 'Submit a suggestion for the server staff to review.',
    })
  }

  public override registerApplicationCommands(registry: Command.Registry): void {
    registry.registerChatInputCommand((builder) =>
      builder
        .setName(this.name)
        .setDescription(this.description)
        .addStringOption((opt) =>
          opt
            .setName('content')
            .setDescription('Your suggestion.')
            .setRequired(true)
            .setMaxLength(1000),
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
    const content = interaction.options.getString('content', true)

    const channel = interaction.channel
    if (!channel || channel.type !== ChannelType.GuildText) {
      await interaction.reply({
        embeds: [errorEmbed(t(locale, 'common.guild_only'))],
        flags: MessageFlags.Ephemeral,
      })
      return
    }

    // Persist first so we have the numeric id to label the post.
    const suggestion = await this.container.community.createSuggestion({
      guildId: interaction.guildId,
      userId: interaction.user.id,
      content,
      messageId: null,
    })

    const embed = brandEmbed({
      tone: 'primary',
      title: `Suggestion #${suggestion.id}`,
      description: content,
      exactFooter: `Submitted by ${interaction.user.tag} | Open`,
    })

    const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`${CUSTOM_ID.suggestApprove}:${suggestion.id}`)
        .setStyle(ButtonStyle.Success)
        .setLabel('Approve'),
      new ButtonBuilder()
        .setCustomId(`${CUSTOM_ID.suggestDeny}:${suggestion.id}`)
        .setStyle(ButtonStyle.Danger)
        .setLabel('Deny'),
    )

    const message = await (channel as TextChannel).send({ embeds: [embed], components: [buttons] })
    await this.container.community.attachSuggestionMessage(suggestion.id, message.id)

    await interaction.reply({
      embeds: [brandEmbed({ tone: 'success', title: t(locale, 'community.suggestion.created', { id: suggestion.id }) })],
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
          description: 'Run /suggest to submit a suggestion.',
        }),
      ],
    })
  }
}
