/**
 * Shared timeout/mute action used by both `mute` and `timeout` commands.
 *
 * Discord implements "mute" as a native member timeout (communication disabled
 * until a timestamp). Both commands funnel through {@link applyTimeout} so the
 * hierarchy checks, DM, persistence, mod-log, and reply stay identical.
 */
import { type GuildMember, PermissionFlagsBits } from 'discord.js'
import { t } from '@nd/i18n'
import { dmEmbed, err, say, type ModContext } from './_shared.ts'
import { MAX_TIMEOUT_MS, formatDuration } from '../../features/moderation/duration.ts'
import { checkHierarchy, createCase, dmTarget, logToModChannel } from '../../features/moderation/service.ts'

/** Which i18n key family to use (`mute.*` vs `timeout.*`). */
export type TimeoutVariant = 'mute' | 'timeout'

export async function applyTimeout(
  ctx: ModContext,
  member: GuildMember,
  durationMs: number,
  reason: string | null,
  variant: TimeoutVariant,
): Promise<void> {
  if (member.id === ctx.invoker.id) {
    await ctx.reply(err(ctx.locale, variant === 'mute' ? 'moderation.mute.self' : 'moderation.timeout.error'))
    return
  }
  const hierarchy = checkHierarchy(ctx.invoker, member)
  if (!hierarchy.ok) {
    await ctx.reply(err(ctx.locale, hierarchy.reason))
    return
  }
  const me = ctx.guild.members.me
  if (!me?.permissions.has(PermissionFlagsBits.ModerateMembers) || !member.moderatable) {
    await ctx.reply(err(ctx.locale, variant === 'mute' ? 'moderation.mute.error' : 'moderation.timeout.error'))
    return
  }
  if (member.isCommunicationDisabled()) {
    await ctx.reply(err(ctx.locale, 'moderation.mute.already_muted', { user: member.user.tag }))
    return
  }

  const clamped = Math.min(durationMs, MAX_TIMEOUT_MS)
  const durationLabel = formatDuration(clamped)
  const reasonText = reason ?? t(ctx.locale, 'moderation.reason_default')
  const expiresAt = Date.now() + clamped

  await dmTarget(
    member.user,
    dmEmbed(
      'warning',
      variant === 'mute' ? 'Muted' : 'Timed out',
      t(ctx.locale, variant === 'mute' ? 'moderation.mute.success_dm' : 'moderation.timeout.success', {
        guild: ctx.guild.name,
        duration: durationLabel,
        reason: reasonText,
      }),
    ),
  )

  try {
    await member.timeout(clamped, reasonText)
  } catch {
    await ctx.reply(err(ctx.locale, variant === 'mute' ? 'moderation.mute.error' : 'moderation.timeout.error'))
    return
  }

  const caseId = await createCase({
    guildId: ctx.guild.id,
    userId: member.id,
    moderatorId: ctx.invoker.id,
    action: variant === 'mute' ? 'mute' : 'timeout',
    reason,
    durationMs: clamped,
    expiresAt,
  })

  await logToModChannel(ctx.guild, {
    action: variant === 'mute' ? 'mute' : 'timeout',
    caseId,
    target: member.user,
    moderator: ctx.invoker.user,
    reason,
    durationLabel,
  })

  await ctx.reply(
    say(
      'warning',
      variant === 'mute' ? 'Muted' : 'Timed out',
      ctx.locale,
      variant === 'mute' ? 'moderation.mute.success' : 'moderation.timeout.success',
      { user: member.user.tag, duration: durationLabel, reason: reasonText },
    ).addFields({ name: 'Case', value: t(ctx.locale, 'moderation.case_logged', { case: caseId }) }),
  )
}
