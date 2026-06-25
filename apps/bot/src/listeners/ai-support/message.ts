/**
 * messageCreate listener for ai-support channels.
 *
 * When a member sends a message in a configured AI support channel, the
 * assistant answers automatically through the shared AiSupportService (agent
 * loop + live tools + RAG + memory). Bot messages, commands (prefixed messages),
 * and empty content are ignored. Sapphire auto loads this file.
 */
import { Events, Listener, container } from '@sapphire/framework'
import type { Message } from 'discord.js'
import { errorEmbed } from '../../lib/embed.ts'

/** Minimum question length to bother answering; avoids reacting to stray tokens. */
const MIN_LENGTH = 3

export class AiSupportMessageListener extends Listener<typeof Events.MessageCreate> {
  public constructor(context: Listener.LoaderContext, options: Listener.Options) {
    super(context, { ...options, event: Events.MessageCreate })
  }

  public override async run(message: Message): Promise<void> {
    if (message.author.bot) return
    if (!message.inGuild()) return

    const content = message.content.trim()
    if (content.length < MIN_LENGTH) return

    const service = container.aiSupport
    if (!service) return

    const guildId = message.guildId
    let isAiChannel: boolean
    try {
      isAiChannel = await service.isAiChannel(guildId, message.channelId)
    } catch (err) {
      container.logger.warn({ err }, 'ai-support listener: channel check failed')
      return
    }
    if (!isAiChannel) return

    if (message.channel.isSendable()) await message.channel.sendTyping().catch(() => {})

    try {
      const result = await service.ask({
        guildId,
        channelId: message.channelId,
        userId: message.author.id,
        authorName: message.author.username,
        question: content,
      })
      await message.reply({ content: result.answer, allowedMentions: { repliedUser: true } })
    } catch (err) {
      container.logger.error({ err }, 'ai-support listener: agent run failed')
      await message
        .reply({ embeds: [errorEmbed('I could not answer that right now. Please try again shortly.')] })
        .catch(() => {})
    }
  }
}
