/**
 * `kick` - remove a member from the guild.
 */
import { Command } from '@sapphire/framework'
import { type GuildMember, type Message, PermissionFlagsBits } from 'discord.js'
import { t } from '@nd/i18n'
import {
  PERMS,
  contextFromInteraction,
  contextFromMessage,
  dmEmbed,
  err,
  hasPerm,
  resolveMember,
  say,
  type ModContext,
} from './_shared.ts'
import { checkHierarchy, createCase, dmTarget, logToModChannel } from '../../features/moderation/service.ts'

export class KickCommand extends Command {
  public constructor(context: Command.LoaderContext, options: Command.Options) {
    super(context, { ...options, name: 'kick', description: 'Kick a member from the server.' })
  }

  public override registerApplicationCommands(registry: Command.Registry): void {
    registry.registerChatInputCommand((builder) =>
      builder
        .setName(this.name)
        .setDescription(this.description)
        .addUserOption((o) => o.setName('member').setDescription('Member to kick').setRequired(true))
        .addStringOption((o) => o.setName('reason').setDescription('Reason').setRequired(false)),
    )
  }

  public override async chatInputRun(interaction: Command.ChatInputCommandInteraction): Promise<void> {
    const ctx = await contextFromInteraction(interaction)
    if (!ctx) {
      await interaction.reply({ content: t('en', 'common.guild_only'), ephemeral: true })
      return
    }
    const user = interaction.options.getUser('member', true)
    const member = await ctx.guild.members.fetch(user.id).catch(() => null)
    if (!member) {
      await ctx.reply(err(ctx.locale, 'common.member_not_found'))
      return
    }
    await this.run(ctx, member, interaction.options.getString('reason'))
  }

  public override async messageRun(message: Message): Promise<void> {
    const ctx = await contextFromMessage(message)
    if (!ctx) {
      await message.reply({ embeds: [err('en', 'common.guild_only')] })
      return
    }
    const args = message.content.split(/\s+/).slice(1)
    const target = await resolveMember(ctx.guild, args[0] ?? null, message.mentions.members?.first() ?? null)
    if (!target) {
      await ctx.reply(err(ctx.locale, 'common.member_not_found'))
      return
    }
    await this.run(ctx, target.member, args.slice(1).join(' ') || null)
  }

  private async run(ctx: ModContext, member: GuildMember, reason: string | null): Promise<void> {
    if (!hasPerm(ctx.invoker, PERMS.kick)) {
      await ctx.reply(err(ctx.locale, 'common.no_permission'))
      return
    }
    if (member.id === ctx.invoker.id) {
      await ctx.reply(err(ctx.locale, 'moderation.kick.self'))
      return
    }
    const hierarchy = checkHierarchy(ctx.invoker, member)
    if (!hierarchy.ok) {
      await ctx.reply(err(ctx.locale, hierarchy.reason))
      return
    }
    const me = ctx.guild.members.me
    if (!me?.permissions.has(PermissionFlagsBits.KickMembers) || !member.kickable) {
      await ctx.reply(err(ctx.locale, 'moderation.kick.error'))
      return
    }

    const reasonText = reason ?? t(ctx.locale, 'moderation.reason_default')

    // DM before the kick removes our ability to reach a shared guild.
    await dmTarget(
      member.user,
      dmEmbed('danger', 'Kicked', t(ctx.locale, 'moderation.kick.success_dm', { guild: ctx.guild.name, reason: reasonText })),
    )

    try {
      await member.kick(reasonText)
    } catch {
      await ctx.reply(err(ctx.locale, 'moderation.kick.error'))
      return
    }

    const caseId = await createCase({
      guildId: ctx.guild.id,
      userId: member.id,
      moderatorId: ctx.invoker.id,
      action: 'kick',
      reason,
    })

    await logToModChannel(ctx.guild, {
      action: 'kick',
      caseId,
      target: member.user,
      moderator: ctx.invoker.user,
      reason,
    })

    await ctx.reply(
      say('danger', 'Kicked', ctx.locale, 'moderation.kick.success', {
        user: member.user.tag,
        reason: reasonText,
      }).addFields({ name: 'Case', value: t(ctx.locale, 'moderation.case_logged', { case: caseId }) }),
    )
  }
}
