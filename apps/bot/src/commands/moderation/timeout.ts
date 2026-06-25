/**
 * `timeout` - native Discord timeout for a member. Same mechanism as `mute`
 * but uses the `timeout.*` i18n key family.
 */
import { Command } from '@sapphire/framework'
import type { GuildMember, Message } from 'discord.js'
import { t } from '@nd/i18n'
import {
  PERMS,
  contextFromInteraction,
  contextFromMessage,
  err,
  hasPerm,
  resolveMember,
  type ModContext,
} from './_shared.ts'
import { parseDuration } from '../../features/moderation/duration.ts'
import { applyTimeout } from './_timeout-action.ts'

export class TimeoutCommand extends Command {
  public constructor(context: Command.LoaderContext, options: Command.Options) {
    super(context, { ...options, name: 'timeout', description: 'Time out a member for a duration.' })
  }

  public override registerApplicationCommands(registry: Command.Registry): void {
    registry.registerChatInputCommand((builder) =>
      builder
        .setName(this.name)
        .setDescription(this.description)
        .addUserOption((o) => o.setName('member').setDescription('Member to time out').setRequired(true))
        .addStringOption((o) => o.setName('duration').setDescription('e.g. 10m, 2h, 1d').setRequired(true))
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
    await this.run(ctx, member, interaction.options.getString('duration', true), interaction.options.getString('reason'))
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
    await this.run(ctx, target.member, args[1] ?? '', args.slice(2).join(' ') || null)
  }

  private async run(ctx: ModContext, member: GuildMember, rawDuration: string, reason: string | null): Promise<void> {
    if (!hasPerm(ctx.invoker, PERMS.timeout)) {
      await ctx.reply(err(ctx.locale, 'common.no_permission'))
      return
    }
    const durationMs = parseDuration(rawDuration)
    if (durationMs === null) {
      await ctx.reply(err(ctx.locale, 'common.missing_argument', { name: 'duration' }))
      return
    }
    await applyTimeout(ctx, member, durationMs, reason, 'timeout')
  }
}
