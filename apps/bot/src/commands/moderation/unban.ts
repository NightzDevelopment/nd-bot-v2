/**
 * `unban` - lift a ban by user id.
 */
import { type Message, PermissionFlagsBits } from 'discord.js'
import { Command } from '@sapphire/framework'
import { t } from '@nd/i18n'
import {
  PERMS,
  contextFromInteraction,
  contextFromMessage,
  err,
  hasPerm,
  say,
  type ModContext,
} from './_shared.ts'
import { createCase, logToModChannel } from '../../features/moderation/service.ts'

export class UnbanCommand extends Command {
  public constructor(context: Command.LoaderContext, options: Command.Options) {
    super(context, { ...options, name: 'unban', description: 'Lift a ban by user id.' })
  }

  public override registerApplicationCommands(registry: Command.Registry): void {
    registry.registerChatInputCommand((builder) =>
      builder
        .setName(this.name)
        .setDescription(this.description)
        .addStringOption((o) => o.setName('user_id').setDescription('User id to unban').setRequired(true))
        .addStringOption((o) => o.setName('reason').setDescription('Reason').setRequired(false)),
    )
  }

  public override async chatInputRun(interaction: Command.ChatInputCommandInteraction): Promise<void> {
    const ctx = await contextFromInteraction(interaction)
    if (!ctx) {
      await interaction.reply({ content: t('en', 'common.guild_only'), ephemeral: true })
      return
    }
    await this.run(ctx, interaction.options.getString('user_id', true), interaction.options.getString('reason'))
  }

  public override async messageRun(message: Message): Promise<void> {
    const ctx = await contextFromMessage(message)
    if (!ctx) {
      await message.reply({ embeds: [err('en', 'common.guild_only')] })
      return
    }
    const args = message.content.split(/\s+/).slice(1)
    await this.run(ctx, args[0] ?? '', args.slice(1).join(' ') || null)
  }

  private async run(ctx: ModContext, rawId: string, reason: string | null): Promise<void> {
    if (!hasPerm(ctx.invoker, PERMS.ban)) {
      await ctx.reply(err(ctx.locale, 'common.no_permission'))
      return
    }
    const userId = rawId.replace(/[<@!>]/g, '').trim()
    if (!/^\d{15,21}$/.test(userId)) {
      await ctx.reply(err(ctx.locale, 'common.member_not_found'))
      return
    }
    const me = ctx.guild.members.me
    if (!me?.permissions.has(PermissionFlagsBits.BanMembers)) {
      await ctx.reply(err(ctx.locale, 'moderation.unban.error'))
      return
    }

    const existing = await ctx.guild.bans.fetch(userId).catch(() => null)
    if (!existing) {
      await ctx.reply(err(ctx.locale, 'moderation.unban.not_banned', { user: `<@${userId}>` }))
      return
    }

    const reasonText = reason ?? t(ctx.locale, 'moderation.reason_default')
    try {
      await ctx.guild.bans.remove(userId, reasonText)
    } catch {
      await ctx.reply(err(ctx.locale, 'moderation.unban.error'))
      return
    }

    const caseId = await createCase({
      guildId: ctx.guild.id,
      userId,
      moderatorId: ctx.invoker.id,
      action: 'unban',
      reason,
    })

    await logToModChannel(ctx.guild, {
      action: 'unban',
      caseId,
      target: existing.user,
      moderator: ctx.invoker.user,
      reason,
    })

    await ctx.reply(say('success', 'Unbanned', ctx.locale, 'moderation.unban.success', { user: existing.user.tag }))
  }
}
