/**
 * Feeds guild messages into the automation engine for message-keyword rules.
 * Bots and system messages are ignored. The module toggle gates the whole path.
 */
import { Events, Listener } from '@sapphire/framework'
import type { Message } from 'discord.js'
import type { EventContext } from '../../features/automation/engine.ts'

export class AutomationMessageListener extends Listener<typeof Events.MessageCreate> {
  public constructor(context: Listener.LoaderContext, options: Listener.Options) {
    super(context, { ...options, event: Events.MessageCreate })
  }

  public override async run(message: Message): Promise<void> {
    if (message.author.bot || !message.inGuild()) return
    const service = this.container.automation
    if (!service) return

    const settings = await this.container.config.getSettings(message.guildId)
    if (!settings.modules.automation.enabled) return

    const ctx: EventContext = {
      guild: message.guild,
      member: message.member,
      channel: message.channel,
      content: message.content,
      match: '',
      deleteSource: async () => {
        if (message.deletable) await message.delete().catch(() => undefined)
      },
    }

    await service.handleMessage({ ctx, channelId: message.channelId })
  }
}
