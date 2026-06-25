/**
 * `purge` - bulk delete recent messages in the current channel.
 *
 * Discord only bulk-deletes messages newer than 14 days, so older messages are
 * skipped. An optional member filter limits the delete to one author.
 */
import {
  type GuildTextBasedChannel,
  type Message,
  type User,
  ChannelType,
  PermissionFlagsBits,
} from 'discord.js'
import { Command } from '@sapphire/framework'
import { t } from '@nd/i18n'
import { brandEmbed } from '../../lib/embed.ts'
import {
  PERMS,
  contextFromInteraction,
  contextFromMessage,
  err,
  hasPerm,
  type ModContext,
} from './_shared.ts'
import { createCase, logToModChannel } from '../../features/moderation/service.ts'

const MAX_PURGE = 100
const TWO_WEEKS_MS = 14 * 24 * 60 * 60 * 1000

export class PurgeCommand extends Command {
  public constructor(context: Command.LoaderContext, options: Command.Options) {
    super(context, {
      ...options,
      name: 'purge',
      aliases: ['clear', 'prune'],
      description: 'Bulk delete recent messages in this channel.',
    })
  }

  public override registerApplicationCommands(registry: Command.Registry): void {
    registry.registerChatInputCommand((builder) =>
      builder
        .setName(this.name)
        .setDescription(this.description)
        .addIntegerOption((o) =>
          o.setName('count').setDescription('How many messages (1-100)').setRequired(true).setMinValue(1).setMaxValue(MAX_PURGE),
        )
        .addUserOption((o) => o.setName('member').setDescription('Only delete this member\'s messages').setRequired(false)),
    )
  }

  public override async chatInputRun(interaction: Command.ChatInputCommandInteraction): Promise<void> {
    const ctx = await contextFromInteraction(interaction)
    if (!ctx) {
      await interaction.reply({ content: t('en', 'common.guild_only'), ephemeral: true })
      return
    }
    const channel = interaction.channel
    if (!channel || channel.type !== ChannelType.GuildText) {
      await ctx.reply(err(ctx.locale, 'common.guild_only'))
      return
    }
    await interaction.deferReply({ ephemeral: true })
    const count = interaction.options.getInteger('count', true)
    const filterUser = interaction.options.getUser('member')
    await this.run(ctx, channel, count, filterUser)
  }

  public override async messageRun(message: Message): Promise<void> {
    const ctx = await contextFromMessage(message)
    if (!ctx) {
      await message.reply({ embeds: [err('en', 'common.guild_only')] })
      return
    }
    const channel = message.channel
    if (channel.type !== ChannelType.GuildText) {
      await ctx.reply(err(ctx.locale, 'common.guild_only'))
      return
    }
    const args = message.content.split(/\s+/).slice(1)
    const count = Number(args[0])
    if (!Number.isInteger(count) || count < 1) {
      await ctx.reply(err(ctx.locale, 'common.invalid_number'))
      return
    }
    const filterUser = message.mentions.users?.first() ?? null
    // Remove the invoking command message too where possible.
    await message.delete().catch(() => null)
    await this.run(ctx, channel, Math.min(count, MAX_PURGE), filterUser)
  }

  private async run(
    ctx: ModContext,
    channel: GuildTextBasedChannel,
    count: number,
    filterUser: User | null,
  ): Promise<void> {
    if (!hasPerm(ctx.invoker, PERMS.purge)) {
      await ctx.reply(err(ctx.locale, 'common.no_permission'))
      return
    }
    const me = ctx.guild.members.me
    if (!me || !channel.permissionsFor(me).has(PermissionFlagsBits.ManageMessages)) {
      await ctx.reply(err(ctx.locale, 'common.no_permission'))
      return
    }

    let deleted = 0
    try {
      const fetched = await channel.messages.fetch({ limit: MAX_PURGE })
      const cutoff = Date.now() - TWO_WEEKS_MS
      const targets = [...fetched.values()]
        .filter((m) => m.createdTimestamp > cutoff && !m.pinned)
        .filter((m) => (filterUser ? m.author.id === filterUser.id : true))
        .slice(0, count)

      if (targets.length > 0) {
        const removed = await channel.bulkDelete(targets, true)
        deleted = removed.size
      }
    } catch {
      await ctx.reply(err(ctx.locale, 'common.error'))
      return
    }

    const caseId = await createCase({
      guildId: ctx.guild.id,
      userId: filterUser?.id ?? ctx.invoker.id,
      moderatorId: ctx.invoker.id,
      action: 'note',
      reason: `Purged ${deleted} message(s) in #${channel.name}${filterUser ? ` from ${filterUser.tag}` : ''}`,
      active: false,
    })

    await logToModChannel(ctx.guild, {
      action: 'note',
      titleOverride: 'Purge',
      caseId,
      target: filterUser ?? ctx.invoker.user,
      moderator: ctx.invoker.user,
      reason: `Deleted ${deleted} message(s) in #${channel.name}`,
    })

    await ctx.reply(
      brandEmbed({
        tone: 'success',
        title: 'Purged',
        description: `Deleted ${deleted} message(s)${filterUser ? ` from ${filterUser.tag}` : ''} in #${channel.name}.`,
      }),
    )
  }
}
