/**
 * Command error listeners.
 *
 * Catches errors thrown by slash and message command handlers, logs them with
 * context, and shows the user a generic branded error embed so an internal
 * failure never leaks a stack trace. Two listeners share one base so each maps
 * to a distinct Sapphire event.
 *
 * Phase B note: feature commands should throw `UserError` for expected,
 * user facing failures (handled by `*CommandDenied` events, not here). This
 * listener is the catch all for unexpected exceptions.
 */
import {
  type ChatInputCommandErrorPayload,
  Events,
  Listener,
  type MessageCommandErrorPayload,
} from '@sapphire/framework'
import { errorEmbed } from '../lib/embed.ts'

const GENERIC = errorEmbed(
  'Something went wrong',
  'That command hit an unexpected error. The team has been notified.',
)

export class ChatInputCommandErrorListener extends Listener<typeof Events.ChatInputCommandError> {
  public constructor(context: Listener.LoaderContext, options: Listener.Options) {
    super(context, { ...options, event: Events.ChatInputCommandError })
  }

  public override async run(error: unknown, payload: ChatInputCommandErrorPayload): Promise<void> {
    const { interaction, command } = payload
    this.container.logger.error(
      { err: error, command: command.name, guildId: interaction.guildId, userId: interaction.user.id },
      'chat input command error',
    )

    try {
      if (interaction.deferred || interaction.replied) {
        await interaction.followUp({ embeds: [GENERIC], ephemeral: true })
      } else {
        await interaction.reply({ embeds: [GENERIC], ephemeral: true })
      }
    } catch (replyError) {
      this.container.logger.error({ err: replyError }, 'failed to send error reply')
    }
  }
}

export class MessageCommandErrorListener extends Listener<typeof Events.MessageCommandError> {
  public constructor(context: Listener.LoaderContext, options: Listener.Options) {
    super(context, { ...options, event: Events.MessageCommandError })
  }

  public override async run(error: unknown, payload: MessageCommandErrorPayload): Promise<void> {
    const { message, command } = payload
    this.container.logger.error(
      { err: error, command: command.name, guildId: message.guildId, userId: message.author.id },
      'message command error',
    )

    try {
      if (message.channel.isSendable()) {
        await message.reply({ embeds: [GENERIC] })
      }
    } catch (replyError) {
      this.container.logger.error({ err: replyError }, 'failed to send error reply')
    }
  }
}
