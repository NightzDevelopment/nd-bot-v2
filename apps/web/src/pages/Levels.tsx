import { useEffect, useMemo, useState } from 'react'
import { Panel } from '../components/ui/Panel'
import { Button } from '../components/ui/Button'
import { StatField } from '../components/ui/StatField'
import { StatusDot } from '../components/ui/StatusDot'
import { Table } from '../components/ui/Table'
import type { Column } from '../components/ui/Table'
import { api, ApiError } from '../lib/api'
import { useGuild } from '../lib/useGuild'

/**
 * Levels page.
 *
 * Reads three live bot endpoints for the current guild:
 *   - GET /api/guilds/:id/levels/leaderboard -> { total, limit, offset, entries }
 *   - GET /api/guilds/:id/levels/roles       -> { roles: [{ level, roleId }] }
 *   - GET /api/guilds/:id/levels/members/:userId -> { userId, xp, level, messages, rank, total }
 *
 * The leaderboard returns raw userIds (the bot does not resolve names on this
 * route), so members render by id. XP progress within a level is computed from
 * the same quadratic curve the bot uses (CURVE_BASE / CURVE_GROWTH), since the
 * endpoint does not return per-level floor/ceil.
 */

// ---- XP curve (mirrors apps/bot/src/features/levels/leveling.ts) ----------

const CURVE_BASE = 100
const CURVE_GROWTH = 50

/** Total cumulative XP required to have reached `level`. */
function xpForLevel(level: number): number {
  if (level <= 0) return 0
  const n = level
  return CURVE_BASE * n + CURVE_GROWTH * ((n * (n - 1)) / 2)
}

/** Progress within the current level for a given total xp + known level. */
function progressFor(xp: number, level: number): { current: number; needed: number; pct: number } {
  const floor = xpForLevel(level)
  const ceil = xpForLevel(level + 1)
  const needed = Math.max(1, ceil - floor)
  const current = Math.max(0, Math.min(needed, xp - floor))
  return { current, needed, pct: Math.round((current / needed) * 100) }
}

// ---- Endpoint shapes ------------------------------------------------------

interface LeaderboardEntry {
  rank: number
  userId: string
  xp: number
  level: number
  messages: number
}

interface LeaderboardResponse {
  total: number
  limit: number
  offset: number
  entries: LeaderboardEntry[]
}

interface LevelRoleRow {
  level: number
  roleId: string
}

interface RolesResponse {
  roles: LevelRoleRow[]
}

interface RankResponse {
  userId: string
  xp: number
  level: number
  messages: number
  rank: number
  total: number
}

// ---- Table row types ------------------------------------------------------

interface LeaderboardRow extends Record<string, unknown> {
  rank: number
  userId: string
  level: number
  xp: number
  messages: number
}

interface RoleRow extends Record<string, unknown> {
  level: number
  roleId: string
}

const PAGE_SIZE = 25

function formatNum(n: number): string {
  return n.toLocaleString('en-US')
}

/** Inline Sentinel XP progress bar: current / needed within the level. */
function XpBar({ xp, level }: { xp: number; level: number }) {
  const { current, needed, pct } = progressFor(xp, level)
  return (
    <div className="flex min-w-[160px] flex-col gap-1">
      <div className="h-1.5 w-full overflow-hidden rounded-[2px] border border-sentinel-border bg-sentinel-bg">
        <div
          className="h-full bg-sentinel-primary"
          style={{ width: `${pct}%` }}
          aria-hidden="true"
        />
      </div>
      <span className="text-[10px] tabular-nums text-sentinel-muted">
        {formatNum(current)} / {formatNum(needed)} XP
      </span>
    </div>
  )
}

export default function LevelsPage() {
  const { guildId, loading: guildLoading } = useGuild()

  // Leaderboard + roles state.
  const [board, setBoard] = useState<LeaderboardResponse | null>(null)
  const [roles, setRoles] = useState<LevelRoleRow[]>([])
  const [page, setPage] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Member rank lookup state.
  const [lookupId, setLookupId] = useState('')
  const [rank, setRank] = useState<RankResponse | null>(null)
  const [rankLoading, setRankLoading] = useState(false)
  const [rankError, setRankError] = useState<string | null>(null)

  useEffect(() => {
    if (!guildId) return
    const ctrl = new AbortController()
    setLoading(true)
    setError(null)

    const offset = page * PAGE_SIZE
    Promise.all([
      api.get<LeaderboardResponse>(
        `/api/guilds/${guildId}/levels/leaderboard`,
        { limit: PAGE_SIZE, offset },
        ctrl.signal,
      ),
      api.get<RolesResponse>(`/api/guilds/${guildId}/levels/roles`, undefined, ctrl.signal),
    ])
      .then(([boardRes, rolesRes]) => {
        setBoard(boardRes)
        setRoles(rolesRes.roles ?? [])
        setLoading(false)
      })
      .catch((err: unknown) => {
        if (ctrl.signal.aborted) return
        const message =
          err instanceof ApiError ? err.message : 'Failed to load level data'
        setError(message)
        setLoading(false)
      })

    return () => ctrl.abort()
  }, [guildId, page])

  const entries = board?.entries ?? []
  const total = board?.total ?? 0
  const hasNext = (page + 1) * PAGE_SIZE < total
  const hasPrev = page > 0

  const leaderboardRows: LeaderboardRow[] = useMemo(
    () =>
      entries.map((e) => ({
        rank: e.rank,
        userId: e.userId,
        level: e.level,
        xp: e.xp,
        messages: e.messages,
      })),
    [entries],
  )

  const roleRows: RoleRow[] = useMemo(
    () => roles.map((r) => ({ level: r.level, roleId: r.roleId })),
    [roles],
  )

  const leaderboardColumns: Column<LeaderboardRow>[] = [
    {
      key: 'rank',
      header: '#',
      className: 'w-12 tabular-nums',
      cell: (row) => (
        <span className={row.rank <= 3 ? 'text-sentinel-active' : 'text-sentinel-muted'}>
          {String(row.rank).padStart(2, '0')}
        </span>
      ),
    },
    {
      key: 'userId',
      header: 'Member',
      cell: (row) => <span className="font-mono text-sentinel-text">{row.userId}</span>,
    },
    {
      key: 'level',
      header: 'Level',
      className: 'w-16 tabular-nums',
      cell: (row) => <span className="text-sentinel-primary">{formatNum(row.level)}</span>,
    },
    {
      key: 'progress',
      header: 'Progress',
      cell: (row) => <XpBar xp={row.xp} level={row.level} />,
    },
    {
      key: 'xp',
      header: 'Total XP',
      className: 'w-24 tabular-nums text-sentinel-muted',
      cell: (row) => formatNum(row.xp),
    },
    {
      key: 'messages',
      header: 'Msgs',
      className: 'w-20 tabular-nums text-sentinel-muted',
      cell: (row) => formatNum(row.messages),
    },
  ]

  const roleColumns: Column<RoleRow>[] = [
    {
      key: 'level',
      header: 'Level',
      className: 'w-20 tabular-nums',
      cell: (row) => <span className="text-sentinel-primary">{formatNum(row.level)}</span>,
    },
    {
      key: 'roleId',
      header: 'Role',
      cell: (row) => <span className="font-mono text-sentinel-text">@{row.roleId}</span>,
    },
  ]

  function runLookup() {
    const id = lookupId.trim()
    if (!guildId || !id) return
    setRankLoading(true)
    setRankError(null)
    setRank(null)
    api
      .get<RankResponse>(`/api/guilds/${guildId}/levels/members/${id}`)
      .then((res) => {
        setRank(res)
        setRankLoading(false)
      })
      .catch((err: unknown) => {
        const message =
          err instanceof ApiError
            ? err.status === 404
              ? 'No level data for that member'
              : err.message
            : 'Lookup failed'
        setRankError(message)
        setRankLoading(false)
      })
  }

  // ---- Render states ------------------------------------------------------

  if (guildLoading) {
    return (
      <div className="mx-auto max-w-6xl">
        <Panel title="Levels" tag={<StatusDot status="idle" label="Loading" />}>
          <p className="text-sm text-sentinel-muted">Resolving guild...</p>
        </Panel>
      </div>
    )
  }

  if (!guildId) {
    return (
      <div className="mx-auto max-w-6xl">
        <Panel title="Levels" tag={<StatusDot status="offline" label="No guild" />}>
          <p className="text-sm text-sentinel-muted">No connected guild to report levels for.</p>
        </Panel>
      </div>
    )
  }

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Panel>
          <StatField
            label="Ranked members"
            value={loading ? '--' : formatNum(total)}
            tone="primary"
            sub="With XP on record"
          />
        </Panel>
        <Panel>
          <StatField
            label="Level roles"
            value={loading ? '--' : formatNum(roles.length)}
            sub="Configured rewards"
          />
        </Panel>
        <Panel>
          <StatField
            label="Top level"
            value={loading || entries.length === 0 ? '--' : formatNum(entries[0]?.level ?? 0)}
            tone="active"
            sub={
              loading || entries.length === 0
                ? 'No leader yet'
                : `${formatNum(entries[0]?.xp ?? 0)} XP`
            }
          />
        </Panel>
      </div>

      <Panel title="Member rank lookup">
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={lookupId}
              onChange={(e) => setLookupId(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') runLookup()
              }}
              placeholder="User ID"
              spellCheck={false}
              className="w-full max-w-xs rounded-[4px] border border-sentinel-border bg-sentinel-bg px-3 py-1.5 font-mono text-xs text-sentinel-text placeholder:text-sentinel-muted focus:border-sentinel-primary focus:outline-none sm:w-64"
            />
            <Button
              variant="primary"
              onClick={runLookup}
              disabled={rankLoading || lookupId.trim() === ''}
            >
              {rankLoading ? 'Looking...' : 'Look up'}
            </Button>
          </div>

          {rankError !== null && (
            <p className="text-[11px] uppercase tracking-[0.12em] text-sentinel-alert">{rankError}</p>
          )}

          {rank !== null && (
            <div className="grid grid-cols-2 gap-4 border-t border-sentinel-border pt-3 sm:grid-cols-5">
              <StatField label="Rank" value={`#${formatNum(rank.rank)}`} tone="active" sub={`of ${formatNum(rank.total)}`} />
              <StatField label="Level" value={formatNum(rank.level)} tone="primary" />
              <StatField label="Total XP" value={formatNum(rank.xp)} />
              <StatField label="Messages" value={formatNum(rank.messages)} />
              <div className="col-span-2 flex flex-col justify-end gap-1 sm:col-span-1">
                <span className="hud-label">Progress</span>
                <XpBar xp={rank.xp} level={rank.level} />
              </div>
            </div>
          )}
        </div>
      </Panel>

      <Panel
        title="XP leaderboard"
        tag={
          loading ? (
            <StatusDot status="idle" label="Loading" />
          ) : error ? (
            <StatusDot status="alert" label="Error" />
          ) : (
            <span className="tabular-nums">
              {total === 0 ? '0' : `${page * PAGE_SIZE + 1}-${Math.min((page + 1) * PAGE_SIZE, total)}`} / {formatNum(total)}
            </span>
          )
        }
      >
        {error !== null ? (
          <div className="flex flex-col gap-3 py-4">
            <p className="text-sm text-sentinel-alert">{error}</p>
            <div>
              <Button onClick={() => setPage((p) => p)}>Retry</Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <Table
              columns={leaderboardColumns}
              rows={loading ? [] : leaderboardRows}
              rowKey={(row) => row.userId}
              empty={loading ? 'LOADING...' : 'NO RANKED MEMBERS'}
            />
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-sentinel-muted">
                Page {page + 1}
              </span>
              <div className="flex gap-2">
                <Button onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={!hasPrev || loading}>
                  Prev
                </Button>
                <Button onClick={() => setPage((p) => p + 1)} disabled={!hasNext || loading}>
                  Next
                </Button>
              </div>
            </div>
          </div>
        )}
      </Panel>

      <Panel
        title="Level roles"
        tag={<span className="tabular-nums text-sentinel-muted">{formatNum(roles.length)}</span>}
      >
        <Table
          columns={roleColumns}
          rows={loading ? [] : roleRows}
          rowKey={(row) => `${row.level}-${row.roleId}`}
          empty={loading ? 'LOADING...' : 'NO LEVEL ROLES CONFIGURED'}
        />
      </Panel>
    </div>
  )
}
