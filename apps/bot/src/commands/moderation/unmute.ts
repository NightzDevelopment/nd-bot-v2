/**
 * `unmute` - lift a member's active timeout.
 */
import { type GuildMember, type Message, PermissionFlagsBits } from 'discord.js'
import { Command } from '@sapphire/framework'
import { t } from '@nd/i18n'
import {
  PERMS,
  contextFromInteraction,
  contextFromMessage,
  err,
  hasPerm,
  resolveMember,
  say,
  type ModContext,
} from './_shared.ts'
import { createCase, logToModChannel } from '../../features/moderation/service.ts'

export class UnmuteCommand extends Command {
  public constructor(context: Command.LoaderContext, options: Command.Options) {
    super(context, { ...options, name: 'unmute', description: "Lift a member's timeout." })
  }

  public override registerApplicationCommands(registry: Command.Registry): void {
    registry.registerChatInputCommand((builder) =>
      builder
        .setName(this.name)
        .setDescription(this.description)
        .addUserOption((o) => o.setName('member').setDescription('Member to unmute').setRequired(true))
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
    if (!hasPerm(ctx.invoker, PERMS.mute)) {
      await ctx.reply(err(ctx.locale, 'common.no_permission'))
      return
    }
    const me = ctx.guild.members.me
    if (!me?.permissions.has(PermissionFlagsBits.ModerateMembers) || !member.moderatable) {
      await ctx.reply(err(ctx.locale, 'moderation.unmute.error'))
      return
    }
    if (!member.isCommunicationDisabled()) {
      await ctx.reply(err(ctx.locale, 'moderation.unmute.not_muted', { user: member.user.tag }))
      return
    }

    const reasonText = reason ?? t(ctx.locale, 'moderation.reason_default')
    try {
      await member.timeout(null, reasonText)
    } catch {
      await ctx.reply(err(ctx.locale, 'moderation.unmute.error'))
      return
    }

    const caseId = await createCase({
      guildId: ctx.guild.id,
      userId: member.id,
      moderatorId: ctx.invoker.id,
      action: 'mute',
      reason,
      active: false,
    })

    await logToModChannel(ctx.guild, {
      action: 'unban',
      titleOverride: 'Unmute',
      caseId,
      target: member.user,
      moderator: ctx.invoker.user,
      reason,
    })

    await ctx.reply(say('success', 'Unmuted', ctx.locale, 'moderation.unmute.success', { user: member.user.tag }))
  }
}
