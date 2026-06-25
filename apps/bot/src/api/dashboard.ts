/**
 * Cross-cutting dashboard READ API.
 *
 * Feature modules register their own routes from their setup<Feature>(). This
 * module owns the endpoints the dashboard needs that span features and that no
 * single feature owns: the guild list, the per-guild overview, config, members,
 * moderation cases, analytics, audit log, and AI telemetry.
 *
 * Conventions for every handler here:
 *   - Query @nd/db through getDb() + schema with Drizzle only.
 *   - Resolve usernames / avatars from the discord.js client guild member +
 *     user caches (no network fetches in a read path).
 *   - Never throw. On any error or missing data return a safe empty shape so the
 *     dashboard degrades gracefully instead of erroring.
 */
import { and, count, desc, eq, gte, sql } from 'drizzle-orm'
import { container } from '@sapphire/framework'
import type { Client, Guild } from 'discord.js'
import { getDb, schema } from '@nd/db'
import { createLogger } from '@nd/core'
import { type ApiRouter, json } from './server.ts'

const log = createLogger('dashboard-api')

// ---- Small helpers --------------------------------------------------------

/** Parse a positive integer query param, clamped to [0, max], with a default. */
function intParam(url: URL, key: string, def: number, max: number): number {
  const raw = url.searchParams.get(key)
  if (raw === null) return def
  const n = Number.parseInt(raw, 10)
  if (!Number.isFinite(n) || n < 0) return def
  return Math.min(n, max)
}

/** Start-of-day (local server time) as unix ms, for "today" windows. */
function startOfTodayMs(): number {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/** Unix ms `days` ago. */
function daysAgoMs(days: number): number {
  return Date.now() - days * 24 * 60 * 60 * 1000
}

/** Format a unix-ms timestamp as a YYYY-MM-DD day key (UTC). */
function dayKey(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

interface ResolvedIdentity {
  username: string
  displayName: string
  avatarUrl: string | null
  joinedAt: number | null
}

/**
 * Resolve a user's identity from the guild member cache, falling back to the
 * user cache, then to the raw id. Pure cache reads, never a fetch.
 */
function resolveIdentity(guild: Guild | undefined, userId: string): ResolvedIdentity {
  const member = guild?.members.cache.get(userId)
  if (member) {
    return {
      username: member.user.username,
      displayName: member.displayName,
      avatarUrl: member.displayAvatarURL({ size: 128 }),
      joinedAt: member.joinedTimestamp ?? null,
    }
  }
  const user = guild?.client.users.cache.get(userId)
  if (user) {
    return {
      username: user.username,
      displayName: user.displayName,
      avatarUrl: user.displayAvatarURL({ size: 128 }),
      joinedAt: null,
    }
  }
  return { username: userId, displayName: userId, avatarUrl: null, joinedAt: null }
}

// ---- Registration ---------------------------------------------------------

export function registerDashboardApi(router: ApiRouter, client: Client): void {
  // GET /api/guilds -> { guilds: [{ id, name, memberCount, iconUrl }] }
  // Exact shape consumed by the web useGuild hook. Pure cache read.
  router.get('/api/guilds', () => {
    try {
      const guilds = client.guilds.cache.map((g) => ({
        id: g.id,
        name: g.name,
        memberCount: g.memberCount,
        iconUrl: g.iconURL({ size: 128 }),
      }))
      return json({ guilds })
    } catch (err) {
      log.error({ err }, 'GET /api/guilds failed')
      return json({ guilds: [] })
    }
  })

  // GET /api/guilds/:id/overview -> headline metrics for the dashboard home.
  router.get('/api/guilds/:id/overview', async ({ params }) => {
    const guildId = params.id ?? ''
    const empty = {
      members: 0,
      online: 0,
      openTickets: 0,
      casesToday: 0,
      totalEconomy: 0,
      messagesToday: 0,
      aiCallsToday: 0,
      uptimeSeconds: Math.round(process.uptime()),
    }
    try {
      const db = getDb()
      const guild = client.guilds.cache.get(guildId)
      const todayStart = startOfTodayMs()

      const members = guild?.memberCount ?? 0
      const online = guild
        ? guild.members.cache.filter(
            (m) => m.presence != null && m.presence.status !== 'offline',
          ).size
        : 0

      const [openTickets, casesToday, economyAgg, messagesToday, aiToday] = await Promise.all([
        db
          .select({ c: count() })
          .from(schema.tickets)
          .where(and(eq(schema.tickets.guildId, guildId), eq(schema.tickets.status, 'open'))),
        db
          .select({ c: count() })
          .from(schema.modCases)
          .where(
            and(eq(schema.modCases.guildId, guildId), gte(schema.modCases.createdAt, todayStart)),
          ),
        db
          .select({
            total: sql<number>`coalesce(sum(${schema.economy.wallet}) + sum(${schema.economy.bank}), 0)`,
          })
          .from(schema.economy)
          .where(eq(schema.economy.guildId, guildId)),
        db
          .select({ c: count() })
          .from(schema.analyticsEvents)
          .where(
            and(
              eq(schema.analyticsEvents.guildId, guildId),
              eq(schema.analyticsEvents.type, 'message'),
              gte(schema.analyticsEvents.createdAt, todayStart),
            ),
          ),
        db
          .select({ c: count() })
          .from(schema.aiTelemetry)
          .where(gte(schema.aiTelemetry.createdAt, todayStart)),
      ])

      return json({
        members,
        online,
        openTickets: openTickets[0]?.c ?? 0,
        casesToday: casesToday[0]?.c ?? 0,
        totalEconomy: Number(economyAgg[0]?.total ?? 0),
        messagesToday: messagesToday[0]?.c ?? 0,
        aiCallsToday: aiToday[0]?.c ?? 0,
        uptimeSeconds: Math.round(process.uptime()),
      })
    } catch (err) {
      log.error({ err, guildId }, 'GET overview failed')
      return json(empty)
    }
  })

  // GET /api/guilds/:id/config -> { locale, settings } via the shared ConfigService.
  router.get('/api/guilds/:id/config', async ({ params }) => {
    const guildId = params.id ?? ''
    try {
      const config = await container.config.get(guildId)
      return json({ locale: config.locale, settings: config.settings })
    } catch (err) {
      log.error({ err, guildId }, 'GET config failed')
      return json({ locale: 'en', settings: {} })
    }
  })

  // PATCH /api/guilds/:id/config (admin) -> persist the patch, return new config.
  router.register(
    'PATCH',
    '/api/guilds/:id/config',
    async ({ params, req }) => {
      const guildId = params.id ?? ''
      try {
        const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
        const patch = (body.settings ?? body) as Parameters<
          typeof container.config.setSettings
        >[1]
        const settings = await container.config.setSettings(guildId, patch)
        const config = await container.config.get(guildId)
        return json({ locale: config.locale, settings })
      } catch (err) {
        log.error({ err, guildId }, 'PATCH config failed')
        return json({ locale: 'en', settings: {} }, { status: 500 })
      }
    },
    { requireAdmin: true },
  )

  // GET /api/guilds/:id/members -> paginated member roster with level + economy.
  router.get('/api/guilds/:id/members', async ({ params, url }) => {
    const guildId = params.id ?? ''
    const limit = intParam(url, 'limit', 50, 200)
    const offset = intParam(url, 'offset', 0, Number.MAX_SAFE_INTEGER)
    const q = url.searchParams.get('q')?.trim() ?? ''
    const sortKey = url.searchParams.get('sort') ?? 'xp'

    try {
      const db = getDb()
      const guild = client.guilds.cache.get(guildId)

      // Warning count per user, scoped to this guild's warn cases.
      const warnCounts = db
        .select({
          userId: schema.modCases.userId,
          warnings: count().as('warnings'),
        })
        .from(schema.modCases)
        .where(and(eq(schema.modCases.guildId, guildId), eq(schema.modCases.action, 'warn')))
        .groupBy(schema.modCases.userId)
        .as('warn_counts')

      const baseWhere = eq(schema.levels.guildId, guildId)

      const orderBy = (() => {
        switch (sortKey) {
          case 'level':
            return desc(schema.levels.level)
          case 'wallet':
            return desc(sql`coalesce(${schema.economy.wallet}, 0)`)
          case 'bank':
            return desc(sql`coalesce(${schema.economy.bank}, 0)`)
          case 'messages':
            return desc(schema.levels.messages)
          default:
            return desc(schema.levels.xp)
        }
      })()

      const rows = await db
        .select({
          userId: schema.levels.userId,
          level: schema.levels.level,
          xp: schema.levels.xp,
          wallet: schema.economy.wallet,
          bank: schema.economy.bank,
          warnings: warnCounts.warnings,
        })
        .from(schema.levels)
        .leftJoin(
          schema.economy,
          and(
            eq(schema.economy.guildId, schema.levels.guildId),
            eq(schema.economy.userId, schema.levels.userId),
          ),
        )
        .leftJoin(warnCounts, eq(warnCounts.userId, schema.levels.userId))
        .where(baseWhere)
        .orderBy(orderBy)

      // Resolve identity from cache, then apply the text search across id /
      // username / display name (cache-side so it covers resolved names).
      const enriched = rows.map((r) => {
        const ident = resolveIdentity(guild, r.userId)
        return {
          userId: r.userId,
          username: ident.username,
          displayName: ident.displayName,
          avatarUrl: ident.avatarUrl,
          level: r.level ?? 0,
          xp: r.xp ?? 0,
          wallet: r.wallet ?? 0,
          bank: r.bank ?? 0,
          warnings: r.warnings ?? 0,
          joinedAt: ident.joinedAt,
        }
      })

      const filtered = q
        ? enriched.filter((m) => {
            const needle = q.toLowerCase()
            return (
              m.userId.includes(q) ||
              m.username.toLowerCase().includes(needle) ||
              m.displayName.toLowerCase().includes(needle)
            )
          })
        : enriched

      const total = filtered.length
      const page = filtered.slice(offset, offset + limit)
      return json({ members: page, total })
    } catch (err) {
      log.error({ err, guildId }, 'GET members failed')
      return json({ members: [], total: 0 })
    }
  })

  // GET /api/guilds/:id/members/:userId -> full member profile bundle.
  router.get('/api/guilds/:id/members/:userId', async ({ params }) => {
    const guildId = params.id ?? ''
    const userId = params.userId ?? ''
    try {
      const db = getDb()
      const guild = client.guilds.cache.get(guildId)
      const ident = resolveIdentity(guild, userId)

      const [levelRows, economyRows, cases, notes] = await Promise.all([
        db
          .select()
          .from(schema.levels)
          .where(and(eq(schema.levels.guildId, guildId), eq(schema.levels.userId, userId)))
          .limit(1),
        db
          .select()
          .from(schema.economy)
          .where(and(eq(schema.economy.guildId, guildId), eq(schema.economy.userId, userId)))
          .limit(1),
        db
          .select()
          .from(schema.modCases)
          .where(and(eq(schema.modCases.guildId, guildId), eq(schema.modCases.userId, userId)))
          .orderBy(desc(schema.modCases.createdAt))
          .limit(100),
        db
          .select()
          .from(schema.modNotes)
          .where(and(eq(schema.modNotes.guildId, guildId), eq(schema.modNotes.userId, userId)))
          .orderBy(desc(schema.modNotes.createdAt))
          .limit(100),
      ])

      const profile = {
        userId,
        username: ident.username,
        displayName: ident.displayName,
        avatarUrl: ident.avatarUrl,
        joinedAt: ident.joinedAt,
      }

      return json({
        profile,
        level: levelRows[0] ?? null,
        economy: economyRows[0] ?? null,
        cases,
        notes,
      })
    } catch (err) {
      log.error({ err, guildId, userId }, 'GET member profile failed')
      return json({ profile: null, level: null, economy: null, cases: [], notes: [] })
    }
  })

  // GET /api/guilds/:id/moderation/cases -> recent guild-wide cases, paginated.
  router.get('/api/guilds/:id/moderation/cases', async ({ params, url }) => {
    const guildId = params.id ?? ''
    const limit = intParam(url, 'limit', 50, 200)
    const offset = intParam(url, 'offset', 0, Number.MAX_SAFE_INTEGER)
    const action = url.searchParams.get('action')?.trim() ?? ''

    try {
      const db = getDb()
      const guild = client.guilds.cache.get(guildId)
      const where = action
        ? and(eq(schema.modCases.guildId, guildId), eq(schema.modCases.action, action))
        : eq(schema.modCases.guildId, guildId)

      const [rows, totals] = await Promise.all([
        db
          .select()
          .from(schema.modCases)
          .where(where)
          .orderBy(desc(schema.modCases.createdAt))
          .limit(limit)
          .offset(offset),
        db.select({ c: count() }).from(schema.modCases).where(where),
      ])

      const cases = rows.map((r) => {
        const target = resolveIdentity(guild, r.userId)
        const moderator = resolveIdentity(guild, r.moderatorId)
        return {
          ...r,
          username: target.username,
          displayName: target.displayName,
          avatarUrl: target.avatarUrl,
          moderatorName: moderator.displayName,
        }
      })

      return json({ cases, total: totals[0]?.c ?? 0 })
    } catch (err) {
      log.error({ err, guildId }, 'GET moderation cases failed')
      return json({ cases: [], total: 0 })
    }
  })

  // GET /api/guilds/:id/analytics -> 30-day daily series + breakdowns.
  router.get('/api/guilds/:id/analytics', async ({ params }) => {
    const guildId = params.id ?? ''
    try {
      const db = getDb()
      const since = daysAgoMs(30)

      const [events, ai, byTypeRows, topCommands] = await Promise.all([
        db
          .select({ type: schema.analyticsEvents.type, createdAt: schema.analyticsEvents.createdAt })
          .from(schema.analyticsEvents)
          .where(
            and(
              eq(schema.analyticsEvents.guildId, guildId),
              gte(schema.analyticsEvents.createdAt, since),
            ),
          ),
        db
          .select({ createdAt: schema.aiTelemetry.createdAt })
          .from(schema.aiTelemetry)
          .where(gte(schema.aiTelemetry.createdAt, since)),
        db
          .select({ type: schema.analyticsEvents.type, c: count() })
          .from(schema.analyticsEvents)
          .where(
            and(
              eq(schema.analyticsEvents.guildId, guildId),
              gte(schema.analyticsEvents.createdAt, since),
            ),
          )
          .groupBy(schema.analyticsEvents.type),
        db
          .select({
            name: sql<string>`json_extract(${schema.analyticsEvents.meta}, '$.command')`,
            c: count(),
          })
          .from(schema.analyticsEvents)
          .where(
            and(
              eq(schema.analyticsEvents.guildId, guildId),
              eq(schema.analyticsEvents.type, 'command'),
              gte(schema.analyticsEvents.createdAt, since),
            ),
          )
          .groupBy(sql`json_extract(${schema.analyticsEvents.meta}, '$.command')`)
          .orderBy(desc(count()))
          .limit(10),
      ])

      // Build a per-day bucket for the full window so the chart has no holes.
      interface DayBucket {
        date: string
        messages: number
        commands: number
        joins: number
        leaves: number
        ai: number
      }
      const buckets = new Map<string, DayBucket>()
      for (let i = 29; i >= 0; i--) {
        const key = dayKey(daysAgoMs(i))
        buckets.set(key, { date: key, messages: 0, commands: 0, joins: 0, leaves: 0, ai: 0 })
      }
      const bucketFor = (ms: number): DayBucket | undefined => buckets.get(dayKey(ms))

      for (const ev of events) {
        const bucket = bucketFor(ev.createdAt)
        if (!bucket) continue
        switch (ev.type) {
          case 'message':
            bucket.messages += 1
            break
          case 'command':
            bucket.commands += 1
            break
          case 'join':
            bucket.joins += 1
            break
          case 'leave':
            bucket.leaves += 1
            break
          default:
            break
        }
      }
      for (const row of ai) {
        const bucket = bucketFor(row.createdAt)
        if (bucket) bucket.ai += 1
      }

      const byType: Record<string, number> = {}
      for (const row of byTypeRows) byType[row.type] = row.c

      const topCommandList = topCommands
        .filter((r) => r.name != null && r.name !== '')
        .map((r) => ({ name: r.name, count: r.c }))

      return json({
        daily: [...buckets.values()],
        byType,
        topCommands: topCommandList,
      })
    } catch (err) {
      log.error({ err, guildId }, 'GET analytics failed')
      return json({ daily: [], byType: {}, topCommands: [] })
    }
  })

  // GET /api/guilds/:id/audit -> dashboard audit log, paginated.
  router.get('/api/guilds/:id/audit', async ({ url }) => {
    const limit = intParam(url, 'limit', 50, 200)
    const offset = intParam(url, 'offset', 0, Number.MAX_SAFE_INTEGER)
    try {
      const db = getDb()
      const [entries, totals] = await Promise.all([
        db
          .select()
          .from(schema.auditLog)
          .orderBy(desc(schema.auditLog.createdAt))
          .limit(limit)
          .offset(offset),
        db.select({ c: count() }).from(schema.auditLog),
      ])
      return json({ entries, total: totals[0]?.c ?? 0 })
    } catch (err) {
      log.error({ err }, 'GET audit failed')
      return json({ entries: [], total: 0 })
    }
  })

  // GET /api/guilds/:id/ai/telemetry -> AI usage rollup over the last 30 days.
  router.get('/api/guilds/:id/ai/telemetry', async () => {
    try {
      const db = getDb()
      const since = daysAgoMs(30)
      const sinceFilter = gte(schema.aiTelemetry.createdAt, since)

      const [totals, byProviderRows, byModelRows, dailyRows] = await Promise.all([
        db
          .select({
            calls: count(),
            avgLatency: sql<number>`coalesce(avg(${schema.aiTelemetry.latencyMs}), 0)`,
            cached: sql<number>`coalesce(sum(case when ${schema.aiTelemetry.cached} then 1 else 0 end), 0)`,
          })
          .from(schema.aiTelemetry)
          .where(sinceFilter),
        db
          .select({ provider: schema.aiTelemetry.provider, c: count() })
          .from(schema.aiTelemetry)
          .where(sinceFilter)
          .groupBy(schema.aiTelemetry.provider),
        db
          .select({ model: schema.aiTelemetry.model, c: count() })
          .from(schema.aiTelemetry)
          .where(sinceFilter)
          .groupBy(schema.aiTelemetry.model),
        db
          .select({
            day: sql<string>`date(${schema.aiTelemetry.createdAt} / 1000, 'unixepoch')`,
            c: count(),
          })
          .from(schema.aiTelemetry)
          .where(sinceFilter)
          .groupBy(sql`date(${schema.aiTelemetry.createdAt} / 1000, 'unixepoch')`)
          .orderBy(sql`date(${schema.aiTelemetry.createdAt} / 1000, 'unixepoch')`),
      ])

      const totalCalls = totals[0]?.calls ?? 0
      const cachedCount = Number(totals[0]?.cached ?? 0)

      const byProvider: Record<string, number> = {}
      for (const row of byProviderRows) byProvider[row.provider] = row.c
      const byModel: Record<string, number> = {}
      for (const row of byModelRows) byModel[row.model] = row.c

      return json({
        totalCalls,
        byProvider,
        byModel,
        avgLatencyMs: Math.round(Number(totals[0]?.avgLatency ?? 0)),
        cachedRate: totalCalls > 0 ? cachedCount / totalCalls : 0,
        dailyCalls: dailyRows.map((r) => ({ date: r.day, count: r.c })),
      })
    } catch (err) {
      log.error({ err }, 'GET ai telemetry failed')
      return json({
        totalCalls: 0,
        byProvider: {},
        byModel: {},
        avgLatencyMs: 0,
        cachedRate: 0,
        dailyCalls: [],
      })
    }
  })
}
