/**
 * Shared ticket UI builders + the open flow.
 *
 * Centralizes the panel, the in channel control row, the welcome embed, and the
 * "open a ticket and announce it" sequence so the slash command, message
 * command, and button/select listener all produce identical output.
 */
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type GuildMember,
  type GuildTextBasedChannel,
  StringSelectMenuBuilder,
  type TextChannel,
} from 'discord.js'
import { container } from '@sapphire/framework'
import { t } from '@nd/i18n'
import { brandEmbed, successEmbed } from '../../lib/embed.ts'
import { CUSTOM_ID, DEFAULT_CATEGORIES } from './constants.ts'
import type { OpenResult } from './service.ts'

/** The persistent panel button members click to open a ticket. */
export function buildPanelRow(): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(CUSTOM_ID.panelOpen)
      .setLabel('Open a ticket')
      .setStyle(ButtonStyle.Primary),
  )
}

/** The category select shown after the panel button is pressed. */
export function buildCategorySelectRow(): ActionRowBuilder<StringSelectMenuBuilder> {
  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(CUSTOM_ID.categorySelect)
      .setPlaceholder('Choose a category')
      .addOptions(DEFAULT_CATEGORIES.map((c) => ({ label: c.label, value: c.value }))),
  )
}

/** The claim / close control row posted inside a fresh ticket channel. */
export function buildControlRow(): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(CUSTOM_ID.claim).setLabel('Claim').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(CUSTOM_ID.close).setLabel('Close').setStyle(ButtonStyle.Danger),
  )
}

/**
 * Post the welcome message + control row inside a newly created ticket channel,
 * then run AI triage in the background and update the channel when it lands.
 */
export async function announceTicket(
  channel: TextChannel,
  member: GuildMember,
  ticketId: number,
  subject: string | null,
  category: string | null,
): Promise<void> {
  const locale = await container.config.getLocale(channel.guild.id)
  const lines = [
    `Thanks ${member.toString()}. A staff member will be with you shortly.`,
    category ? `Category: ${category}` : null,
    subject ? `Subject: ${subject}` : null,
  ].filter(Boolean) as string[]

  const embed = brandEmbed({
    tone: 'primary',
    title: `Ticket #${ticketId}`,
    description: lines.join('\n'),
    footer: t(locale, 'tickets.opened', { channel: channel.name }).replace(/\{channel\}/, channel.name),
  })

  await channel.send({ content: member.toString(), embeds: [embed], components: [buildControlRow()] })

  if (subject) {
    void runTriage(channel, ticketId, subject)
  }
}

/** Background AI triage: classify and annotate the ticket without blocking. */
async function runTriage(channel: TextChannel, ticketId: number, subject: string): Promise<void> {
  const triage = await container.tickets.triage(subject)
  if (!triage) return
  await container.tickets.applyTriage(ticketId, triage)
  const embed = brandEmbed({
    tone: 'neutral',
    title: 'AI triage',
    description: [
      `Suggested category: ${triage.category}`,
      `Priority: ${triage.priority}`,
      triage.summary ? `Summary: ${triage.summary}` : null,
    ]
      .filter(Boolean)
      .join('\n'),
  })
  await channel.send({ embeds: [embed] }).catch(() => undefined)
}

/**
 * Format a failed open result into a user facing message. Returns the localized
 * string and whether a channel mention should be appended.
 */
export async function describeOpenFailure(guildId: string, result: Extract<OpenResult, { ok: false }>): Promise<string> {
  const locale = await container.config.getLocale(guildId)
  switch (result.reason) {
    case 'disabled':
      return t(locale, 'common.disabled')
    case 'no_category':
      return 'Tickets are not fully configured yet. Ask an admin to set a ticket category.'
    case 'limit_reached':
      return result.existingChannelId
        ? t(locale, 'tickets.already_open', { channel: `<#${result.existingChannelId}>` })
        : t(locale, 'tickets.limit_reached')
    case 'create_failed':
      return t(locale, 'common.error')
    default:
      return t(locale, 'common.error')
  }
}

/** Build the closed summary embed posted before the channel is removed. */
export function buildCloseSummary(ticketId: number, closedBy: string, messageCount: number): ReturnType<typeof successEmbed> {
  return successEmbed(
    `Ticket #${ticketId} closed`,
    [`Closed by: ${closedBy}`, `Messages recorded: ${messageCount}`, 'Transcript saved.'].join('\n'),
  )
}

/** True when a channel can be treated as a guild ticket channel. */
export function isManageableTicketChannel(channel: unknown): channel is GuildTextBasedChannel {
  return (
    !!channel &&
    typeof channel === 'object' &&
    'isTextBased' in channel &&
    typeof (channel as GuildTextBasedChannel).isTextBased === 'function' &&
    (channel as GuildTextBasedChannel).isTextBased() &&
    'guild' in channel
  )
}
