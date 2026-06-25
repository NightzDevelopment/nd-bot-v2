/**
 * `case` - look up a single moderation case by number.
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
  type ModContext,
} from './_shared.ts'
import { formatDuration } from '../../features/moderation/duration.ts'
import { getCase } from '../../features/moderation/service.ts'

export class CaseCommand extends Command {
  public constructor(context: Command.LoaderContext, options: Command.Options) {
    super(context, { ...options, name: 'case', description: 'Look up a moderation case by number.' })
  }

  public override registerApplicationCommands(registry: Command.Registry): void {
    registry.registerChatInputCommand((builder) =>
      builder
        .setName(this.name)
        .setDescription(this.description)
        .addIntegerOption((o) => o.setName('id').setDescription('Case number').setRequired(true).setMinValue(1)),
    )
  }

  public override async chatInputRun(interaction: Command.ChatInputCommandInteraction): Promise<void> {
    const ctx = await contextFromInteraction(interaction)
    if (!ctx) {
      await interaction.reply({ content: t('en', 'common.guild_only'), ephemeral: true })
      return
    }
    await this.run(ctx, interaction.options.getInteger('id', true))
  }

  public override async messageRun(message: Message): Promise<void> {
    const ctx = await contextFromMessage(message)
    if (!ctx) {
      await message.reply({ embeds: [err('en', 'common.guild_only')] })
      return
    }
    const args = message.content.split(/\s+/).slice(1)
    const id = Number(args[0])
    if (!Number.isInteger(id) || id < 1) {
      await ctx.reply(err(ctx.locale, 'common.invalid_number'))
      return
    }
    await this.run(ctx, id)
  }

  private async run(ctx: ModContext, id: number): Promise<void> {
    if (!hasPerm(ctx.invoker, PERMS.warn)) {
      await ctx.reply(err(ctx.locale, 'common.no_permission'))
      return
    }
    const record = await getCase(ctx.guild.id, id)
    if (!record) {
      await ctx.reply(err(ctx.locale, 'common.not_found'))
      return
    }
    const embed = brandEmbed({ tone: 'neutral', title: `Case #${record.id}` }).addFields(
      { name: 'Action', value: record.action, inline: true },
      { name: 'Status', value: record.active ? 'active' : 'inactive', inline: true },
      { name: 'Member', value: `<@${record.userId}>`, inline: true },
      { name: 'Moderator', value: `<@${record.moderatorId}>`, inline: true },
      { name: 'When', value: `<t:${Math.floor(record.createdAt / 1000)}:F>`, inline: true },
      {
        name: 'Reason',
        value: record.reason ?? t(ctx.locale, 'moderation.reason_default'),
        inline: false,
      },
    )
    if (record.durationMs) {
      embed.addFields({ name: 'Duration', value: formatDuration(record.durationMs), inline: true })
    }
    if (record.expiresAt) {
      embed.addFields({ name: 'Expires', value: `<t:${Math.floor(record.expiresAt / 1000)}:R>`, inline: true })
    }
    await ctx.reply(embed)
  }
}
