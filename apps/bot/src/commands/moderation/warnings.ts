/**
 * `warnings` - list a member's active warnings.
 */
import { Command } from '@sapphire/framework'
import type { Message } from 'discord.js'
import { t } from '@nd/i18n'
import { brandEmbed } from '../../lib/embed.ts'
import {
  PERMS,
  contextFromInteraction,
  contextFromMessage,
  err,
  hasPerm,
  resolveMember,
  type ModContext,
} from './_shared.ts'
import { listWarnings } from '../../features/moderation/service.ts'

export class WarningsCommand extends Command {
  public constructor(context: Command.LoaderContext, options: Command.Options) {
    super(context, { ...options, name: 'warnings', description: "List a member's active warnings." })
  }

  public override registerApplicationCommands(registry: Command.Registry): void {
    registry.registerChatInputCommand((builder) =>
      builder
        .setName(this.name)
        .setDescription(this.description)
        .addUserOption((o) => o.setName('member').setDescription('Member to look up').setRequired(true)),
    )
  }

  public override async chatInputRun(interaction: Command.ChatInputCommandInteraction): Promise<void> {
    const ctx = await contextFromInteraction(interaction)
    if (!ctx) {
      await interaction.reply({ content: t('en', 'common.guild_only'), ephemeral: true })
      return
    }
    const user = interaction.options.getUser('member', true)
    await this.run(ctx, user.id, user.tag)
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
    await this.run(ctx, target.user.id, target.user.tag)
  }

  private async run(ctx: ModContext, userId: string, userTag: string): Promise<void> {
    if (!hasPerm(ctx.invoker, PERMS.warn)) {
      await ctx.reply(err(ctx.locale, 'common.no_permission'))
      return
    }
    const warnings = await listWarnings(ctx.guild.id, userId)
    const embed = brandEmbed({
      tone: warnings.length > 0 ? 'warning' : 'neutral',
      title: `Warnings for ${userTag}`,
      description:
        warnings.length === 0
          ? 'This member has no active warnings.'
          : warnings
              .map((w) => {
                const when = `<t:${Math.floor(w.createdAt / 1000)}:R>`
                const reason = w.reason ?? t(ctx.locale, 'moderation.reason_default')
                return `Case #${w.id} - ${reason} (by <@${w.moderatorId}>, ${when})`
              })
              .join('\n'),
    })
    await ctx.reply(embed)
  }
}
