/**
 * Duration parsing + formatting for moderation commands.
 *
 * Accepts compact strings like `10m`, `2h30m`, `7d`, or bare seconds, and turns
 * them into milliseconds. Discord timeouts cap at 28 days, so callers clamp
 * against {@link MAX_TIMEOUT_MS}.
 */

/** Discord's hard cap on a member timeout: 28 days in ms. */
export const MAX_TIMEOUT_MS = 28 * 24 * 60 * 60 * 1000

const UNIT_MS: Record<string, number> = {
  s: 1000,
  m: 60 * 1000,
  h: 60 * 60 * 1000,
  d: 24 * 60 * 60 * 1000,
  w: 7 * 24 * 60 * 60 * 1000,
}

/**
 * Parse a duration string into ms. Supports combined units (`1h30m`) and a bare
 * number treated as seconds. Returns null when nothing valid is found.
 */
export function parseDuration(input: string | null | undefined): number | null {
  if (!input) return null
  const trimmed = input.trim().toLowerCase()
  if (trimmed.length === 0) return null

  // Bare number -> seconds.
  if (/^\d+$/.test(trimmed)) {
    const seconds = Number(trimmed)
    return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : null
  }

  const matches = trimmed.matchAll(/(\d+)\s*([smhdw])/g)
  let total = 0
  let matched = false
  for (const m of matches) {
    const value = Number(m[1])
    const unit = m[2]
    if (!Number.isFinite(value) || unit === undefined) continue
    const unitMs = UNIT_MS[unit]
    if (unitMs === undefined) continue
    total += value * unitMs
    matched = true
  }
  return matched && total > 0 ? total : null
}

/** Human label for a ms duration, e.g. `2h 30m`. Empty string for <= 0. */
export function formatDuration(ms: number): string {
  if (ms <= 0) return ''
  const parts: string[] = []
  let remaining = ms

  const days = Math.floor(remaining / UNIT_MS.d!)
  remaining -= days * UNIT_MS.d!
  const hours = Math.floor(remaining / UNIT_MS.h!)
  remaining -= hours * UNIT_MS.h!
  const minutes = Math.floor(remaining / UNIT_MS.m!)
  remaining -= minutes * UNIT_MS.m!
  const seconds = Math.floor(remaining / UNIT_MS.s!)

  if (days > 0) parts.push(`${days}d`)
  if (hours > 0) parts.push(`${hours}h`)
  if (minutes > 0) parts.push(`${minutes}m`)
  if (seconds > 0 && parts.length === 0) parts.push(`${seconds}s`)

  return parts.join(' ')
}
