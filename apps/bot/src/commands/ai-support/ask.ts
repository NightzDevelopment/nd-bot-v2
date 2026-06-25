/**
 * `/ask` command: ask the agentic AI support assistant a question.
 *
 * Routes through the shared AiSupportService, which runs the @nd/ai agent loop
 * with live data tools, RAG over the knowledge base, and per user memory. Works
 * as a slash command and as a prefixed message command. Replies through the
 * branded embed helper, never raw strings, and uses no emojis.
 */
import { type Args, Command, container } from '@sapphire/framework'
import type { Message } from 'discord.js'
import { t } from '@nd/i18n'
import { brandEmbed, errorEmbed } from '../../lib/embed.ts'

const MAX_QUESTION_LENGTH = 1500

export class AskCommand extends Command {
  public constructor(context: Command.LoaderContext, options: Command.Options) {
    super(context, {
      ...options,
      name: 'ask',
      description: 'Ask the AI support assistant a question about the server, rules, FiveM, or the store.',
    })
  }

  public override registerApplicationCommands(registry: Command.Registry): void {
    registry.registerChatInputCommand((builder) =>
      builder
        .setName(this.name)
        .setDescription(this.description)
        .addStringOption((option) =>
          option
            .setName('question')
            .setDescription('What would you like to ask?')
            .setRequired(true)
            .setMaxLength(MAX_QUESTION_LENGTH),
        ),
    )
  }

  public override async chatInputRun(interaction: Command.ChatInputCommandInteraction): Promise<void> {
    const guildId = interaction.guildId
    if (!guildId) {
      const locale = await container.config.getLocale('0')
      await interaction.reply({ embeds: [errorEmbed(t(locale, 'common.guild_only'))], ephemeral: true })
      return
    }

    const locale = await container.config.getLocale(guildId)
    const service = container.aiSupport

    if (!service || !(await service.isEnabled(guildId))) {
      await interaction.reply({ embeds: [errorEmbed(t(locale, 'common.disabled'))], ephemeral: true })
      return
    }

    const question = interaction.options.getString('question', true)
    await interaction.deferReply()

    try {
      const result = await service.ask({
        guildId,
        channelId: interaction.channelId,
        userId: interaction.user.id,
        authorName: interaction.user.username,
        question,
      })
      await interaction.editReply({ embeds: [this.answerEmbed(question, result.answer)] })
    } catch (err) {
      container.logger.error({ err }, 'ask: agent run failed')
      await interaction.editReply({ embeds: [errorEmbed(t(locale, 'common.error'))] })
    }
  }

  public override async messageRun(message: Message, args: Args): Promise<void> {
    const guildId = message.guildId
    if (!guildId) {
      const locale = await container.config.getLocale('0')
      await message.reply({ embeds: [errorEmbed(t(locale, 'common.guild_only'))] })
      return
    }

    const locale = await container.config.getLocale(guildId)
    const service = container.aiSupport

    if (!service || !(await service.isEnabled(guildId))) {
      await message.reply({ embeds: [errorEmbed(t(locale, 'common.disabled'))] })
      return
    }

    const question = await args.rest('string').catch(() => '')
    if (!question.trim()) {
      await message.reply({ embeds: [errorEmbed(t(locale, 'common.missing_argument', { name: 'question' }))] })
      return
    }

    if (message.channel.isSendable()) await message.channel.sendTyping().catch(() => {})

    try {
      const result = await service.ask({
        guildId,
        channelId: message.channelId,
        userId: message.author.id,
        authorName: message.author.username,
        question,
      })
      await message.reply({ embeds: [this.answerEmbed(question, result.answer)] })
    } catch (err) {
      container.logger.error({ err }, 'ask: agent run failed')
      await message.reply({ embeds: [errorEmbed(t(locale, 'common.error'))] })
    }
  }

  private answerEmbed(question: string, answer: string) {
    const trimmedQuestion = question.length > 240 ? `${question.slice(0, 237)}...` : question
    return brandEmbed({
      tone: 'primary',
      title: 'AI Support',
      description: answer,
      footer: trimmedQuestion,
    })
  }
}
