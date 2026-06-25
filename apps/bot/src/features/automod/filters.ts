/**
 * Pure message-content filters.
 *
 * Each function takes already-resolved settings and the relevant message data
 * and returns a `FilterHit` (or null). No Discord, DB, or AI here so the rules
 * are trivially testable and the listener stays a thin orchestrator.
 */
import type { AutomodSettings } from './config.ts'

/** The kind of violation a filter detected. */
export type FilterKind =
  | 'banned_words'
  | 'invite_links'
  | 'mass_mention'
  | 'spam_flood'
  | 'link_filter'

export interface FilterHit {
  kind: FilterKind
  /** Short, human-readable reason logged on the mod case. */
  reason: string
}

const INVITE_RE = /(?:discord\.(?:gg|com\/invite|me)|discordapp\.com\/invite)\/[a-z0-9-]+/i
const URL_RE = /https?:\/\/[^\s]+/gi

/** Extract bare hostnames from any URLs in the text (lowercased, no www.). */
export function extractDomains(text: string): string[] {
  const out: string[] = []
  const matches = text.match(URL_RE) ?? []
  for (const raw of matches) {
    try {
      const host = new URL(raw).hostname.toLowerCase().replace(/^www\./, '')
      out.push(host)
    } catch {
      // ignore malformed urls
    }
  }
  return out
}

function checkBannedWords(content: string, settings: AutomodSettings): FilterHit | null {
  if (!settings.filters.bannedWords || settings.bannedWords.length === 0) return null
  const haystack = content.toLowerCase()
  for (const word of settings.bannedWords) {
    if (word.length > 0 && haystack.includes(word)) {
      return { kind: 'banned_words', reason: 'Message contained a banned word.' }
    }
  }
  return null
}

function checkInvites(content: string, settings: AutomodSettings): FilterHit | null {
  if (!settings.filters.inviteLinks) return null
  if (INVITE_RE.test(content)) {
    return { kind: 'invite_links', reason: 'Message contained a Discord invite link.' }
  }
  return null
}

function checkMassMention(
  mentionCount: number,
  settings: AutomodSettings,
): FilterHit | null {
  if (!settings.filters.massMention) return null
  if (mentionCount >= settings.thresholds.maxMentions) {
    return {
      kind: 'mass_mention',
      reason: `Message mentioned ${mentionCount} users or roles (limit ${settings.thresholds.maxMentions}).`,
    }
  }
  return null
}

function checkLinks(content: string, settings: AutomodSettings): FilterHit | null {
  if (!settings.filters.linkFilter) return null
  const domains = extractDomains(content)
  if (domains.length === 0) return null
  const allowed = settings.allowedDomains
  const blocked = domains.find((d) => !allowed.some((a) => d === a || d.endsWith(`.${a}`)))
  if (blocked) {
    return { kind: 'link_filter', reason: `Message linked a disallowed domain: ${blocked}.` }
  }
  return null
}

export interface MessageSignals {
  content: string
  /** Distinct user + role mentions, excluding @everyone handled separately. */
  mentionCount: number
}

/**
 * Run every content filter in priority order. Returns the first hit, or null.
 * Spam/flood is stateful and handled separately by the FloodTracker.
 */
export function runContentFilters(signals: MessageSignals, settings: AutomodSettings): FilterHit | null {
  return (
    checkBannedWords(signals.content, settings) ??
    checkInvites(signals.content, settings) ??
    checkMassMention(signals.mentionCount, settings) ??
    checkLinks(signals.content, settings)
  )
}

/**
 * Per-user sliding-window flood tracker. Records message timestamps and reports
 * when a user crosses the configured rate. Kept in memory; resets on restart,
 * which is fine for flood detection.
 */
export class FloodTracker {
  private readonly hits = new Map<string, number[]>()

  /** Record a message and return a hit if the user is now flooding. */
  record(key: string, now: number, settings: AutomodSettings): FilterHit | null {
    if (!settings.filters.spamFlood) return null
    const { floodCount, floodWindowMs } = settings.thresholds
    const window = (this.hits.get(key) ?? []).filter((ts) => now - ts < floodWindowMs)
    window.push(now)
    this.hits.set(key, window)
    if (window.length >= floodCount) {
      this.hits.set(key, []) // reset so we do not re-trip every subsequent message
      return {
        kind: 'spam_flood',
        reason: `Sent ${window.length} messages in under ${Math.round(floodWindowMs / 1000)}s.`,
      }
    }
    return null
  }

  /** Drop entries older than any plausible window to keep the map small. */
  prune(now: number, maxAgeMs = 60_000): void {
    for (const [key, list] of this.hits) {
      const kept = list.filter((ts) => now - ts < maxAgeMs)
      if (kept.length === 0) this.hits.delete(key)
      else this.hits.set(key, kept)
    }
  }
}
