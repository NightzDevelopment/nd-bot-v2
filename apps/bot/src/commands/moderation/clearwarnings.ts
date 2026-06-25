/**
 * `clearwarnings` - clear all active warnings for a member.
 */
import { Command } from '@sapphire/framework'
import type { Message } from 'discord.js'
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
import { clearWarnings } from '../../features/moderation/service.ts'

export class ClearWarningsCommand extends Command {
  public constructor(context: Command.LoaderContext, options: Command.Options) {
    super(context, {
      ...options,
      name: 'clearwarnings',
      aliases: ['clearwarns'],
      description: "Clear all of a member's active warnings.",
    })
  }

  public override registerApplicationCommands(registry: Command.Registry): void {
    registry.registerChatInputCommand((builder) =>
      builder
        .setName(this.name)
        .setDescription(this.description)
        .addUserOption((o) => o.setName('member').setDescription('Member to clear').setRequired(true)),
    )
  }

  public override async chatInputRun(interaction: Command.ChatInputCommandInteraction): Promise<void> {
    const ctx = await contextFromInteraction(interaction)
    if (!ctx) {
      await interaction.reply({ content: t('en', 'common.guild_only'), ephemeral: true })
      return
    }
    const user = interaction.options.getUser('member', true)
    await this.run(ctx, user.id)
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
    await this.run(ctx, target.user.id)
  }

  private async run(ctx: ModContext, userId: string): Promise<void> {
    if (!hasPerm(ctx.invoker, PERMS.warn)) {
      await ctx.reply(err(ctx.locale, 'common.no_permission'))
      return
    }
    const count = await clearWarnings(ctx.guild.id, userId)
    await ctx.reply(
      say('success', 'Warnings cleared', ctx.locale, 'moderation.warn.cleared', {
        count,
        user: `<@${userId}>`,
      }),
    )
  }
}
