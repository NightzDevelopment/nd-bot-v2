/**
 * Argument parsing helpers shared by the message-command variants. Slash
 * commands get typed options from Discord, but prefix commands receive raw
 * strings that need normalizing.
 */

/** Sentinel for "use the whole relevant balance" (deposit/withdraw all). */
export const ALL = Symbol('all')

/**
 * Parse a numeric amount from raw text. Accepts plain integers and thousands
 * separators ("1,000"). Returns null when the value is not a positive integer.
 */
export function parseAmount(raw: string | null | undefined): number | null {
  if (raw === null || raw === undefined) return null
  const cleaned = raw.replace(/[,\s]/g, '')
  if (!/^\d+$/.test(cleaned)) return null
  const value = Number.parseInt(cleaned, 10)
  return Number.isSafeInteger(value) && value > 0 ? value : null
}

/**
 * Parse an amount that may also be the word "all" / "max". Returns the ALL
 * sentinel for those, a positive integer for a number, or null when invalid.
 */
export function parseAmountOrAll(raw: string | null | undefined): number | typeof ALL | null {
  if (raw === null || raw === undefined) return null
  const lowered = raw.trim().toLowerCase()
  if (lowered === 'all' || lowered === 'max') return ALL
  return parseAmount(raw)
}
