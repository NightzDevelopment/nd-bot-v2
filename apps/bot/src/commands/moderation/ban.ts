/**
 * `ban` - ban a user (member or by id) from the guild.
 */
import { type GuildMember, type Message, type User, PermissionFlagsBits } from 'discord.js'
import { Command } from '@sapphire/framework'
import { t } from '@nd/i18n'
import {
  PERMS,
  contextFromInteraction,
  contextFromMessage,
  dmEmbed,
  err,
  hasPerm,
  resolveUser,
  say,
  type ModContext,
} from './_shared.ts'
import { checkHierarchy, createCase, dmTarget, logToModChannel } from '../../features/moderation/service.ts'

export class BanCommand extends Command {
  public constructor(context: Command.LoaderContext, options: Command.Options) {
    super(context, { ...options, name: 'ban', description: 'Ban a user from the server.' })
  }

  public override registerApplicationCommands(registry: Command.Registry): void {
    registry.registerChatInputCommand((builder) =>
      builder
        .setName(this.name)
        .setDescription(this.description)
        .addUserOption((o) => o.setName('user').setDescription('User to ban').setRequired(true))
        .addStringOption((o) => o.setName('reason').setDescription('Reason').setRequired(false))
        .addIntegerOption((o) =>
          o
            .setName('delete_days')
            .setDescription('Days of recent messages to delete (0-7)')
            .setRequired(false)
            .setMinValue(0)
            .setMaxValue(7),
        ),
    )
  }

  public override async chatInputRun(interaction: Command.ChatInputCommandInteraction): Promise<void> {
    const ctx = await contextFromInteraction(interaction)
    if (!ctx) {
      await interaction.reply({ content: t('en', 'common.guild_only'), ephemeral: true })
      return
    }
    const user = interaction.options.getUser('user', true)
    const member = await ctx.guild.members.fetch(user.id).catch(() => null)
    const deleteDays = interaction.options.getInteger('delete_days') ?? 0
    await this.run(ctx, user, member, interaction.options.getString('reason'), deleteDays)
  }

  public override async messageRun(message: Message): Promise<void> {
    const ctx = await contextFromMessage(message)
    if (!ctx) {
      await message.reply({ embeds: [err('en', 'common.guild_only')] })
      return
    }
    const args = message.content.split(/\s+/).slice(1)
    const user = await resolveUser(args[0] ?? null, message.mentions.users?.first() ?? null)
    if (!user) {
      await ctx.reply(err(ctx.locale, 'common.member_not_found'))
      return
    }
    const member = await ctx.guild.members.fetch(user.id).catch(() => null)
    await this.run(ctx, user, member, args.slice(1).join(' ') || null, 0)
  }

  private async run(
    ctx: ModContext,
    user: User,
    member: GuildMember | null,
    reason: string | null,
    deleteDays: number,
  ): Promise<void> {
    if (!hasPerm(ctx.invoker, PERMS.ban)) {
      await ctx.reply(err(ctx.locale, 'common.no_permission'))
      return
    }
    if (user.id === ctx.invoker.id) {
      await ctx.reply(err(ctx.locale, 'moderation.ban.self'))
      return
    }
    const hierarchy = checkHierarchy(ctx.invoker, member)
    if (!hierarchy.ok) {
      await ctx.reply(err(ctx.locale, hierarchy.reason))
      return
    }
    const me = ctx.guild.members.me
    if (!me?.permissions.has(PermissionFlagsBits.BanMembers) || (member && !member.bannable)) {
      await ctx.reply(err(ctx.locale, 'moderation.ban.error'))
      return
    }

    const existing = await ctx.guild.bans.fetch(user.id).catch(() => null)
    if (existing) {
      await ctx.reply(err(ctx.locale, 'moderation.ban.already_banned', { user: user.tag }))
      return
    }

    const reasonText = reason ?? t(ctx.locale, 'moderation.reason_default')

    if (member) {
      await dmTarget(
        member.user,
        dmEmbed('danger', 'Banned', t(ctx.locale, 'moderation.ban.success_dm', { guild: ctx.guild.name, reason: reasonText })),
      )
    }

    try {
      await ctx.guild.bans.create(user.id, {
        reason: reasonText,
        deleteMessageSeconds: deleteDays * 24 * 60 * 60,
      })
    } catch {
      await ctx.reply(err(ctx.locale, 'moderation.ban.error'))
      return
    }

    const caseId = await createCase({
      guildId: ctx.guild.id,
      userId: user.id,
      moderatorId: ctx.invoker.id,
      action: 'ban',
      reason,
    })

    await logToModChannel(ctx.guild, {
      action: 'ban',
      caseId,
      target: user,
      moderator: ctx.invoker.user,
      reason,
    })

    await ctx.reply(
      say('danger', 'Banned', ctx.locale, 'moderation.ban.success', {
        user: user.tag,
        reason: reasonText,
      }).addFields({ name: 'Case', value: t(ctx.locale, 'moderation.case_logged', { case: caseId }) }),
    )
  }
}
