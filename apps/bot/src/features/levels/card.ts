/**
 * Levels: rank presentation helpers.
 *
 * The bot has no native image canvas dependency, so a "card" here is a branded
 * embed with a text progress bar rather than a rendered PNG. This keeps the
 * feature dependency free while still giving a card like layout. The helpers
 * are pure so they can be unit tested without Discord.
 */
import { brandEmbed } from '../../lib/embed.ts'
import { levelProgress } from './leveling.ts'

/** Width of the text progress bar in cells. */
const BAR_WIDTH = 20
const FILLED = '█' // full block
const EMPTY = '░' // light shade

/** Render a fixed width progress bar for a 0..1 ratio. */
export function progressBar(ratio: number, width = BAR_WIDTH): string {
  const clamped = Math.max(0, Math.min(1, ratio))
  const filled = Math.round(clamped * width)
  return FILLED.repeat(filled) + EMPTY.repeat(width - filled)
}

/** Compact integer formatting (1.2k, 3.4m) for XP totals. */
export function formatXp(value: number): string {
  if (value < 1_000) return String(value)
  if (value < 1_000_000) return `${(value / 1_000).toFixed(1).replace(/\.0$/, '')}k`
  return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, '')}m`
}

export interface RankCardInput {
  displayName: string
  avatarUrl: string | null
  xp: number
  level: number
  rank: number
  total: number
  messages: number
}

/**
 * Build the rank "card" embed: level, rank, a progress bar toward the next
 * level, and lifetime totals. No emojis, brand colors only.
 */
export function buildRankCard(input: RankCardInput) {
  const { level, current, needed } = levelProgress(input.xp)
  const ratio = needed > 0 ? current / needed : 1
  const bar = progressBar(ratio)
  const pct = Math.round(ratio * 100)

  const description = [
    `Level ${level}  |  Rank ${input.rank} of ${input.total}`,
    '',
    `${bar}  ${pct}%`,
    `${formatXp(current)} / ${formatXp(needed)} XP to level ${level + 1}`,
  ].join('\n')

  const embed = brandEmbed({
    tone: 'primary',
    title: input.displayName,
    description,
  }).addFields(
    { name: 'Total XP', value: formatXp(input.xp), inline: true },
    { name: 'Messages', value: String(input.messages), inline: true },
  )

  if (input.avatarUrl) embed.setThumbnail(input.avatarUrl)
  return embed
}
