import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { Button } from '../components/ui/Button'
import { Panel } from '../components/ui/Panel'
import { StatField } from '../components/ui/StatField'
import { StatusDot } from '../components/ui/StatusDot'
import { Table } from '../components/ui/Table'
import type { Column } from '../components/ui/Table'
import { ApiError, api } from '../lib/api'
import { useGuild } from '../lib/useGuild'

// ---- API response shapes (mirror apps/bot/src/api/dashboard.ts) ------------

interface MemberRow extends Record<string, unknown> {
  userId: string
  username: string
  displayName: string
  avatarUrl: string | null
  level: number
  xp: number
  wallet: number
  bank: number
  warnings: number
  joinedAt: number | null
}

interface MembersResponse {
  members: MemberRow[]
  total: number
}

interface ModCase {
  id: number
  guildId: string
  userId: string
  moderatorId: string
  action: string
  reason: string | null
  durationMs: number | null
  active: boolean
  createdAt: number
  expiresAt: number | null
}

interface ModNote {
  id: number
  guildId: string
  userId: string
  authorId: string
  note: string
  severity: string
  createdAt: number
}

interface LevelRow {
  guildId: string
  userId: string
  xp: number
  level: number
  messages: number
  lastMessageAt: number | null
}

interface EconomyRow {
  guildId: string
  userId: string
  wallet: number
  bank: number
  lastDailyAt: number | null
  lastWorkAt: number | null
  lastCrimeAt: number | null
  streak: number
}

interface MemberProfile {
  profile: {
    userId: string
    username: string
    displayName: string
    avatarUrl: string | null
    joinedAt: number | null
  } | null
  level: LevelRow | null
  economy: EconomyRow | null
  cases: ModCase[]
  notes: ModNote[]
}

// ---- Sorting -------------------------------------------------------------

// The bot supports server-side sort for these keys. `warnings` is not a
// server sort key, so we sort that one client-side over the current page.
type SortKey = 'xp' | 'level' | 'wallet' | 'warnings'

const SORT_LABELS: Record<SortKey, string> = {
  level: 'Level',
  xp: 'XP',
  wallet: 'Wallet',
  warnings: 'Warnings',
}

const SERVER_SORT: Record<SortKey, string> = {
  xp: 'xp',
  level: 'level',
  wallet: 'wallet',
  warnings: 'xp', // fall back to xp on the server; resort by warnings locally
}

const PAGE_SIZE = 25

// ---- Formatting helpers --------------------------------------------------

function fmtNum(n: number): string {
  return n.toLocaleString('en-US')
}

function fmtDate(ms: number | null): string {
  if (ms == null) return '--'
  try {
    return new Date(ms).toLocaleString('en-US', {
      year: 'numeric',
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return '--'
  }
}

function fmtDay(ms: number | null): string {
  if (ms == null) return '--'
  try {
    return new Date(ms).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: '2-digit',
    })
  } catch {
    return '--'
  }
}

function caseStatus(c: ModCase): 'online' | 'idle' | 'offline' | 'alert' {
  if (c.action === 'ban' || c.action === 'kick') return 'alert'
  if (c.action === 'warn' || c.action === 'mute' || c.action === 'timeout') return 'idle'
  return 'offline'
}

// ---- Avatar --------------------------------------------------------------

function Avatar({ url, name, size = 24 }: { url: string | null; name: string; size?: number }) {
  const initial = (name || '?').slice(0, 1).toUpperCase()
  if (url) {
    return (
      <img
        src={url}
        alt=""
        width={size}
        height={size}
        className="rounded-[4px] border border-sentinel-border object-cover"
        style={{ width: size, height: size }}
      />
    )
  }
  return (
    <span
      className="inline-flex items-center justify-center rounded-[4px] border border-sentinel-border bg-sentinel-hover text-[10px] text-sentinel-muted"
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      {initial}
    </span>
  )
}

// ---- Detail drawer -------------------------------------------------------

function Drawer({
  guildId,
  userId,
  onClose,
}: {
  guildId: string
  userId: string
  onClose: () => void
}) {
  const [data, setData] = useState<MemberProfile | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError(null)
    api
      .get<MemberProfile>(
        `/api/guilds/${guildId}/members/${userId}`,
        undefined,
        controller.signal,
      )
      .then((res) => {
        setData(res)
        setLoading(false)
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return
        setError(err instanceof ApiError ? err.message : 'Failed to load member profile')
        setLoading(false)
      })
    return () => controller.abort()
  }, [guildId, userId])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const profile = data?.profile
  const name = profile?.displayName ?? userId

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button
        type="button"
        aria-label="Close drawer"
        className="absolute inset-0 bg-black/60"
        onClick={onClose}
      />
      <aside className="relative flex h-full w-full max-w-md flex-col border-l border-sentinel-border bg-sentinel-panel">
        <header className="flex items-center justify-between border-b border-sentinel-border px-3 py-2">
          <div className="flex items-center gap-2 overflow-hidden">
            <Avatar url={profile?.avatarUrl ?? null} name={name} size={28} />
            <div className="overflow-hidden">
              <div className="truncate text-xs uppercase tracking-[0.14em] text-sentinel-text">
                {name}
              </div>
              <div className="truncate text-[10px] text-sentinel-muted">{userId}</div>
            </div>
          </div>
          <Button onClick={onClose}>Close</Button>
        </header>

        <div className="flex-1 space-y-3 overflow-y-auto p-3">
          {loading && (
            <p className="text-[11px] uppercase tracking-[0.18em] text-sentinel-muted">
              Loading profile...
            </p>
          )}

          {error && !loading && (
            <Panel title="Error" tag={<StatusDot status="alert" label="Failed" />}>
              <p className="text-xs text-sentinel-alert">{error}</p>
            </Panel>
          )}

          {!loading && !error && data && (
            <>
              <div className="grid grid-cols-2 gap-2">
                <Panel bodyClassName="p-2">
                  <StatField
                    label="Level"
                    value={data.level?.level ?? 0}
                    tone="active"
                    sub={`${fmtNum(data.level?.xp ?? 0)} XP`}
                  />
                </Panel>
                <Panel bodyClassName="p-2">
                  <StatField
                    label="Messages"
                    value={fmtNum(data.level?.messages ?? 0)}
                    sub="Tracked"
                  />
                </Panel>
                <Panel bodyClassName="p-2">
                  <StatField
                    label="Wallet"
                    value={fmtNum(data.economy?.wallet ?? 0)}
                    tone="primary"
                    sub={`Bank ${fmtNum(data.economy?.bank ?? 0)}`}
                  />
                </Panel>
                <Panel bodyClassName="p-2">
                  <StatField
                    label="Warnings"
                    value={data.cases.filter((c) => c.action === 'warn').length}
                    tone={
                      data.cases.some((c) => c.action === 'warn') ? 'caution' : 'default'
                    }
                    sub={`${data.cases.length} total cases`}
                  />
                </Panel>
              </div>

              <Panel title="Identity">
                <dl className="space-y-1 text-xs">
                  <div className="flex justify-between gap-3">
                    <dt className="text-sentinel-muted">Username</dt>
                    <dd className="truncate text-sentinel-text">{profile?.username ?? '--'}</dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-sentinel-muted">Streak</dt>
                    <dd className="text-sentinel-text">{fmtNum(data.economy?.streak ?? 0)}</dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-sentinel-muted">Joined</dt>
                    <dd className="text-sentinel-text">{fmtDay(profile?.joinedAt ?? null)}</dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-sentinel-muted">Last message</dt>
                    <dd className="text-sentinel-text">
                      {fmtDate(data.level?.lastMessageAt ?? null)}
                    </dd>
                  </div>
                </dl>
              </Panel>

              <Panel
                title="Mod cases"
                tag={<span className="text-sentinel-muted">{data.cases.length}</span>}
              >
                {data.cases.length === 0 ? (
                  <p className="text-[11px] uppercase tracking-[0.18em] text-sentinel-muted">
                    No cases on record
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {data.cases.map((c) => (
                      <li
                        key={c.id}
                        className="border border-sentinel-border/60 rounded-[4px] p-2"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <StatusDot status={caseStatus(c)} label={c.action} />
                          <span className="text-[10px] text-sentinel-muted">
                            {fmtDate(c.createdAt)}
                          </span>
                        </div>
                        {c.reason && (
                          <p className="mt-1 text-xs text-sentinel-text">{c.reason}</p>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </Panel>

              <Panel
                title="Notes"
                tag={<span className="text-sentinel-muted">{data.notes.length}</span>}
              >
                {data.notes.length === 0 ? (
                  <p className="text-[11px] uppercase tracking-[0.18em] text-sentinel-muted">
                    No notes
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {data.notes.map((n) => (
                      <li
                        key={n.id}
                        className="border border-sentinel-border/60 rounded-[4px] p-2"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[10px] uppercase tracking-[0.12em] text-sentinel-muted">
                            {n.severity}
                          </span>
                          <span className="text-[10px] text-sentinel-muted">
                            {fmtDate(n.createdAt)}
                          </span>
                        </div>
                        <p className="mt-1 text-xs text-sentinel-text">{n.note}</p>
                      </li>
                    ))}
                  </ul>
                )}
              </Panel>
            </>
          )}
        </div>
      </aside>
    </div>
  )
}

// ---- Page ----------------------------------------------------------------

export default function MembersPage() {
  const { guildId, loading: guildLoading } = useGuild()

  const [search, setSearch] = useState('')
  const [q, setQ] = useState('')
  const [sort, setSort] = useState<SortKey>('xp')
  const [offset, setOffset] = useState(0)

  const [members, setMembers] = useState<MemberRow[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [selected, setSelected] = useState<string | null>(null)

  // Debounce the search box into the actual query param.
  useEffect(() => {
    const id = setTimeout(() => {
      setQ(search.trim())
      setOffset(0)
    }, 300)
    return () => clearTimeout(id)
  }, [search])

  const fetchMembers = useCallback(
    (signal: AbortSignal) => {
      if (!guildId) return
      setLoading(true)
      setError(null)
      api
        .get<MembersResponse>(
          `/api/guilds/${guildId}/members`,
          { limit: PAGE_SIZE, offset, sort: SERVER_SORT[sort], q: q || undefined },
          signal,
        )
        .then((res) => {
          setMembers(res.members ?? [])
          setTotal(res.total ?? 0)
          setLoading(false)
        })
        .catch((err: unknown) => {
          if (signal.aborted) return
          setError(err instanceof ApiError ? err.message : 'Failed to load members')
          setMembers([])
          setTotal(0)
          setLoading(false)
        })
    },
    [guildId, offset, sort, q],
  )

  useEffect(() => {
    if (guildLoading) return
    const controller = new AbortController()
    fetchMembers(controller.signal)
    return () => controller.abort()
  }, [guildLoading, fetchMembers])

  // `warnings` is sorted client-side over the returned page.
  const rows = useMemo(() => {
    if (sort !== 'warnings') return members
    return [...members].sort((a, b) => b.warnings - a.warnings)
  }, [members, sort])

  // The shared Table primitive does not expose an onRowClick prop. To keep a
  // real "click a row" affordance without forking shared UI, every cell wraps
  // its content in a button that opens the drawer for that row.
  const columns = useMemo<Column<MemberRow>[]>(() => {
    const clickable = (row: MemberRow, content: ReactNode) => (
      <button
        type="button"
        onClick={() => setSelected(row.userId)}
        className="-mx-1 flex w-full items-center px-1 text-left"
      >
        {content}
      </button>
    )
    return [
      {
        key: 'member',
        header: 'Member',
        cell: (row) =>
          clickable(
            row,
            <span className="flex items-center gap-2">
              <Avatar url={row.avatarUrl} name={row.displayName} />
              <span className="flex flex-col leading-tight">
                <span className="text-sentinel-text">{row.displayName}</span>
                <span className="text-[10px] text-sentinel-muted">{row.userId}</span>
              </span>
            </span>,
          ),
      },
      {
        key: 'level',
        header: 'Level',
        cell: (row) => clickable(row, <span className="text-sentinel-active">{row.level}</span>),
      },
      {
        key: 'xp',
        header: 'XP',
        cell: (row) =>
          clickable(row, <span className="text-sentinel-muted">{fmtNum(row.xp)}</span>),
      },
      {
        key: 'wallet',
        header: 'Wallet',
        cell: (row) =>
          clickable(row, <span className="text-sentinel-primary">{fmtNum(row.wallet)}</span>),
      },
      {
        key: 'warnings',
        header: 'Warn',
        cell: (row) =>
          clickable(
            row,
            <span className={row.warnings > 0 ? 'text-sentinel-caution' : 'text-sentinel-muted'}>
              {row.warnings}
            </span>,
          ),
      },
    ]
  }, [])

  const pageStart = total === 0 ? 0 : offset + 1
  const pageEnd = Math.min(offset + PAGE_SIZE, total)
  const canPrev = offset > 0
  const canNext = offset + PAGE_SIZE < total

  if (guildLoading) {
    return (
      <div className="mx-auto max-w-6xl">
        <Panel title="Members" tag={<StatusDot status="idle" label="Loading" />}>
          <p className="text-[11px] uppercase tracking-[0.18em] text-sentinel-muted">
            Resolving guild...
          </p>
        </Panel>
      </div>
    )
  }

  if (!guildId) {
    return (
      <div className="mx-auto max-w-6xl">
        <Panel title="Members" tag={<StatusDot status="offline" label="No guild" />}>
          <p className="text-xs text-sentinel-muted">
            No guild connected. Members will appear once the bot joins a server.
          </p>
        </Panel>
      </div>
    )
  }

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4">
      <Panel
        title="Member directory"
        tag={
          <StatusDot
            status={loading ? 'idle' : 'online'}
            label={loading ? 'Loading' : `${fmtNum(total)} total`}
          />
        }
      >
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name or id..."
              className="min-w-[200px] flex-1 rounded-[4px] border border-sentinel-border bg-sentinel-bg px-3 py-1.5 text-xs text-sentinel-text placeholder:text-sentinel-muted focus:border-sentinel-primary focus:outline-none"
            />
            <div className="flex items-center gap-1">
              <span className="hud-label text-sentinel-muted">Sort</span>
              {(Object.keys(SORT_LABELS) as SortKey[]).map((key) => (
                <Button
                  key={key}
                  variant={sort === key ? 'primary' : 'ghost'}
                  onClick={() => {
                    setSort(key)
                    setOffset(0)
                  }}
                >
                  {SORT_LABELS[key]}
                </Button>
              ))}
            </div>
          </div>

          {error ? (
            <div className="rounded-[4px] border border-sentinel-alert/50 bg-sentinel-alert/10 px-3 py-2">
              <p className="text-xs text-sentinel-alert">{error}</p>
            </div>
          ) : (
            <Table
              columns={columns}
              rows={rows}
              rowKey={(row) => row.userId}
              empty={loading ? 'LOADING...' : 'NO MEMBERS'}
              className="cursor-pointer"
            />
          )}

          <div className="flex items-center justify-between border-t border-sentinel-border pt-2">
            <span className="text-[11px] text-sentinel-muted">
              {total === 0 ? 'No results' : `${pageStart}-${pageEnd} of ${fmtNum(total)}`}
            </span>
            <div className="flex items-center gap-1">
              <Button
                disabled={!canPrev || loading}
                onClick={() => setOffset((o) => Math.max(0, o - PAGE_SIZE))}
              >
                Prev
              </Button>
              <Button
                disabled={!canNext || loading}
                onClick={() => setOffset((o) => o + PAGE_SIZE)}
              >
                Next
              </Button>
            </div>
          </div>
        </div>
      </Panel>

      {selected && (
        <Drawer guildId={guildId} userId={selected} onClose={() => setSelected(null)} />
      )}
    </div>
  )
}
