/**
 * Branded embed helpers.
 *
 * Thin wrappers over discord.js `EmbedBuilder` that apply the Nightz Development
 * brand colors from @nd/core. Feature commands in Phase B build every embed
 * through here so the bot has one consistent look. No emojis in any output.
 */
import { EmbedBuilder } from 'discord.js'
import { BRAND } from '@nd/core'

/** Semantic embed variants mapped to brand colors. */
export type EmbedTone = 'primary' | 'success' | 'warning' | 'danger' | 'neutral'

const TONE_COLORS: Record<EmbedTone, number> = {
  primary: BRAND.colors.primary,
  success: BRAND.colors.active,
  warning: BRAND.colors.caution,
  danger: BRAND.colors.alert,
  neutral: BRAND.colors.textMuted,
}

export interface BrandEmbedOptions {
  tone?: EmbedTone
  title?: string
  description?: string
  /** Footer text. The brand name is appended automatically when omitted. */
  footer?: string
  /** Override the default footer behavior and use exactly this footer text. */
  exactFooter?: string
  timestamp?: boolean
}

/**
 * Build a branded embed. Defaults to the primary tone with a timestamp and a
 * brand footer. Returns an `EmbedBuilder` so callers can chain `addFields` etc.
 */
export function brandEmbed(options: BrandEmbedOptions = {}): EmbedBuilder {
  const { tone = 'primary', title, description, footer, exactFooter, timestamp = true } = options

  const embed = new EmbedBuilder().setColor(TONE_COLORS[tone])

  if (title !== undefined) embed.setTitle(title)
  if (description !== undefined) embed.setDescription(description)
  if (timestamp) embed.setTimestamp(new Date())

  const footerText = exactFooter ?? (footer ? `${footer} | ${BRAND.name}` : BRAND.name)
  embed.setFooter({ text: footerText })

  return embed
}

/** Shorthand for a success toned embed. */
export function successEmbed(title: string, description?: string): EmbedBuilder {
  return brandEmbed(description === undefined ? { tone: 'success', title } : { tone: 'success', title, description })
}

/** Shorthand for an error toned embed. */
export function errorEmbed(title: string, description?: string): EmbedBuilder {
  return brandEmbed(description === undefined ? { tone: 'danger', title } : { tone: 'danger', title, description })
}

/** Shorthand for a warning toned embed. */
export function warningEmbed(title: string, description?: string): EmbedBuilder {
  return brandEmbed(description === undefined ? { tone: 'warning', title } : { tone: 'warning', title, description })
}
