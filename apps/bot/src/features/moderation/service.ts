/**
 * Moderation service.
 *
 * Central logic shared by every moderation command: persisting cases to
 * `mod_cases`, enforcing role + bot hierarchy, DMing the target, logging to the
 * configured mod-log channel through a branded embed, and broadcasting live
 * events to the dashboard. Commands stay thin and call into here so the policy
 * lives in one place.
 */
import {
  type Guild,
  type GuildMember,
  type User,
  ChannelType,
  EmbedBuilder,
  PermissionFlagsBits,
} from 'discord.js'
import { and, desc, eq } from 'drizzle-orm'
import { container } from '@sapphire/framework'
import { getDb, modCases, modNotes } from '@nd/db'
import { t, type TranslationKey } from '@nd/i18n'
import { brandEmbed, type EmbedTone } from '../../lib/embed.ts'

/** Actions persisted to `mod_cases.action`. */
export type ModAction = 'warn' | 'mute' | 'kick' | 'ban' | 'timeout' | 'unban' | 'note'

/** Default cap on active warnings before the command surfaces a hint. */
export const DEFAULT_MAX_WARNINGS = 3

/** A persisted moderation case row shape (subset the UI/embeds use). */
export interface ModCaseRecord {
  id: number
  guildId: string
  userId: string
  moderatorId: string
  action: string
  reason: string | null
  durationMs: number | null
  active: boolean
  createdAt: number
  expiresAt: number | null
}

/** Result of a hierarchy check. `ok: false` carries an i18n key to reply with. */
export type HierarchyResult = { ok: true } | { ok: false; reason: TranslationKey }

const db = getDb()

/** Map a moderation action to an embed tone for the mod-log. */
const ACTION_TONE: Record<ModAction, EmbedTone> = {
  warn: 'warning',
  mute: 'warning',
  timeout: 'warning',
  kick: 'danger',
  ban: 'danger',
  unban: 'success',
  note: 'neutral',
}

/** Title cased label for an action, used in embeds. */
function actionLabel(action: ModAction): string {
  return action.charAt(0).toUpperCase() + action.slice(1)
}

/**
 * Enforce that `moderator` outranks `target` and that the bot can act on the
 * target. Owners bypass the moderator check. Returns an i18n key on failure.
 */
export function checkHierarchy(
  moderator: GuildMember,
  target: GuildMember | null,
): HierarchyResult {
  // Acting on a user not in the guild (e.g. ban by id) has no member to compare.
  if (!target) return { ok: true }

  const guild = target.guild
  const isOwner = moderator.id === guild.ownerId

  if (!isOwner && target.roles.highest.comparePositionTo(moderator.roles.highest) >= 0) {
    return { ok: false, reason: 'moderation.hierarchy' }
  }

  const me = guild.members.me
  if (me && target.roles.highest.comparePositionTo(me.roles.highest) >= 0) {
    return { ok: false, reason: 'moderation.bot_hierarchy' }
  }

  return { ok: true }
}

/** Persist a moderation case and return the new row id. */
export async function createCase(input: {
  guildId: string
  userId: string
  moderatorId: string
  action: ModAction
  reason: string | null
  durationMs?: number | null
  expiresAt?: number | null
  active?: boolean
}): Promise<number> {
  const rows = await db
    .insert(modCases)
    .values({
      guildId: input.guildId,
      userId: input.userId,
      moderatorId: input.moderatorId,
      action: input.action,
      reason: input.reason,
      durationMs: input.durationMs ?? null,
      expiresAt: input.expiresAt ?? null,
      active: input.active ?? true,
    })
    .returning({ id: modCases.id })

  const id = rows[0]?.id ?? 0
  broadcastCase(input.guildId, {
    id,
    guildId: input.guildId,
    userId: input.userId,
    moderatorId: input.moderatorId,
    action: input.action,
    reason: input.reason,
    durationMs: input.durationMs ?? null,
    active: input.active ?? true,
    createdAt: Date.now(),
    expiresAt: input.expiresAt ?? null,
  })
  return id
}

/** Push a `case_created` event to dashboard subscribers, if the API is up. */
export function broadcastCase(guildId: string, record: ModCaseRecord): void {
  void guildId
  container.api?.hub.broadcast('moderation', 'case_created', record)
}

/** Count active warnings for a member. */
export async function countActiveWarnings(guildId: string, userId: string): Promise<number> {
  const rows = await db
    .select({ id: modCases.id })
    .from(modCases)
    .where(
      and(
        eq(modCases.guildId, guildId),
        eq(modCases.userId, userId),
        eq(modCases.action, 'warn'),
        eq(modCases.active, true),
      ),
    )
  return rows.length
}

/** List the most recent cases for a member (any action). */
export async function listCases(
  guildId: string,
  userId: string,
  limit = 25,
): Promise<ModCaseRecord[]> {
  return db
    .select()
    .from(modCases)
    .where(and(eq(modCases.guildId, guildId), eq(modCases.userId, userId)))
    .orderBy(desc(modCases.createdAt))
    .limit(limit)
}

/** List warnings (active only) for a member. */
export async function listWarnings(guildId: string, userId: string): Promise<ModCaseRecord[]> {
  return db
    .select()
    .from(modCases)
    .where(
      and(
        eq(modCases.guildId, guildId),
        eq(modCases.userId, userId),
        eq(modCases.action, 'warn'),
        eq(modCases.active, true),
      ),
    )
    .orderBy(desc(modCases.createdAt))
}

/** Mark every active warning for a member inactive. Returns how many were cleared. */
export async function clearWarnings(guildId: string, userId: string): Promise<number> {
  const active = await listWarnings(guildId, userId)
  if (active.length === 0) return 0
  await db
    .update(modCases)
    .set({ active: false })
    .where(
      and(
        eq(modCases.guildId, guildId),
        eq(modCases.userId, userId),
        eq(modCases.action, 'warn'),
        eq(modCases.active, true),
      ),
    )
  return active.length
}

/** Fetch a single case by guild + id. */
export async function getCase(guildId: string, id: number): Promise<ModCaseRecord | null> {
  const rows = await db
    .select()
    .from(modCases)
    .where(and(eq(modCases.guildId, guildId), eq(modCases.id, id)))
    .limit(1)
  return rows[0] ?? null
}

/** Add a mod note and return its id. */
export async function addNote(input: {
  guildId: string
  userId: string
  authorId: string
  note: string
  severity?: 'info' | 'warn' | 'high'
}): Promise<number> {
  const rows = await db
    .insert(modNotes)
    .values({
      guildId: input.guildId,
      userId: input.userId,
      authorId: input.authorId,
      note: input.note,
      severity: input.severity ?? 'info',
    })
    .returning({ id: modNotes.id })
  return rows[0]?.id ?? 0
}

/** List notes for a member, newest first. */
export async function listNotes(guildId: string, userId: string, limit = 25) {
  return db
    .select()
    .from(modNotes)
    .where(and(eq(modNotes.guildId, guildId), eq(modNotes.userId, userId)))
    .orderBy(desc(modNotes.createdAt))
    .limit(limit)
}

/**
 * Best effort DM to a moderated member. Swallows failures (closed DMs) so the
 * action itself never depends on the DM succeeding.
 */
export async function dmTarget(user: User, embed: EmbedBuilder): Promise<boolean> {
  try {
    await user.send({ embeds: [embed] })
    return true
  } catch {
    return false
  }
}

/**
 * Post a moderation action to the configured mod-log channel, if one is set and
 * reachable. Never throws.
 */
export async function logToModChannel(
  guild: Guild,
  options: {
    action: ModAction
    caseId: number
    target: User
    moderator: User
    reason: string | null
    durationLabel?: string
    /** Override the embed title (e.g. "Unmute"). Defaults to the action label. */
    titleOverride?: string
  },
): Promise<void> {
  try {
    const settings = await container.config.getSettings(guild.id)
    const channelId = settings.modules.moderation.logChannelId ?? settings.channels.modLogId
    if (!channelId) return

    const channel = await guild.channels.fetch(channelId).catch(() => null)
    if (!channel || channel.type !== ChannelType.GuildText) return

    const me = guild.members.me
    if (me && !channel.permissionsFor(me).has(PermissionFlagsBits.SendMessages)) return

    const embed = brandEmbed({
      tone: ACTION_TONE[options.action],
      title: `${options.titleOverride ?? actionLabel(options.action)} | Case #${options.caseId}`,
    })
      .addFields(
        { name: 'Member', value: `${options.target.tag} (${options.target.id})`, inline: true },
        { name: 'Moderator', value: `${options.moderator.tag} (${options.moderator.id})`, inline: true },
      )
    if (options.durationLabel) {
      embed.addFields({ name: 'Duration', value: options.durationLabel, inline: true })
    }
    embed.addFields({ name: 'Reason', value: options.reason ?? 'No reason provided.', inline: false })

    await channel.send({ embeds: [embed] })
  } catch {
    // Logging is best effort. Never let it break the moderation action.
  }
}

/**
 * One pass over expired temporary cases (timeouts / temp bans tracked with an
 * `expiresAt`). Marks them inactive so warning/active counts stay accurate.
 * Discord lifts native timeouts itself; temp bans are not auto-unbanned here to
 * avoid acting without a guild reference, but the case is closed out.
 */
export async function sweepExpiredCases(): Promise<number> {
  const nowMs = Date.now()
  const expired = await db
    .select()
    .from(modCases)
    .where(eq(modCases.active, true))

  let closed = 0
  for (const row of expired) {
    if (row.expiresAt !== null && row.expiresAt <= nowMs) {
      await db.update(modCases).set({ active: false }).where(eq(modCases.id, row.id))
      closed++
    }
  }
  return closed
}

/** Translate against a guild's locale. */
export async function tr(
  guildId: string,
  key: TranslationKey,
  vars: Record<string, string | number> = {},
): Promise<string> {
  const locale = await container.config.getLocale(guildId)
  return t(locale, key, vars)
}

/** Whether the moderation module is enabled for a guild (defaults on if unset). */
export async function isEnabled(guildId: string): Promise<boolean> {
  const settings = await container.config.getSettings(guildId)
  return settings.modules.moderation.enabled
}
