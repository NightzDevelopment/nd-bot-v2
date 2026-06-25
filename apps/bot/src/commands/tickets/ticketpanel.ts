/**
 * /ticketpanel: post the persistent "Open a ticket" button panel.
 *
 * Staff run this in the channel where members should open tickets. The button is
 * stateless (custom id only), so the panel survives bot restarts; the listener
 * handles presses. Requires the Manage Channels permission.
 */
import { Command, container } from '@sapphire/framework'
import {
  type ChatInputCommandInteraction,
  type Message,
  PermissionFlagsBits,
} from 'discord.js'
import { t } from '@nd/i18n'
import { brandEmbed, errorEmbed, successEmbed } from '../../lib/embed.ts'
import { buildPanelRow, isManageableTicketChannel } from '../../features/tickets/ui.ts'

export class TicketPanelCommand extends Command {
  public constructor(context: Command.LoaderContext, options: Command.Options) {
    super(context, {
      ...options,
      name: 'ticketpanel',
      description: 'Post a ticket panel members can use to open a ticket.',
      requiredUserPermissions: [PermissionFlagsBits.ManageChannels],
    })
  }

  public override registerApplicationCommands(registry: Command.Registry): void {
    registry.registerChatInputCommand((builder) =>
      builder
        .setName(this.name)
        .setDescription(this.description)
        .addStringOption((o) => o.setName('title').setDescription('Panel title').setMaxLength(120))
        .addStringOption((o) => o.setName('message').setDescription('Panel body text').setMaxLength(500))
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),
    )
  }

  public override async chatInputRun(interaction: ChatInputCommandInteraction): Promise<void> {
    if (!interaction.inGuild() || !interaction.guild) {
      await interaction.reply({ embeds: [errorEmbed(t('en', 'common.guild_only'))], ephemeral: true })
      return
    }
    const locale = await container.config.getLocale(interaction.guild.id)
    const channel = interaction.channel
    if (!isManageableTicketChannel(channel) || !channel.isSendable()) {
      await interaction.reply({ embeds: [errorEmbed(t(locale, 'common.error'))], ephemeral: true })
      return
    }

    const title = interaction.options.getString('title') ?? 'Need help?'
    const body =
      interaction.options.getString('message') ??
      'Press the button below to open a private ticket with the staff team.'

    await channel.send({ embeds: [this.panelEmbed(title, body)], components: [buildPanelRow()] })
    await interaction.reply({ embeds: [successEmbed('Ticket panel', 'Panel posted.')], ephemeral: true })
  }

  public override async messageRun(message: Message): Promise<void> {
    if (!message.inGuild()) {
      await message.reply({ embeds: [errorEmbed(t('en', 'common.guild_only'))] })
      return
    }
    const locale = await container.config.getLocale(message.guildId)
    if (!message.member?.permissions.has(PermissionFlagsBits.ManageChannels)) {
      await message.reply({ embeds: [errorEmbed(t(locale, 'common.no_permission'))] })
      return
    }
    const channel = message.channel
    if (!isManageableTicketChannel(channel) || !channel.isSendable()) {
      await message.reply({ embeds: [errorEmbed(t(locale, 'common.error'))] })
      return
    }
    await channel.send({
      embeds: [this.panelEmbed('Need help?', 'Press the button below to open a private ticket with the staff team.')],
      components: [buildPanelRow()],
    })
    await message.reply({ embeds: [successEmbed('Ticket panel', 'Panel posted.')] })
  }

  private panelEmbed(title: string, body: string) {
    return brandEmbed({ tone: 'primary', title, description: body })
  }
}
