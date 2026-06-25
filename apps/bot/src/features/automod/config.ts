/**
 * Automod settings shape and defaults.
 *
 * The shared ConfigService (lib/config.ts) does not yet carry an `automod`
 * settings slice beyond the generic `modules.automod` toggle. Until those fields
 * land in `guildSettingsSchema`, this module owns the typed defaults the listener
 * reads. The orchestrator will fold `AUTOMOD_SETTINGS_FIELDS` into config.ts and
 * this file can then defer to `getSettings().modules.automod`.
 *
 * Everything here is pure: no Discord, no DB. Other files import the resolver.
 */
import { container } from '@sapphire/framework'

/** One filter toggle plus how aggressive its action escalation is. */
export interface AutomodFilters {
  bannedWords: boolean
  inviteLinks: boolean
  massMention: boolean
  spamFlood: boolean
  linkFilter: boolean
}

/** Tunable numeric limits the listener checks messages against. */
export interface AutomodThresholds {
  /** Max distinct user/role mentions in a single message before it trips. */
  maxMentions: number
  /** How many messages within `floodWindowMs` from one user counts as flood. */
  floodCount: number
  floodWindowMs: number
  /** Strikes within `escalateWindowMs` that escalate a warn into a mute. */
  escalateAfter: number
  escalateWindowMs: number
  /** Mute duration applied on escalation. */
  muteMs: number
  /** Joins within `raidWindowMs` that trigger a raid alert. */
  raidJoinCount: number
  raidWindowMs: number
}

export interface AutomodSettings {
  enabled: boolean
  /** Channel for automod alerts (raids, quarantine flags). Falls back to mod log. */
  alertChannelId: string | null
  filters: AutomodFilters
  thresholds: AutomodThresholds
  /** Lowercased substrings that trip the banned-words filter. */
  bannedWords: string[]
  /** Hostnames allowed past the link filter (substring match). */
  allowedDomains: string[]
  /** Role applied to quarantined members. */
  quarantineRoleId: string | null
  /** Lowercased substrings that flag a username as suspicious. */
  suspiciousNamePatterns: string[]
  /** Use the AI router to judge borderline scam links. Off by default. */
  aiScamCheck: boolean
}

/** Sensible defaults used until the fields exist in the shared config schema. */
export const AUTOMOD_DEFAULTS: AutomodSettings = {
  enabled: false,
  alertChannelId: null,
  filters: {
    bannedWords: true,
    inviteLinks: true,
    massMention: true,
    spamFlood: true,
    linkFilter: false,
  },
  thresholds: {
    maxMentions: 6,
    floodCount: 5,
    floodWindowMs: 7_000,
    escalateAfter: 3,
    escalateWindowMs: 10 * 60_000,
    muteMs: 10 * 60_000,
    raidJoinCount: 8,
    raidWindowMs: 30_000,
  },
  bannedWords: [],
  allowedDomains: ['discord.com', 'discord.gg', 'nightz.dev', 'tenor.com', 'youtube.com', 'youtu.be'],
  quarantineRoleId: null,
  suspiciousNamePatterns: ['free nitro', 'steamcommunity', 'discord-gift', 'nitro-free', '@everyone'],
  aiScamCheck: false,
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function mergeFilters(raw: unknown): AutomodFilters {
  const base = AUTOMOD_DEFAULTS.filters
  if (!isRecord(raw)) return { ...base }
  return {
    bannedWords: typeof raw.bannedWords === 'boolean' ? raw.bannedWords : base.bannedWords,
    inviteLinks: typeof raw.inviteLinks === 'boolean' ? raw.inviteLinks : base.inviteLinks,
    massMention: typeof raw.massMention === 'boolean' ? raw.massMention : base.massMention,
    spamFlood: typeof raw.spamFlood === 'boolean' ? raw.spamFlood : base.spamFlood,
    linkFilter: typeof raw.linkFilter === 'boolean' ? raw.linkFilter : base.linkFilter,
  }
}

function mergeThresholds(raw: unknown): AutomodThresholds {
  const base = AUTOMOD_DEFAULTS.thresholds
  if (!isRecord(raw)) return { ...base }
  const num = (key: keyof AutomodThresholds): number => {
    const v = raw[key]
    return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : base[key]
  }
  return {
    maxMentions: num('maxMentions'),
    floodCount: num('floodCount'),
    floodWindowMs: num('floodWindowMs'),
    escalateAfter: num('escalateAfter'),
    escalateWindowMs: num('escalateWindowMs'),
    muteMs: num('muteMs'),
    raidJoinCount: num('raidJoinCount'),
    raidWindowMs: num('raidWindowMs'),
  }
}

function stringArray(raw: unknown, fallback: string[]): string[] {
  if (!Array.isArray(raw)) return [...fallback]
  return raw.filter((v): v is string => typeof v === 'string').map((v) => v.toLowerCase())
}

/**
 * Resolve the effective automod settings for a guild. Reads the generic module
 * toggle and (when present) an `automod` slice from the shared settings blob,
 * filling every gap from `AUTOMOD_DEFAULTS`.
 */
export async function resolveAutomodSettings(guildId: string): Promise<AutomodSettings> {
  const settings = await container.config.getSettings(guildId)
  const moduleToggle = settings.modules.automod
  // The shared schema does not type an `automod` slice yet; read it defensively.
  const slice = (settings as { automod?: unknown }).automod
  const raw = isRecord(slice) ? slice : {}

  const alertChannelId =
    typeof raw.alertChannelId === 'string'
      ? raw.alertChannelId
      : (moduleToggle.logChannelId ?? settings.channels.modLogId ?? AUTOMOD_DEFAULTS.alertChannelId)

  return {
    enabled: moduleToggle.enabled,
    alertChannelId,
    filters: mergeFilters(raw.filters),
    thresholds: mergeThresholds(raw.thresholds),
    bannedWords: stringArray(raw.bannedWords, AUTOMOD_DEFAULTS.bannedWords),
    allowedDomains: stringArray(raw.allowedDomains, AUTOMOD_DEFAULTS.allowedDomains),
    quarantineRoleId:
      typeof raw.quarantineRoleId === 'string' ? raw.quarantineRoleId : AUTOMOD_DEFAULTS.quarantineRoleId,
    suspiciousNamePatterns: stringArray(raw.suspiciousNamePatterns, AUTOMOD_DEFAULTS.suspiciousNamePatterns),
    aiScamCheck: typeof raw.aiScamCheck === 'boolean' ? raw.aiScamCheck : AUTOMOD_DEFAULTS.aiScamCheck,
  }
}
