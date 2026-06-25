/**
 * Feeds reaction-add events into the automation engine for reaction rules.
 * Partials are resolved before dispatch.
 */
import { Events, Listener } from '@sapphire/framework'
import type { MessageReaction, PartialMessageReaction, PartialUser, User } from 'discord.js'
import type { EventContext } from '../../features/automation/engine.ts'

export class AutomationReactionListener extends Listener<typeof Events.MessageReactionAdd> {
  public constructor(context: Listener.LoaderContext, options: Listener.Options) {
    super(context, { ...options, event: Events.MessageReactionAdd })
  }

  public override async run(
    reaction: MessageReaction | PartialMessageReaction,
    user: User | PartialUser,
  ): Promise<void> {
    if (user.bot) return
    const service = this.container.automation
    if (!service) return

    const full = reaction.partial ? await reaction.fetch().catch(() => null) : reaction
    if (!full) return
    const guild = full.message.guild
    if (!guild) return

    const settings = await this.container.config.getSettings(guild.id)
    if (!settings.modules.automation.enabled) return

    const member = await guild.members.fetch(user.id).catch(() => null)
    const channel = full.message.channel.isTextBased() ? full.message.channel : null
    const emoji = full.emoji.id ?? full.emoji.name ?? ''

    const ctx: EventContext = {
      guild,
      member,
      channel,
      content: full.message.content ?? '',
      match: emoji,
    }

    await service.handleReaction({ ctx, emoji, messageId: full.message.id })
  }
}
