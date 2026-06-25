/**
 * Automod guildMemberAdd listener.
 *
 * Feeds raid detection (join surge -> mod alert) and runs the suspicious
 * name/avatar quarantine scan on every new member. Sapphire auto loads this.
 */
import { Events, Listener } from '@sapphire/framework'
import type { GuildMember } from 'discord.js'
import { resolveAutomodSettings } from '../../features/automod/config.ts'

export class AutomodMemberAddListener extends Listener<typeof Events.GuildMemberAdd> {
  public constructor(context: Listener.LoaderContext, options: Listener.Options) {
    super(context, { ...options, event: Events.GuildMemberAdd })
  }

  public override async run(member: GuildMember): Promise<void> {
    if (member.user.bot) return
    const settings = await resolveAutomodSettings(member.guild.id)
    if (!settings.enabled) return

    await this.container.automod.onJoin(member.guild, settings)
    await this.container.automod.scanMember(member, settings)
  }
}
