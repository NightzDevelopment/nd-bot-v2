/**
 * Automod guildMemberUpdate listener.
 *
 * Re-runs the suspicious name/avatar quarantine scan when a member changes their
 * username, display name, or nickname, catching members who rename to a scam
 * pattern after joining. Only rescans when the relevant fields actually change.
 */
import { Events, Listener } from '@sapphire/framework'
import type { GuildMember, PartialGuildMember } from 'discord.js'
import { resolveAutomodSettings } from '../../features/automod/config.ts'

export class AutomodMemberUpdateListener extends Listener<typeof Events.GuildMemberUpdate> {
  public constructor(context: Listener.LoaderContext, options: Listener.Options) {
    super(context, { ...options, event: Events.GuildMemberUpdate })
  }

  public override async run(
    oldMember: GuildMember | PartialGuildMember,
    newMember: GuildMember,
  ): Promise<void> {
    if (newMember.user.bot) return

    const nameChanged =
      oldMember.nickname !== newMember.nickname ||
      oldMember.user.username !== newMember.user.username ||
      oldMember.displayName !== newMember.displayName
    if (!nameChanged) return

    const settings = await resolveAutomodSettings(newMember.guild.id)
    if (!settings.enabled) return

    await this.container.automod.scanMember(newMember, settings)
  }
}
