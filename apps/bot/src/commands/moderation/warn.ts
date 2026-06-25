/**
 * `warn` - record a warning against a member.
 */
import { Command } from '@sapphire/framework'
import type { Message } from 'discord.js'
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
import { checkHierarchy, countActiveWarnings, createCase, dmTarget, logToModChannel } from '../../features/moderation/service.ts'

export class WarnCommand extends Command {
  public constructor(context: Command.LoaderContext, options: Command.Options) {
    super(context, { ...options, name: 'warn', description: 'Warn a member and record the case.' })
  }

  public override registerApplicationCommands(registry: Command.Registry): void {
    registry.registerChatInputCommand((builder) =>
      builder
        .setName(this.name)
        .setDescription(this.description)
        .addUserOption((o) => o.setName('member').setDescription('Member to warn').setRequired(true))
        .addStringOption((o) => o.setName('reason').setDescription('Why the member is being warned').setRequired(false)),
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
    const reason = interaction.options.getString('reason')
    await this.run(ctx, member, user.id, user.tag, reason)
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
    const reason = args.slice(1).join(' ') || null
    await this.run(ctx, target.member, target.user.id, target.user.tag, reason)
  }

  private async run(
    ctx: ModContext,
    member: import('discord.js').GuildMember | null,
    userId: string,
    userTag: string,
    reason: string | null,
  ): Promise<void> {
    if (!hasPerm(ctx.invoker, PERMS.warn)) {
      await ctx.reply(err(ctx.locale, 'common.no_permission'))
      return
    }
    if (userId === ctx.invoker.id) {
      await ctx.reply(err(ctx.locale, 'moderation.warn.self'))
      return
    }
    const hierarchy = checkHierarchy(ctx.invoker, member)
    if (!hierarchy.ok) {
      await ctx.reply(err(ctx.locale, hierarchy.reason))
      return
    }

    const caseId = await createCase({
      guildId: ctx.guild.id,
      userId,
      moderatorId: ctx.invoker.id,
      action: 'warn',
      reason,
    })

    const reasonText = reason ?? t(ctx.locale, 'moderation.reason_default')

    if (member) {
      await dmTarget(
        member.user,
        dmEmbed('warning', 'Warned', t(ctx.locale, 'moderation.warn.success_dm', { guild: ctx.guild.name, reason: reasonText })),
      )
    }

    await logToModChannel(ctx.guild, {
      action: 'warn',
      caseId,
      target: member?.user ?? (await this.container.client.users.fetch(userId)),
      moderator: ctx.invoker.user,
      reason,
    })

    const total = await countActiveWarnings(ctx.guild.id, userId)
    const embed = say('warning', 'Warned', ctx.locale, 'moderation.warn.success', {
      user: `<@${userId}>`,
      reason: reasonText,
    }).setFooter({ text: `${userTag} now has ${total} active warning(s)` })
    embed.addFields({ name: 'Case', value: t(ctx.locale, 'moderation.case_logged', { case: caseId }) })
    await ctx.reply(embed)
  }
}
