/**
 * /remind: set, list, and cancel personal reminders.
 *
 *   /remind me <when> <message>  persist a one off (or repeating) reminder
 *   /remind list                 show your pending reminders
 *   /remind cancel <id>          cancel one of your reminders
 *
 * Reminders are persisted in the `reminders` table and delivered by the utility
 * service scheduler, so they survive restarts. `<when>` accepts compact spans
 * like 10m, 2h30m, 1d. An optional repeat span turns it into a recurring nudge.
 */
import { type Args, Command, container } from '@sapphire/framework'
import type { Message } from 'discord.js'
import type { Locale } from '@nd/core'
import { t } from '@nd/i18n'
import { brandEmbed, errorEmbed, successEmbed } from '../../lib/embed.ts'
import { formatDuration, parseDuration, relativeTimestamp } from '../../features/utility/duration.ts'

const MAX_CONTENT = 1500
const MIN_REPEAT_MS = 60_000 // never repeat faster than once a minute

export class RemindCommand extends Command {
  public constructor(context: Command.LoaderContext, options: Command.Options) {
    super(context, {
      ...options,
      name: 'remind',
      description: 'Set, list, or cancel personal reminders.',
    })
  }

  public override registerApplicationCommands(registry: Command.Registry): void {
    registry.registerChatInputCommand((builder) =>
      builder
        .setName(this.name)
        .setDescription(this.description)
        .addSubcommand((sub) =>
          sub
            .setName('me')
            .setDescription('Set a reminder for yourself.')
            .addStringOption((o) =>
              o.setName('when').setDescription('When, e.g. 10m, 2h30m, 1d.').setRequired(true),
            )
            .addStringOption((o) =>
              o.setName('message').setDescription('What to remind you about.').setRequired(true),
            )
            .addStringOption((o) =>
              o
                .setName('repeat')
                .setDescription('Optional repeat interval, e.g. 1d for daily.')
                .setRequired(false),
            ),
        )
        .addSubcommand((sub) =>
          sub.setName('list').setDescription('List your pending reminders.'),
        )
        .addSubcommand((sub) =>
          sub
            .setName('cancel')
            .setDescription('Cancel one of your reminders by id.')
            .addIntegerOption((o) =>
              o.setName('id').setDescription('The reminder id from /remind list.').setRequired(true),
            ),
        ),
    )
  }

  public override async chatInputRun(
    interaction: Command.ChatInputCommandInteraction,
  ): Promise<void> {
    const locale = await container.config.getLocale(interaction.guildId ?? '')
    const sub = interaction.options.getSubcommand(true)

    if (sub === 'me') {
      const when = interaction.options.getString('when', true)
      const message = interaction.options.getString('message', true)
      const repeat = interaction.options.getString('repeat', false)
      const embed = await this.set(locale, {
        guildId: interaction.guildId,
        channelId: interaction.channelId,
        userId: interaction.user.id,
        when,
        message,
        repeat,
      })
      await interaction.reply({ embeds: [embed], ephemeral: true })
      return
    }

    if (sub === 'list') {
      await interaction.reply({ embeds: [await this.list(locale, interaction.user.id)], ephemeral: true })
      return
    }

    // cancel
    const id = interaction.options.getInteger('id', true)
    await interaction.reply({ embeds: [await this.cancel(locale, id, interaction.user.id)], ephemeral: true })
  }

  public override async messageRun(message: Message, args: Args): Promise<void> {
    const locale = await container.config.getLocale(message.guildId ?? '')
    const when = await args.pick('string').catch(() => null)
    const rest = await args.rest('string').catch(() => '')

    if (!when || rest.length === 0) {
      await message.reply({
        embeds: [errorEmbed('Reminder', 'Usage: nd!remind <when> <message>')],
      })
      return
    }

    const embed = await this.set(locale, {
      guildId: message.guildId,
      channelId: message.channelId,
      userId: message.author.id,
      when,
      message: rest,
      repeat: null,
    })
    await message.reply({ embeds: [embed] })
  }

  private async set(
    locale: Locale,
    input: {
      guildId: string | null
      channelId: string
      userId: string
      when: string
      message: string
      repeat: string | null
    },
  ) {
    const delayMs = parseDuration(input.when)
    if (delayMs === null) {
      return errorEmbed('Reminder', 'I could not understand that time. Try 10m, 2h30m, or 1d.')
    }

    const content = input.message.slice(0, MAX_CONTENT)
    let repeatMs: number | null = null
    if (input.repeat) {
      const parsed = parseDuration(input.repeat)
      if (parsed === null) {
        return errorEmbed('Reminder', 'I could not understand that repeat interval.')
      }
      if (parsed < MIN_REPEAT_MS) {
        return errorEmbed('Reminder', 'Repeat interval must be at least one minute.')
      }
      repeatMs = parsed
    }

    const remindAt = Date.now() + delayMs
    const reminder = await container.utility.createReminder({
      guildId: input.guildId,
      channelId: input.channelId,
      userId: input.userId,
      content,
      remindAt,
      repeatMs,
    })

    const lines = [
      // utility.reminder.set: "Reminder set. I will remind you in {time}."
      t(locale, 'utility.reminder.set', { time: formatDuration(delayMs) }),
      `When: ${relativeTimestamp(remindAt)}`,
    ]
    if (repeatMs) lines.push(`Repeats every ${formatDuration(repeatMs)}.`)
    lines.push(`Id: ${reminder.id}`)

    return successEmbed('Reminder set', lines.join('\n'))
  }

  private async list(locale: Locale, userId: string) {
    const rows = await container.utility.listReminders(userId)
    if (rows.length === 0) {
      return brandEmbed({
        tone: 'neutral',
        title: 'Your reminders',
        // utility.reminder.none: "You have no active reminders."
        description: t(locale, 'utility.reminder.none'),
      })
    }

    const lines = rows.slice(0, 20).map((r) => {
      const repeat = r.repeatMs ? ` (repeats every ${formatDuration(r.repeatMs)})` : ''
      const preview = r.content.length > 80 ? `${r.content.slice(0, 77)}...` : r.content
      return `${r.id}. ${relativeTimestamp(r.remindAt)}${repeat}: ${preview}`
    })

    return brandEmbed({ tone: 'primary', title: 'Your reminders', description: lines.join('\n') })
  }

  private async cancel(locale: Locale, id: number, userId: string) {
    const ok = await container.utility.cancelReminder(id, userId)
    if (!ok) {
      return errorEmbed('Reminder', t(locale, 'common.not_found'))
    }
    // utility.reminder.cancelled: "Reminder cancelled."
    return successEmbed('Reminder', t(locale, 'utility.reminder.cancelled'))
  }
}
