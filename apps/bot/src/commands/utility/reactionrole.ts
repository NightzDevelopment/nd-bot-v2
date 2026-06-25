/**
 * /reactionrole: bind an emoji reaction on a message to a role.
 *
 *   /reactionrole add <message_id> <emoji> <role>     create a binding
 *   /reactionrole remove <message_id> <emoji>         drop a binding
 *   /reactionrole list                                show bindings in this guild
 *
 * The messageReactionAdd/Remove listeners (listeners/utility) apply or strip the
 * role when members react. Bindings live in the `reactionRoles` table keyed by
 * (guildId, messageId, emoji). Restricted to members who can manage roles.
 */
import { Command, container } from '@sapphire/framework'
import { and, eq } from 'drizzle-orm'
import {
  type Message,
  PermissionFlagsBits,
  type Role,
} from 'discord.js'
import type { Locale } from '@nd/core'
import { t } from '@nd/i18n'
import { getDb, reactionRoles } from '@nd/db'
import { brandEmbed, errorEmbed, successEmbed } from '../../lib/embed.ts'
import { resolveEmojiKey } from '../../features/utility/emoji.ts'

export class ReactionRoleCommand extends Command {
  public constructor(context: Command.LoaderContext, options: Command.Options) {
    super(context, {
      ...options,
      name: 'reactionrole',
      description: 'Bind emoji reactions to roles.',
    })
  }

  public override registerApplicationCommands(registry: Command.Registry): void {
    registry.registerChatInputCommand((builder) =>
      builder
        .setName(this.name)
        .setDescription(this.description)
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
        .setDMPermission(false)
        .addSubcommand((sub) =>
          sub
            .setName('add')
            .setDescription('Bind an emoji on a message to a role.')
            .addStringOption((o) =>
              o.setName('message_id').setDescription('Target message id.').setRequired(true),
            )
            .addStringOption((o) =>
              o.setName('emoji').setDescription('The emoji members react with.').setRequired(true),
            )
            .addRoleOption((o) =>
              o.setName('role').setDescription('Role to grant on reaction.').setRequired(true),
            ),
        )
        .addSubcommand((sub) =>
          sub
            .setName('remove')
            .setDescription('Remove an emoji to role binding.')
            .addStringOption((o) =>
              o.setName('message_id').setDescription('Target message id.').setRequired(true),
            )
            .addStringOption((o) =>
              o.setName('emoji').setDescription('The bound emoji.').setRequired(true),
            ),
        )
        .addSubcommand((sub) =>
          sub.setName('list').setDescription('List reaction role bindings in this server.')),
    )
  }

  public override async chatInputRun(
    interaction: Command.ChatInputCommandInteraction,
  ): Promise<void> {
    if (!interaction.inGuild() || !interaction.guildId) {
      const locale = await container.config.getLocale('')
      await interaction.reply({ embeds: [errorEmbed('Reaction roles', t(locale, 'common.guild_only'))], ephemeral: true })
      return
    }

    const guildId = interaction.guildId
    const locale = await container.config.getLocale(guildId)
    const sub = interaction.options.getSubcommand(true)

    if (sub === 'add') {
      const messageId = interaction.options.getString('message_id', true)
      const emoji = interaction.options.getString('emoji', true)
      const role = interaction.options.getRole('role', true) as Role
      await interaction.reply({ embeds: [await this.add(locale, guildId, messageId, emoji, role)], ephemeral: true })
      return
    }

    if (sub === 'remove') {
      const messageId = interaction.options.getString('message_id', true)
      const emoji = interaction.options.getString('emoji', true)
      await interaction.reply({ embeds: [await this.remove(locale, guildId, messageId, emoji)], ephemeral: true })
      return
    }

    await interaction.reply({ embeds: [await this.list(guildId)], ephemeral: true })
  }

  public override async messageRun(message: Message): Promise<void> {
    // Slash only: reaction roles need precise ids and emoji, so direct users there.
    await message.reply({
      embeds: [brandEmbed({ tone: 'neutral', title: 'Reaction roles', description: 'Use /reactionrole to manage bindings.' })],
    })
  }

  private async add(locale: Locale, guildId: string, messageId: string, emoji: string, role: Role) {
    if (role.managed || role.id === guildId) {
      return errorEmbed('Reaction roles', 'That role cannot be assigned by reaction.')
    }

    const me = role.guild.members.me
    if (me && role.position >= me.roles.highest.position) {
      return errorEmbed('Reaction roles', t(locale, 'moderation.bot_hierarchy'))
    }

    const emojiKey = resolveEmojiKey(emoji)
    if (!emojiKey) return errorEmbed('Reaction roles', 'That does not look like a valid emoji.')

    const db = getDb()
    const existing = await db
      .select()
      .from(reactionRoles)
      .where(
        and(
          eq(reactionRoles.guildId, guildId),
          eq(reactionRoles.messageId, messageId),
          eq(reactionRoles.emoji, emojiKey),
        ),
      )
      .limit(1)

    if (existing[0]) {
      await db
        .update(reactionRoles)
        .set({ roleId: role.id })
        .where(eq(reactionRoles.id, existing[0].id))
    } else {
      await db.insert(reactionRoles).values({ guildId, messageId, emoji: emojiKey, roleId: role.id })
    }

    // Best effort: pre seed the reaction on the message so members can click it.
    await this.seedReaction(guildId, messageId, emoji).catch(() => undefined)

    container.api?.hub.broadcast('utility', 'reaction_role_added', { guildId, messageId, emoji: emojiKey, roleId: role.id })

    // utility.reaction_role.added: "Reaction role added: react with {emoji} to get {role}."
    return successEmbed('Reaction roles', t(locale, 'utility.reaction_role.added', { emoji, role: role.name }))
  }

  private async remove(locale: Locale, guildId: string, messageId: string, emoji: string) {
    const emojiKey = resolveEmojiKey(emoji) ?? emoji
    const db = getDb()
    const removed = await db
      .delete(reactionRoles)
      .where(
        and(
          eq(reactionRoles.guildId, guildId),
          eq(reactionRoles.messageId, messageId),
          eq(reactionRoles.emoji, emojiKey),
        ),
      )
      .returning({ id: reactionRoles.id })

    if (removed.length === 0) {
      return errorEmbed('Reaction roles', t(locale, 'common.not_found'))
    }

    container.api?.hub.broadcast('utility', 'reaction_role_removed', { guildId, messageId, emoji: emojiKey })
    // utility.reaction_role.removed: "Reaction role removed."
    return successEmbed('Reaction roles', t(locale, 'utility.reaction_role.removed'))
  }

  private async list(guildId: string) {
    const db = getDb()
    const rows = await db.select().from(reactionRoles).where(eq(reactionRoles.guildId, guildId))
    if (rows.length === 0) {
      return brandEmbed({ tone: 'neutral', title: 'Reaction roles', description: 'No reaction role bindings yet.' })
    }

    const lines = rows.slice(0, 25).map((r) => `${r.emoji} -> <@&${r.roleId}> on message ${r.messageId}`)
    return brandEmbed({ tone: 'primary', title: 'Reaction roles', description: lines.join('\n') })
  }

  /** Add the configured emoji reaction to the target message so it is clickable. */
  private async seedReaction(guildId: string, messageId: string, emoji: string): Promise<void> {
    const guild = container.client.guilds.cache.get(guildId)
    if (!guild) return
    for (const channel of guild.channels.cache.values()) {
      if (!channel.isTextBased()) continue
      const msg = await channel.messages.fetch(messageId).catch(() => null)
      if (msg) {
        await msg.react(emoji)
        return
      }
    }
  }
}
