/**
 * `note` - attach a private moderator note to a member.
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
import { addNote } from '../../features/moderation/service.ts'

type Severity = 'info' | 'warn' | 'high'

function coerceSeverity(value: string | null): Severity {
  return value === 'warn' || value === 'high' ? value : 'info'
}

export class NoteCommand extends Command {
  public constructor(context: Command.LoaderContext, options: Command.Options) {
    super(context, { ...options, name: 'note', description: 'Add a private moderator note to a member.' })
  }

  public override registerApplicationCommands(registry: Command.Registry): void {
    registry.registerChatInputCommand((builder) =>
      builder
        .setName(this.name)
        .setDescription(this.description)
        .addUserOption((o) => o.setName('member').setDescription('Member the note is about').setRequired(true))
        .addStringOption((o) => o.setName('note').setDescription('The note text').setRequired(true))
        .addStringOption((o) =>
          o
            .setName('severity')
            .setDescription('How serious the note is')
            .setRequired(false)
            .addChoices(
              { name: 'info', value: 'info' },
              { name: 'warn', value: 'warn' },
              { name: 'high', value: 'high' },
            ),
        ),
    )
  }

  public override async chatInputRun(interaction: Command.ChatInputCommandInteraction): Promise<void> {
    const ctx = await contextFromInteraction(interaction)
    if (!ctx) {
      await interaction.reply({ content: t('en', 'common.guild_only'), ephemeral: true })
      return
    }
    const user = interaction.options.getUser('member', true)
    const note = interaction.options.getString('note', true)
    const severity = coerceSeverity(interaction.options.getString('severity'))
    await this.run(ctx, user.id, user.tag, note, severity)
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
    const note = args.slice(1).join(' ')
    if (note.length === 0) {
      await ctx.reply(err(ctx.locale, 'common.missing_argument', { name: 'note' }))
      return
    }
    await this.run(ctx, target.user.id, target.user.tag, note, 'info')
  }

  private async run(
    ctx: ModContext,
    userId: string,
    userTag: string,
    note: string,
    severity: Severity,
  ): Promise<void> {
    if (!hasPerm(ctx.invoker, PERMS.note)) {
      await ctx.reply(err(ctx.locale, 'common.no_permission'))
      return
    }
    const id = await addNote({
      guildId: ctx.guild.id,
      userId,
      authorId: ctx.invoker.id,
      note,
      severity,
    })
    await ctx.reply(
      brandEmbed({
        tone: 'success',
        title: 'Note added',
        description: `Note #${id} saved for ${userTag} (severity: ${severity}).`,
      }),
    )
  }
}
