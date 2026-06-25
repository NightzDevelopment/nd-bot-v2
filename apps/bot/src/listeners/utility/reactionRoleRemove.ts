/**
 * messageReactionRemove: strip the bound role when a member removes a reaction.
 *
 * Mirror of the add listener: resolves partials, normalizes the emoji, and
 * removes the mapped role if the member still has it.
 */
import { Events, Listener, container } from '@sapphire/framework'
import { and, eq } from 'drizzle-orm'
import type { MessageReaction, PartialMessageReaction, PartialUser, User } from 'discord.js'
import { getDb, reactionRoles } from '@nd/db'
import { reactionEmojiKey } from '../../features/utility/emoji.ts'

export class ReactionRoleRemoveListener extends Listener<typeof Events.MessageReactionRemove> {
  public constructor(context: Listener.LoaderContext, options: Listener.Options) {
    super(context, { ...options, event: Events.MessageReactionRemove })
  }

  public override async run(
    reaction: MessageReaction | PartialMessageReaction,
    user: User | PartialUser,
  ): Promise<void> {
    if (user.bot) return

    try {
      if (reaction.partial) reaction = await reaction.fetch()
    } catch {
      return
    }

    const guild = reaction.message.guild
    if (!guild) return

    const emojiKey = reactionEmojiKey(reaction.emoji)
    if (!emojiKey) return

    const db = getDb()
    const rows = await db
      .select()
      .from(reactionRoles)
      .where(
        and(
          eq(reactionRoles.guildId, guild.id),
          eq(reactionRoles.messageId, reaction.message.id),
          eq(reactionRoles.emoji, emojiKey),
        ),
      )
      .limit(1)

    const binding = rows[0]
    if (!binding) return

    const member = await guild.members.fetch(user.id).catch(() => null)
    if (!member || !member.roles.cache.has(binding.roleId)) return

    try {
      await member.roles.remove(binding.roleId, 'Reaction role removed')
      container.api?.hub.broadcast('utility', 'reaction_role_revoked', {
        guildId: guild.id,
        userId: user.id,
        roleId: binding.roleId,
      })
    } catch (err) {
      container.logger.warn({ err, roleId: binding.roleId, userId: user.id }, 'utility: failed to remove reaction role')
    }
  }
}
