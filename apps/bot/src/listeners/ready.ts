/**
 * Ready listener: fires once when the gateway connection is established.
 *
 * Logs the logged in identity and a snapshot of reach (guild and approximate
 * member counts). Sapphire auto loads every file under `src/listeners`.
 */
import { Events, Listener } from '@sapphire/framework'
import type { Client } from 'discord.js'

export class ReadyListener extends Listener<typeof Events.ClientReady> {
  public constructor(context: Listener.LoaderContext, options: Listener.Options) {
    super(context, { ...options, event: Events.ClientReady, once: true })
  }

  public override run(client: Client<true>): void {
    const guildCount = client.guilds.cache.size
    const memberCount = client.guilds.cache.reduce((sum, g) => sum + g.memberCount, 0)

    this.container.logger.info(
      `Ready as ${client.user.tag} (${client.user.id}) | guilds: ${guildCount} | members: ${memberCount}`,
    )
  }
}
