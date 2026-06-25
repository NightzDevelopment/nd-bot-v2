/**
 * Community component interaction handler.
 *
 * Handles the Approve / Deny buttons attached to suggestion posts. The customIds
 * are minted in `/suggest` from `CUSTOM_ID` on the CommunityService, so the wire
 * format is shared. Only members with Manage Server may resolve a suggestion.
 *
 * Sapphire auto loads this listener because it lives under `src/listeners`.
 */
import { Listener } from '@sapphire/framework'
import { type Interaction, MessageFlags, PermissionFlagsBits } from 'discord.js'
import { t } from '@nd/i18n'
import { brandEmbed, errorEmbed, successEmbed } from '../../lib/embed.ts'
import { CUSTOM_ID } from '../../features/community/service.ts'

export class CommunityInteractionListener extends Listener {
  public constructor(context: Listener.LoaderContext, options: Listener.Options) {
    super(context, { ...options, event: 'interactionCreate' })
  }

  public override async run(interaction: Interaction): Promise<void> {
    if (!interaction.isButton()) return
    const { customId } = interaction
    if (!customId.startsWith('community:suggest:')) return

    const isApprove = customId.startsWith(CUSTOM_ID.suggestApprove)
    const isDeny = customId.startsWith(CUSTOM_ID.suggestDeny)
    if (!isApprove && !isDeny) return

    if (!interaction.inGuild() || !interaction.guildId) return
    const locale = await this.container.config.getLocale(interaction.guildId)

    const memberPermissions = interaction.memberPermissions
    if (!memberPermissions || !memberPermissions.has(PermissionFlagsBits.ManageGuild)) {
      await interaction.reply({
        embeds: [errorEmbed(t(locale, 'common.no_permission'))],
        flags: MessageFlags.Ephemeral,
      })
      return
    }

    const idPart = customId.split(':').at(-1) ?? ''
    const suggestionId = Number(idPart)
    if (!Number.isInteger(suggestionId)) {
      await interaction.reply({
        embeds: [errorEmbed(t(locale, 'common.not_found'))],
        flags: MessageFlags.Ephemeral,
      })
      return
    }

    const status = isApprove ? 'approved' : 'denied'
    const updated = await this.container.community.setSuggestionStatus(suggestionId, status)
    if (!updated) {
      await interaction.reply({
        embeds: [errorEmbed(t(locale, 'common.not_found'), 'It may already be resolved.')],
        flags: MessageFlags.Ephemeral,
      })
      return
    }

    const resultText = isApprove
      ? t(locale, 'community.suggestion.approved', { id: suggestionId })
      : t(locale, 'community.suggestion.denied', { id: suggestionId })

    // Update the original post to reflect the decision and drop the buttons.
    const original = interaction.message
    const baseEmbed = original.embeds[0]
    const refreshed = brandEmbed({
      tone: isApprove ? 'success' : 'danger',
      title: baseEmbed?.title ?? `Suggestion #${suggestionId}`,
      description: baseEmbed?.description ?? updated.content,
      exactFooter: `${status === 'approved' ? 'Approved' : 'Denied'} by ${interaction.user.tag}`,
    })

    await interaction.update({ embeds: [refreshed], components: [] }).catch(() => null)
    await interaction.followUp({
      embeds: [successEmbed(resultText)],
      flags: MessageFlags.Ephemeral,
    })
  }
}
