/**
 * Duration parsing/formatting for the utility feature.
 *
 * Accepts compact spans like `10m`, `2h30m`, `1d`, `45s`, or a bare number of
 * minutes. Returns milliseconds, or null when nothing parses. Formatting renders
 * a millisecond span back to a short human string with no dashes or emojis.
 */

const UNIT_MS: Record<string, number> = {
  s: 1_000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
  w: 604_800_000,
}

const TOKEN = /(\d+)\s*([smhdw])/gi

/** Parse a duration string into milliseconds. Returns null if unparseable or zero. */
export function parseDuration(input: string): number | null {
  const trimmed = input.trim().toLowerCase()
  if (trimmed.length === 0) return null

  // Bare number means minutes.
  if (/^\d+$/.test(trimmed)) {
    const minutes = Number.parseInt(trimmed, 10)
    return minutes > 0 ? minutes * UNIT_MS.m! : null
  }

  let total = 0
  let matched = false
  TOKEN.lastIndex = 0
  for (let m = TOKEN.exec(trimmed); m !== null; m = TOKEN.exec(trimmed)) {
    const value = Number.parseInt(m[1] as string, 10)
    const unit = UNIT_MS[(m[2] as string).toLowerCase()]
    if (unit === undefined) continue
    total += value * unit
    matched = true
  }

  return matched && total > 0 ? total : null
}

/** Render a millisecond span as a short string, e.g. "2h 30m". */
export function formatDuration(ms: number): string {
  if (ms <= 0) return '0s'
  const parts: string[] = []
  let remaining = Math.floor(ms / 1000)

  const days = Math.floor(remaining / 86_400)
  remaining %= 86_400
  const hours = Math.floor(remaining / 3_600)
  remaining %= 3_600
  const minutes = Math.floor(remaining / 60)
  const seconds = remaining % 60

  if (days > 0) parts.push(`${days}d`)
  if (hours > 0) parts.push(`${hours}h`)
  if (minutes > 0) parts.push(`${minutes}m`)
  if (seconds > 0 && parts.length === 0) parts.push(`${seconds}s`)

  return parts.join(' ') || '0s'
}

/** A Discord relative timestamp like <t:1234:R>, used for "in X" displays. */
export function relativeTimestamp(epochMs: number): string {
  return `<t:${Math.floor(epochMs / 1000)}:R>`
}
