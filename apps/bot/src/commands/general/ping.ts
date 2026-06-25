/**
 * Reference command: `ping`.
 *
 * This is the canonical shape every Phase B feature command follows. It shows:
 *   1. extending `Command` with `Command.Options` set via the `@ApplyOptions`
 *      style constructor super call (plain options here for clarity),
 *   2. registering a slash command in `registerApplicationCommands`,
 *   3. handling both a slash interaction (`chatInputRun`) and a message command
 *      (`messageRun`),
 *   4. replying through the branded embed helper, never with raw strings.
 *
 * Sapphire auto loads this file because it lives under `src/commands`. The
 * `general/` subfolder becomes the command category.
 */
import { Command } from '@sapphire/framework'
import type { Message } from 'discord.js'
import { brandEmbed } from '../../lib/embed.ts'

export class PingCommand extends Command {
  public constructor(context: Command.LoaderContext, options: Command.Options) {
    super(context, {
      ...options,
      name: 'ping',
      description: 'Check whether the bot is responsive and report latency.',
    })
  }

  public override registerApplicationCommands(registry: Command.Registry): void {
    registry.registerChatInputCommand((builder) =>
      builder.setName(this.name).setDescription(this.description),
    )
  }

  public override async chatInputRun(interaction: Command.ChatInputCommandInteraction): Promise<void> {
    const sent = await interaction.reply({ content: 'Pinging...', withResponse: true })
    const roundTrip = sent.interaction.createdTimestamp - interaction.createdTimestamp
    const heartbeat = Math.round(this.container.client.ws.ping)

    await interaction.editReply({
      content: '',
      embeds: [this.buildEmbed(roundTrip, heartbeat)],
    })
  }

  public override async messageRun(message: Message): Promise<void> {
    const sent = await message.reply({ content: 'Pinging...' })
    const roundTrip = sent.createdTimestamp - message.createdTimestamp
    const heartbeat = Math.round(this.container.client.ws.ping)

    await sent.edit({ content: '', embeds: [this.buildEmbed(roundTrip, heartbeat)] })
  }

  private buildEmbed(roundTripMs: number, heartbeatMs: number) {
    const heartbeatText = heartbeatMs < 0 ? 'connecting' : `${heartbeatMs} ms`
    return brandEmbed({
      tone: 'success',
      title: 'Pong',
      description: [`Round trip: ${roundTripMs} ms`, `Gateway heartbeat: ${heartbeatText}`].join('\n'),
    })
  }
}
