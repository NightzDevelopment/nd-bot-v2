/**
 * Shared helpers for moderation commands.
 *
 * Each moderation command extends `Command` and handles both a slash
 * interaction and a prefix message. These helpers keep the two paths in sync:
 * resolving the acting member, resolving the target user/member, permission
 * gating, and replying through a branded embed.
 */
import {
  type ChatInputCommandInteraction,
  type Guild,
  type GuildMember,
  type Message,
  type User,
  EmbedBuilder,
  PermissionFlagsBits,
} from 'discord.js'
import { container } from '@sapphire/framework'
import type { Locale } from '@nd/core'
import { brandEmbed, errorEmbed, type EmbedTone } from '../../lib/embed.ts'
import { t, type TranslationKey } from '@nd/i18n'

/** A unified context over a slash interaction or a prefix message. */
export interface ModContext {
  guild: Guild
  invoker: GuildMember
  reply: (embed: EmbedBuilder) => Promise<void>
  locale: Locale
}

/** Resolve the guild locale once for a command run. */
async function resolveLocale(guildId: string): Promise<Locale> {
  return container.config.getLocale(guildId)
}

/** Build a ModContext from a slash interaction, or null if not in a guild. */
export async function contextFromInteraction(
  interaction: ChatInputCommandInteraction,
): Promise<ModContext | null> {
  const guild = interaction.guild
  const member = interaction.member
  if (!guild || !member || !('roles' in member)) return null
  const invoker = await guild.members.fetch(interaction.user.id).catch(() => null)
  if (!invoker) return null
  return {
    guild,
    invoker,
    locale: await resolveLocale(guild.id),
    reply: async (embed) => {
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply({ embeds: [embed] })
      } else {
        await interaction.reply({ embeds: [embed], ephemeral: false })
      }
    },
  }
}

/** Build a ModContext from a prefix message, or null if not usable. */
export async function contextFromMessage(message: Message): Promise<ModContext | null> {
  const guild = message.guild
  if (!guild || !message.member) return null
  return {
    guild,
    invoker: message.member,
    locale: await resolveLocale(guild.id),
    reply: async (embed) => {
      await message.reply({ embeds: [embed] })
    },
  }
}

/** A localized error reply built from an i18n key. */
export function err(locale: Locale, key: TranslationKey, vars: Record<string, string | number> = {}): EmbedBuilder {
  return errorEmbed('Moderation', t(locale, key, vars))
}

/** A localized toned reply built from an i18n key. */
export function say(
  tone: EmbedTone,
  title: string,
  locale: Locale,
  key: TranslationKey,
  vars: Record<string, string | number> = {},
): EmbedBuilder {
  return brandEmbed({ tone, title, description: t(locale, key, vars) })
}

/** Permission flags each moderation command requires from the invoker. */
export const PERMS = {
  warn: PermissionFlagsBits.ModerateMembers,
  note: PermissionFlagsBits.ModerateMembers,
  mute: PermissionFlagsBits.ModerateMembers,
  timeout: PermissionFlagsBits.ModerateMembers,
  kick: PermissionFlagsBits.KickMembers,
  ban: PermissionFlagsBits.BanMembers,
  purge: PermissionFlagsBits.ManageMessages,
} as const

/** True if the invoker holds the given permission. Guild owner always passes. */
export function hasPerm(invoker: GuildMember, perm: bigint): boolean {
  if (invoker.id === invoker.guild.ownerId) return true
  return invoker.permissions.has(perm)
}

/**
 * Resolve a target member from a message's mentions or a raw id/arg, returning
 * the member (in-guild) plus the underlying user.
 */
export async function resolveMember(
  guild: Guild,
  raw: string | null,
  mentioned: GuildMember | null,
): Promise<{ member: GuildMember; user: User } | null> {
  if (mentioned) return { member: mentioned, user: mentioned.user }
  if (!raw) return null
  const id = raw.replace(/[<@!>]/g, '').trim()
  if (!/^\d{15,21}$/.test(id)) return null
  const member = await guild.members.fetch(id).catch(() => null)
  if (!member) return null
  return { member, user: member.user }
}

/** Resolve a user by id/mention even if they are not in the guild (for ban/unban). */
export async function resolveUser(raw: string | null, mentioned: User | null): Promise<User | null> {
  if (mentioned) return mentioned
  if (!raw) return null
  const id = raw.replace(/[<@!>]/g, '').trim()
  if (!/^\d{15,21}$/.test(id)) return null
  return container.client.users.fetch(id).catch(() => null)
}

/** Build the DM embed sent to a moderated member. */
export function dmEmbed(tone: EmbedTone, title: string, description: string): EmbedBuilder {
  return brandEmbed({ tone, title, description })
}
