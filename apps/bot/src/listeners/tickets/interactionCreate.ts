/**
 * Ticket interaction listener.
 *
 * Handles every button/select tied to the tickets feature without registering a
 * new piece store: it listens on the global InteractionCreate event and filters
 * by our custom id prefix. Flows:
 *   - panel button  -> show an ephemeral category select
 *   - category select -> open a ticket in that category
 *   - claim button  -> claim the current ticket (staff only)
 *   - close button  -> close the current ticket + deliver transcript
 */
import { Events, Listener, container } from '@sapphire/framework'
import {
  type ButtonInteraction,
  type GuildMember,
  type Interaction,
  PermissionFlagsBits,
  type StringSelectMenuInteraction,
} from 'discord.js'
import { t } from '@nd/i18n'
import { brandEmbed, errorEmbed, successEmbed, warningEmbed } from '../../lib/embed.ts'
import { CUSTOM_ID, isTicketCustomId } from '../../features/tickets/constants.ts'
import {
  announceTicket,
  buildCategorySelectRow,
  buildCloseSummary,
  describeOpenFailure,
  isManageableTicketChannel,
} from '../../features/tickets/ui.ts'

export class TicketInteractionListener extends Listener<typeof Events.InteractionCreate> {
  public constructor(context: Listener.LoaderContext, options: Listener.Options) {
    super(context, { ...options, event: Events.InteractionCreate })
  }

  public override async run(interaction: Interaction): Promise<void> {
    try {
      if (interaction.isButton() && isTicketCustomId(interaction.customId)) {
        await this.handleButton(interaction)
        return
      }
      if (interaction.isStringSelectMenu() && interaction.customId === CUSTOM_ID.categorySelect) {
        await this.handleCategorySelect(interaction)
      }
    } catch (err) {
      this.container.logger.error(err, 'ticket interaction threw')
      const reply = { embeds: [errorEmbed('Something went wrong. Please try again.')], ephemeral: true as const }
      if ('replied' in interaction && (interaction.replied || interaction.deferred)) {
        await (interaction as ButtonInteraction).editReply(reply).catch(() => undefined)
      } else if ('reply' in interaction) {
        await (interaction as ButtonInteraction).reply(reply).catch(() => undefined)
      }
    }
  }

  private async handleButton(interaction: ButtonInteraction): Promise<void> {
    if (!interaction.inGuild() || !interaction.guild) return
    switch (interaction.customId) {
      case CUSTOM_ID.panelOpen:
        return this.startOpenFlow(interaction)
      case CUSTOM_ID.claim:
        return this.handleClaim(interaction)
      case CUSTOM_ID.close:
        return this.handleClose(interaction)
      default:
        return
    }
  }

  /** Panel button: present the category select ephemerally. */
  private async startOpenFlow(interaction: ButtonInteraction): Promise<void> {
    await interaction.reply({
      content: 'Choose a category for your ticket.',
      components: [buildCategorySelectRow()],
      ephemeral: true,
    })
  }

  /** Category select: open the ticket with the chosen category. */
  private async handleCategorySelect(interaction: StringSelectMenuInteraction): Promise<void> {
    if (!interaction.inGuild() || !interaction.guild) return
    const locale = await container.config.getLocale(interaction.guild.id)
    const member = interaction.member as GuildMember | null
    if (!member || !('id' in member)) {
      await interaction.reply({ embeds: [errorEmbed(t(locale, 'common.guild_only'))], ephemeral: true })
      return
    }
    const category = interaction.values[0]
    await interaction.deferReply({ ephemeral: true })

    const result = await container.tickets.open(interaction.guild, member, category === undefined ? {} : { category })
    if (!result.ok) {
      await interaction.editReply({
        embeds: [warningEmbed('Ticket', await describeOpenFailure(interaction.guild.id, result))],
      })
      return
    }
    await announceTicket(result.channel, member, result.ticket.id, result.ticket.subject, result.ticket.category)
    await interaction.editReply({
      embeds: [successEmbed('Ticket', t(locale, 'tickets.opened', { channel: result.channel.toString() }))],
    })
  }

  /** Claim button: staff claims the ticket. */
  private async handleClaim(interaction: ButtonInteraction): Promise<void> {
    const guildId = interaction.guildId
    if (!guildId) return
    if (!this.isStaff(interaction)) {
      await interaction.reply({ embeds: [errorEmbed('You need Manage Messages to claim tickets.')], ephemeral: true })
      return
    }
    await interaction.deferReply({ ephemeral: true })
    const locale = await container.config.getLocale(guildId)
    const result = await container.tickets.claim(interaction.channelId, interaction.user.id)
    if (!result.ok) {
      const message =
        result.reason === 'already_claimed'
          ? t(locale, 'tickets.already_claimed', { user: result.claimedBy ? `<@${result.claimedBy}>` : 'someone' })
          : t(locale, 'tickets.not_a_ticket')
      await interaction.editReply({ embeds: [warningEmbed('Ticket', message)] })
      return
    }
    await interaction.editReply({
      embeds: [successEmbed('Ticket', t(locale, 'tickets.claimed', { user: interaction.user.toString() }))],
    })
  }

  /** Close button: close the ticket, post summary, deliver transcript, remove channel. */
  private async handleClose(interaction: ButtonInteraction): Promise<void> {
    const guildId = interaction.guildId
    if (!guildId) return
    const locale = await container.config.getLocale(guildId)
    const channel = interaction.channel
    if (!isManageableTicketChannel(channel)) {
      await interaction.reply({ embeds: [errorEmbed(t(locale, 'tickets.not_a_ticket'))], ephemeral: true })
      return
    }
    await interaction.deferReply()
    const result = await container.tickets.close(channel, interaction.user.id)
    if (!result.ok) {
      await interaction.editReply({ embeds: [errorEmbed(t(locale, 'tickets.not_a_ticket'))] })
      return
    }
    await interaction.editReply({
      embeds: [buildCloseSummary(result.ticket.id, interaction.user.toString(), result.messageCount)],
    })

    const settings = await container.config.getSettings(guildId)
    const logChannelId = settings.modules.tickets.logChannelId ?? settings.channels.modLogId
    if (logChannelId) {
      const logChannel = channel.guild.channels.cache.get(logChannelId)
      if (logChannel?.isTextBased() && logChannel.isSendable()) {
        await logChannel
          .send({
            embeds: [
              brandEmbed({
                tone: 'neutral',
                title: `Ticket #${result.ticket.id} transcript`,
                footer: t(locale, 'tickets.transcript_saved'),
              }),
            ],
            files: [{ attachment: Buffer.from(result.transcript, 'utf8'), name: `ticket-${result.ticket.id}.txt` }],
          })
          .catch(() => undefined)
      }
    }

    setTimeout(() => {
      void channel.delete(`ticket ${result.ticket.id} closed`).catch(() => undefined)
    }, 8000)
  }

  private isStaff(interaction: ButtonInteraction): boolean {
    const member = interaction.member
    if (!member || typeof member.permissions === 'string') return false
    return member.permissions.has(PermissionFlagsBits.ManageMessages)
  }
}
