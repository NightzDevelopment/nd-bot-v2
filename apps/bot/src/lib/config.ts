/**
 * Guild configuration service.
 *
 * Reads and writes per guild settings from the `guild_config` table (via @nd/db,
 * Drizzle only) behind an in memory cache. The settings blob is a typed,
 * zod validated shape so feature modules in Phase B get a single source of truth
 * for channel ids, feature toggles, and thresholds.
 *
 * Phase B extension point: add fields to `guildSettingsSchema` below. Existing
 * rows stay valid because every field has a default, so `parseSettings` fills in
 * gaps for older blobs automatically.
 */
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { type DB, getDb, guildConfig } from '@nd/db'
import { type Locale, LOCALES, createLogger } from '@nd/core'

const log = createLogger('config')

// ---- Settings shape -------------------------------------------------------

/** A single feature module toggle plus its log channel, reused across modules. */
const moduleToggle = z.object({
  enabled: z.boolean().default(false),
  logChannelId: z.string().nullable().default(null),
})
export type ModuleToggle = z.infer<typeof moduleToggle>

/**
 * The full, validated settings blob stored in `guild_config.settings`.
 * Every field has a default so partial or legacy blobs parse cleanly.
 */
export const guildSettingsSchema = z.object({
  // Channels the core + features write to.
  channels: z
    .object({
      auditLogId: z.string().nullable().default(null),
      welcomeId: z.string().nullable().default(null),
      modLogId: z.string().nullable().default(null),
      ticketCategoryId: z.string().nullable().default(null),
    })
    .default({}),

  // Roles the core + features reference.
  roles: z
    .object({
      adminIds: z.array(z.string()).default([]),
      modIds: z.array(z.string()).default([]),
      mutedId: z.string().nullable().default(null),
    })
    .default({}),

  // Per feature module toggles. Phase B modules read their own slice.
  modules: z
    .object({
      moderation: moduleToggle.default({}),
      automod: moduleToggle.default({}),
      tickets: moduleToggle.default({}),
      aiSupport: moduleToggle.default({}),
      economy: moduleToggle.default({}),
      levels: moduleToggle.default({}),
      community: moduleToggle.default({}),
      utility: moduleToggle.default({}),
      automation: moduleToggle.default({}),
    })
    .default({}),

  // Shared numeric thresholds. Features add their own keys here.
  thresholds: z
    .object({
      maxWarnings: z.number().int().min(0).default(3),
      xpPerMessage: z.number().int().min(0).default(15),
      dailyAmount: z.number().int().min(0).default(250),
    })
    .default({}),
})

export type GuildSettings = z.infer<typeof guildSettingsSchema>

/** Parse an unknown blob into validated settings, applying defaults for gaps. */
export function parseSettings(raw: unknown): GuildSettings {
  const result = guildSettingsSchema.safeParse(raw ?? {})
  if (result.success) return result.data
  log.warn({ issues: result.error.issues }, 'invalid guild settings blob, falling back to defaults')
  return guildSettingsSchema.parse({})
}

/** A fully resolved config row: locale plus the validated settings. */
export interface GuildConfig {
  guildId: string
  locale: Locale
  settings: GuildSettings
}

function coerceLocale(value: string): Locale {
  return (LOCALES as readonly string[]).includes(value) ? (value as Locale) : 'en'
}

// ---- Service --------------------------------------------------------------

/**
 * Caches resolved guild configs in memory and persists changes through Drizzle.
 * One instance is created in `index.ts` and exposed on the Sapphire container so
 * every command and listener shares the same cache.
 */
export class ConfigService {
  private readonly db: DB
  private readonly cache = new Map<string, GuildConfig>()

  constructor(db: DB = getDb()) {
    this.db = db
  }

  /** Resolve a guild config, reading from the DB on a cache miss and seeding a row if absent. */
  async get(guildId: string): Promise<GuildConfig> {
    const cached = this.cache.get(guildId)
    if (cached) return cached

    const rows = await this.db.select().from(guildConfig).where(eq(guildConfig.guildId, guildId)).limit(1)
    const row = rows[0]

    const resolved: GuildConfig = row
      ? { guildId, locale: coerceLocale(row.locale), settings: parseSettings(row.settings) }
      : await this.seed(guildId)

    this.cache.set(guildId, resolved)
    return resolved
  }

  /** Read a single typed settings value with a sensible default already applied. */
  async getSettings(guildId: string): Promise<GuildSettings> {
    return (await this.get(guildId)).settings
  }

  /** Read the resolved locale for a guild. */
  async getLocale(guildId: string): Promise<Locale> {
    return (await this.get(guildId)).locale
  }

  /**
   * Merge a partial settings patch into the stored blob, validate the result,
   * persist it, and refresh the cache. Returns the new validated settings.
   */
  async setSettings(guildId: string, patch: DeepPartial<GuildSettings>): Promise<GuildSettings> {
    const current = await this.getSettings(guildId)
    const merged = parseSettings(deepMerge(current, patch))
    await this.persist(guildId, { settings: merged })
    return merged
  }

  /** Update the guild locale. Unknown values fall back to `en`. */
  async setLocale(guildId: string, locale: Locale): Promise<Locale> {
    const safe = coerceLocale(locale)
    await this.persist(guildId, { locale: safe })
    return safe
  }

  /** Drop a guild from the cache so the next read refetches from the DB. */
  invalidate(guildId: string): void {
    this.cache.delete(guildId)
  }

  /** Clear the entire cache. Useful after a bulk DB change. */
  clear(): void {
    this.cache.clear()
  }

  private async seed(guildId: string): Promise<GuildConfig> {
    const settings = guildSettingsSchema.parse({})
    await this.db
      .insert(guildConfig)
      .values({ guildId, locale: 'en', settings, updatedAt: Date.now() })
      .onConflictDoNothing()
    return { guildId, locale: 'en', settings }
  }

  private async persist(
    guildId: string,
    next: { locale?: Locale; settings?: GuildSettings },
  ): Promise<void> {
    const existing = await this.get(guildId)
    const locale = next.locale ?? existing.locale
    const settings = next.settings ?? existing.settings
    const updatedAt = Date.now()

    await this.db
      .insert(guildConfig)
      .values({ guildId, locale, settings, updatedAt })
      .onConflictDoUpdate({
        target: guildConfig.guildId,
        set: { locale, settings, updatedAt },
      })

    this.cache.set(guildId, { guildId, locale, settings })
  }
}

// ---- Small helpers --------------------------------------------------------

type DeepPartial<T> = T extends object ? { [K in keyof T]?: DeepPartial<T[K]> } : T

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Recursively merge `patch` into `base`. Arrays and primitives replace wholesale. */
function deepMerge<T>(base: T, patch: DeepPartial<T>): T {
  if (!isPlainObject(base) || !isPlainObject(patch)) return (patch as T) ?? base
  const out: Record<string, unknown> = { ...base }
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue
    const prev = out[key]
    out[key] = isPlainObject(prev) && isPlainObject(value) ? deepMerge(prev, value as never) : value
  }
  return out as T
}
