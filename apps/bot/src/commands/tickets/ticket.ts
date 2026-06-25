/**
 * /ticket: the staff + member facing ticket lifecycle command.
 *
 * Subcommands: open, close, claim, unclaim, add, remove. Slash interactions use
 * subcommands; the message command (`nd!ticket <action>`) maps the first word to
 * the same handlers. All ticket state changes go through `container.tickets` so
 * the rules live in the service, not the command.
 */
import { Args, Command, container } from '@sapphire/framework'
import type { Locale } from '@nd/core'
import {
  ChannelType,
  type ChatInputCommandInteraction,
  type GuildMember,
  type GuildTextBasedChannel,
  type Message,
  PermissionFlagsBits,
  type User,
} from 'discord.js'
import { t } from '@nd/i18n'
import { brandEmbed, errorEmbed, successEmbed, warningEmbed } from '../../lib/embed.ts'
import {
  announceTicket,
  buildCloseSummary,
  describeOpenFailure,
  isManageableTicketChannel,
} from '../../features/tickets/ui.ts'

const STAFF_PERMISSION = PermissionFlagsBits.ManageMessages

export class TicketCommand extends Command {
  public constructor(context: Command.LoaderContext, options: Command.Options) {
    super(context, {
      ...options,
      name: 'ticket',
      description: 'Open and manage support tickets.',
    })
  }

  public override registerApplicationCommands(registry: Command.Registry): void {
    registry.registerChatInputCommand((builder) =>
      builder
        .setName(this.name)
        .setDescription(this.description)
        .addSubcommand((sub) =>
          sub
            .setName('open')
            .setDescription('Open a new ticket.')
            .addStringOption((o) => o.setName('subject').setDescription('What do you need help with?').setMaxLength(200)),
        )
        .addSubcommand((sub) => sub.setName('close').setDescription('Close the current ticket.'))
        .addSubcommand((sub) => sub.setName('claim').setDescription('Claim the current ticket.'))
        .addSubcommand((sub) => sub.setName('unclaim').setDescription('Release your claim on the current ticket.'))
        .addSubcommand((sub) =>
          sub
            .setName('add')
            .setDescription('Add a member to the current ticket.')
            .addUserOption((o) => o.setName('member').setDescription('Member to add').setRequired(true)),
        )
        .addSubcommand((sub) =>
          sub
            .setName('remove')
            .setDescription('Remove a member from the current ticket.')
            .addUserOption((o) => o.setName('member').setDescription('Member to remove').setRequired(true)),
        ),
    )
  }

  public override async chatInputRun(interaction: ChatInputCommandInteraction): Promise<void> {
    if (!interaction.inGuild() || !interaction.guild) {
      await interaction.reply({ embeds: [errorEmbed(t('en', 'common.guild_only'))], ephemeral: true })
      return
    }
    const locale = await container.config.getLocale(interaction.guild.id)
    const sub = interaction.options.getSubcommand(true)
    const member = interaction.member as GuildMember | null

    switch (sub) {
      case 'open':
        return this.runOpen(interaction, locale, interaction.options.getString('subject') ?? undefined)
      case 'close':
        return this.runClose(interaction, locale)
      case 'claim':
        return this.runClaim(interaction, locale, true)
      case 'unclaim':
        return this.runClaim(interaction, locale, false)
      case 'add':
        return this.runMembership(interaction, locale, interaction.options.getUser('member', true), true, member)
      case 'remove':
        return this.runMembership(interaction, locale, interaction.options.getUser('member', true), false, member)
      default:
        await interaction.reply({ embeds: [errorEmbed(t(locale, 'common.error'))], ephemeral: true })
    }
  }

  // ---- open ---------------------------------------------------------------

  private async runOpen(
    interaction: ChatInputCommandInteraction,
    locale: Locale,
    subject: string | undefined,
  ): Promise<void> {
    const guild = interaction.guild
    const member = interaction.member
    if (!guild || !member || !('id' in member)) {
      await interaction.reply({ embeds: [errorEmbed(t(locale, 'common.guild_only'))], ephemeral: true })
      return
    }
    await interaction.deferReply({ ephemeral: true })
    const result = await container.tickets.open(guild, member as GuildMember, subject === undefined ? {} : { subject })
    if (!result.ok) {
      const message = await describeOpenFailure(guild.id, result)
      await interaction.editReply({ embeds: [warningEmbed('Ticket', message)] })
      return
    }
    await announceTicket(result.channel, member as GuildMember, result.ticket.id, result.ticket.subject, result.ticket.category)
    await interaction.editReply({
      embeds: [successEmbed('Ticket', t(locale, 'tickets.opened', { channel: result.channel.toString() }))],
    })
  }

  // ---- close --------------------------------------------------------------

  private async runClose(interaction: ChatInputCommandInteraction, locale: Locale): Promise<void> {
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
    await this.deliverTranscriptAndCleanup(channel, locale, result.ticket.id, result.transcript)
  }

  private async deliverTranscriptAndCleanup(
    channel: GuildTextBasedChannel,
    locale: Locale,
    ticketId: number,
    transcript: string,
  ): Promise<void> {
    const settings = await container.config.getSettings(channel.guild.id)
    const logChannelId = settings.modules.tickets.logChannelId ?? settings.channels.modLogId
    const file = { attachment: Buffer.from(transcript, 'utf8'), name: `ticket-${ticketId}.txt` }

    if (logChannelId) {
      const logChannel = channel.guild.channels.cache.get(logChannelId)
      if (logChannel?.isTextBased() && logChannel.isSendable()) {
        await logChannel
          .send({
            embeds: [brandEmbed({ tone: 'neutral', title: `Ticket #${ticketId} transcript`, footer: t(locale, 'tickets.transcript_saved') })],
            files: [file],
          })
          .catch(() => undefined)
      }
    }

    // Give people a moment to read the summary, then remove the channel.
    setTimeout(() => {
      void channel.delete(`ticket ${ticketId} closed`).catch(() => undefined)
    }, 8000)
  }

  // ---- claim / unclaim ----------------------------------------------------

  private async runClaim(interaction: ChatInputCommandInteraction, locale: Locale, claiming: boolean): Promise<void> {
    if (!this.isStaff(interaction)) {
      await interaction.reply({ embeds: [errorEmbed(t(locale, 'tickets.no_permission'))], ephemeral: true })
      return
    }
    const channel = interaction.channel
    if (!isManageableTicketChannel(channel)) {
      await interaction.reply({ embeds: [errorEmbed(t(locale, 'tickets.not_a_ticket'))], ephemeral: true })
      return
    }
    const result = claiming
      ? await container.tickets.claim(channel.id, interaction.user.id)
      : await container.tickets.unclaim(channel.id)

    if (!result.ok) {
      const message =
        result.reason === 'already_claimed'
          ? t(locale, 'tickets.already_claimed', { user: result.claimedBy ? `<@${result.claimedBy}>` : 'someone' })
          : t(locale, 'tickets.not_a_ticket')
      await interaction.reply({ embeds: [warningEmbed('Ticket', message)], ephemeral: true })
      return
    }
    const key = claiming ? 'tickets.claimed' : 'tickets.unclaimed'
    await interaction.reply({ embeds: [successEmbed('Ticket', t(locale, key, { user: interaction.user.toString() }))] })
  }

  // ---- add / remove members ----------------------------------------------

  private async runMembership(
    interaction: ChatInputCommandInteraction,
    locale: Locale,
    user: User,
    adding: boolean,
    actor: GuildMember | null,
  ): Promise<void> {
    void actor
    if (!this.isStaff(interaction)) {
      await interaction.reply({ embeds: [errorEmbed(t(locale, 'tickets.no_permission'))], ephemeral: true })
      return
    }
    const channel = interaction.channel
    if (!isManageableTicketChannel(channel) || channel.type !== ChannelType.GuildText) {
      await interaction.reply({ embeds: [errorEmbed(t(locale, 'tickets.not_a_ticket'))], ephemeral: true })
      return
    }
    const ticket = await container.tickets.findByChannel(channel.id)
    if (!ticket) {
      await interaction.reply({ embeds: [errorEmbed(t(locale, 'tickets.not_a_ticket'))], ephemeral: true })
      return
    }

    try {
      if (adding) {
        await channel.permissionOverwrites.edit(user.id, {
          ViewChannel: true,
          SendMessages: true,
          ReadMessageHistory: true,
        })
      } else {
        await channel.permissionOverwrites.delete(user.id, 'removed from ticket')
      }
    } catch {
      await interaction.reply({ embeds: [errorEmbed(t(locale, 'common.error'))], ephemeral: true })
      return
    }

    const verb = adding ? 'added to' : 'removed from'
    await interaction.reply({
      embeds: [successEmbed('Ticket', `${user.toString()} was ${verb} this ticket.`)],
    })
  }

  // ---- staff check --------------------------------------------------------

  private isStaff(interaction: ChatInputCommandInteraction): boolean {
    const member = interaction.member
    if (!member || !('permissions' in member) || typeof member.permissions === 'string') return false
    return member.permissions.has(STAFF_PERMISSION)
  }

  // ---- message command ----------------------------------------------------

  public override async messageRun(message: Message, args: Args): Promise<void> {
    if (!message.inGuild()) {
      await message.reply({ embeds: [errorEmbed(t('en', 'common.guild_only'))] })
      return
    }
    const locale = await container.config.getLocale(message.guildId)
    const action = (await args.pickResult('string')).unwrapOr('open').toLowerCase()
    const channel = message.channel

    switch (action) {
      case 'open': {
        const subject = (await args.restResult('string')).unwrapOr('')
        const member = message.member
        if (!member) {
          await message.reply({ embeds: [errorEmbed(t(locale, 'common.guild_only'))] })
          return
        }
        const result = await container.tickets.open(message.guild, member, subject ? { subject } : {})
        if (!result.ok) {
          await message.reply({ embeds: [warningEmbed('Ticket', await describeOpenFailure(message.guildId, result))] })
          return
        }
        await announceTicket(result.channel, member, result.ticket.id, result.ticket.subject, result.ticket.category)
        await message.reply({
          embeds: [successEmbed('Ticket', t(locale, 'tickets.opened', { channel: result.channel.toString() }))],
        })
        return
      }
      case 'close': {
        if (!isManageableTicketChannel(channel)) {
          await message.reply({ embeds: [errorEmbed(t(locale, 'tickets.not_a_ticket'))] })
          return
        }
        const result = await container.tickets.close(channel, message.author.id)
        if (!result.ok) {
          await message.reply({ embeds: [errorEmbed(t(locale, 'tickets.not_a_ticket'))] })
          return
        }
        await message.reply({
          embeds: [buildCloseSummary(result.ticket.id, message.author.toString(), result.messageCount)],
        })
        await this.deliverTranscriptAndCleanup(channel, locale, result.ticket.id, result.transcript)
        return
      }
      case 'claim':
      case 'unclaim': {
        if (!message.member?.permissions.has(STAFF_PERMISSION)) {
          await message.reply({ embeds: [errorEmbed(t(locale, 'tickets.no_permission'))] })
          return
        }
        if (!isManageableTicketChannel(channel)) {
          await message.reply({ embeds: [errorEmbed(t(locale, 'tickets.not_a_ticket'))] })
          return
        }
        const result =
          action === 'claim'
            ? await container.tickets.claim(channel.id, message.author.id)
            : await container.tickets.unclaim(channel.id)
        if (!result.ok) {
          const text =
            result.reason === 'already_claimed'
              ? t(locale, 'tickets.already_claimed', { user: result.claimedBy ? `<@${result.claimedBy}>` : 'someone' })
              : t(locale, 'tickets.not_a_ticket')
          await message.reply({ embeds: [warningEmbed('Ticket', text)] })
          return
        }
        const key = action === 'claim' ? 'tickets.claimed' : 'tickets.unclaimed'
        await message.reply({ embeds: [successEmbed('Ticket', t(locale, key, { user: message.author.toString() }))] })
        return
      }
      default:
        await message.reply({
          embeds: [warningEmbed('Ticket', 'Usage: ticket open|close|claim|unclaim. Use the slash command for add/remove.')],
        })
    }
  }
}
