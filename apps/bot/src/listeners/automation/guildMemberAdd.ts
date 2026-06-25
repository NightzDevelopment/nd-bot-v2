/**
 * Feeds member-join events into the automation engine for memberJoin rules.
 */
import { Events, Listener } from '@sapphire/framework'
import type { GuildMember } from 'discord.js'
import type { EventContext } from '../../features/automation/engine.ts'

export class AutomationMemberAddListener extends Listener<typeof Events.GuildMemberAdd> {
  public constructor(context: Listener.LoaderContext, options: Listener.Options) {
    super(context, { ...options, event: Events.GuildMemberAdd })
  }

  public override async run(member: GuildMember): Promise<void> {
    if (member.user.bot) return
    const service = this.container.automation
    if (!service) return

    const settings = await this.container.config.getSettings(member.guild.id)
    if (!settings.modules.automation.enabled) return

    const ctx: EventContext = {
      guild: member.guild,
      member,
      channel: null,
      content: '',
      match: '',
    }

    await service.handleMemberJoin(ctx)
  }
}
