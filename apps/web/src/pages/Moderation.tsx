import { useCallback, useEffect, useMemo, useState } from 'react'
import { Panel } from '../components/ui/Panel'
import { Button } from '../components/ui/Button'
import { StatusDot } from '../components/ui/StatusDot'
import { StatField } from '../components/ui/StatField'
import { Table } from '../components/ui/Table'
import type { Column } from '../components/ui/Table'
import { api, ApiError } from '../lib/api'
import { useGuild } from '../lib/useGuild'

// ---- API response shapes (mirror apps/bot/src/api/dashboard.ts) ------------

interface ModCase extends Record<string, unknown> {
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
  // resolved fields added by the API
  username: string
  displayName: string
  avatarUrl: string | null
  moderatorName: string
}

interface ModNote extends Record<string, unknown> {
  id: number
  guildId: string
  userId: string
  authorId: string
  note: string
  severity: string
  createdAt: number
}

interface MemberProfile {
  userId: string
  username: string
  displayName: string
  avatarUrl: string | null
  joinedAt: number | null
}

interface CasesResponse {
  cases: ModCase[]
  total: number
}

interface MemberResponse {
  profile: MemberProfile | null
  level: { level?: number; xp?: number } | null
  economy: { wallet?: number; bank?: number } | null
  cases: ModCase[]
  notes: ModNote[]
}

// ---- Action presentation helpers ------------------------------------------

type Badge = { label: string; cls: string }

/** Map a mod action to a Sentinel-styled badge. Bans alert, warns caution. */
function actionBadge(action: string): Badge {
  const a = action.toLowerCase()
  switch (a) {
    case 'ban':
    case 'unban':
      return { label: a, cls: 'border-sentinel-alert text-sentinel-alert bg-sentinel-alert/10' }
    case 'kick':
      return { label: a, cls: 'border-sentinel-alert text-sentinel-alert bg-sentinel-alert/5' }
    case 'warn':
    case 'mute':
    case 'timeout':
      return {
        label: a,
        cls: 'border-sentinel-caution text-sentinel-caution bg-sentinel-caution/10',
      }
    default:
      return { label: a, cls: 'border-sentinel-border text-sentinel-muted bg-transparent' }
  }
}

function ActionBadge({ action }: { action: string }) {
  const badge = actionBadge(action)
  return (
    <span
      className={`inline-block rounded-[4px] border px-2 py-0.5 text-[10px] uppercase tracking-[0.12em] ${badge.cls}`}
    >
      {badge.label}
    </span>
  )
}

function severityClass(severity: string): string {
  switch (severity.toLowerCase()) {
    case 'high':
      return 'text-sentinel-alert'
    case 'warn':
      return 'text-sentinel-caution'
    default:
      return 'text-sentinel-muted'
  }
}

/** Compact local timestamp. */
function fmtTime(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '--'
  const d = new Date(ms)
  return d.toLocaleString(undefined, {
    year: '2-digit',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

// The action filter set. Empty value == all actions.
const ACTION_FILTERS: { value: string; label: string }[] = [
  { value: '', label: 'All' },
  { value: 'ban', label: 'Ban' },
  { value: 'kick', label: 'Kick' },
  { value: 'mute', label: 'Mute' },
  { value: 'timeout', label: 'Timeout' },
  { value: 'warn', label: 'Warn' },
  { value: 'unban', label: 'Unban' },
  { value: 'note', label: 'Note' },
]

// ---- Recent cases columns -------------------------------------------------

const caseColumns: Column<ModCase>[] = [
  {
    key: 'action',
    header: 'Action',
    cell: (row) => <ActionBadge action={row.action} />,
  },
  {
    key: 'displayName',
    header: 'User',
    cell: (row) => (
      <span className="flex flex-col">
        <span className="text-sentinel-text">{row.displayName}</span>
        <span className="text-[10px] text-sentinel-muted">{row.userId}</span>
      </span>
    ),
  },
  {
    key: 'moderatorName',
    header: 'Moderator',
    className: 'text-sentinel-muted',
  },
  {
    key: 'reason',
    header: 'Reason',
    cell: (row) => (
      <span className="text-sentinel-muted">{row.reason?.trim() || 'No reason given'}</span>
    ),
  },
  {
    key: 'active',
    header: 'State',
    cell: (row) =>
      row.active ? (
        <StatusDot status="online" label="active" />
      ) : (
        <StatusDot status="offline" label="closed" />
      ),
  },
  {
    key: 'createdAt',
    header: 'Time',
    className: 'whitespace-nowrap text-sentinel-muted',
    cell: (row) => fmtTime(row.createdAt),
  },
]

// ---- Page -----------------------------------------------------------------

export default function ModerationPage() {
  const { guildId, loading: guildLoading } = useGuild()

  // Recent cases state
  const [actionFilter, setActionFilter] = useState('')
  const [cases, setCases] = useState<ModCase[]>([])
  const [total, setTotal] = useState(0)
  const [casesLoading, setCasesLoading] = useState(true)
  const [casesError, setCasesError] = useState<string | null>(null)

  // Member lookup state
  const [lookupInput, setLookupInput] = useState('')
  const [lookupId, setLookupId] = useState<string | null>(null)
  const [member, setMember] = useState<MemberResponse | null>(null)
  const [memberLoading, setMemberLoading] = useState(false)
  const [memberError, setMemberError] = useState<string | null>(null)

  // Fetch recent cases when guild or filter changes.
  useEffect(() => {
    if (!guildId) return
    const ctrl = new AbortController()
    setCasesLoading(true)
    setCasesError(null)

    const query: Record<string, string | number> = { limit: 100 }
    if (actionFilter) query.action = actionFilter

    api
      .get<CasesResponse>(
        `/api/guilds/${guildId}/moderation/cases`,
        query,
        ctrl.signal,
      )
      .then((res) => {
        setCases(res.cases ?? [])
        setTotal(res.total ?? 0)
        setCasesLoading(false)
      })
      .catch((err: unknown) => {
        if (ctrl.signal.aborted) return
        setCasesError(err instanceof ApiError ? err.message : 'Failed to load cases')
        setCases([])
        setTotal(0)
        setCasesLoading(false)
      })

    return () => ctrl.abort()
  }, [guildId, actionFilter])

  // Fetch member profile when a lookup id is committed.
  useEffect(() => {
    if (!guildId || !lookupId) return
    const ctrl = new AbortController()
    setMemberLoading(true)
    setMemberError(null)
    setMember(null)

    api
      .get<MemberResponse>(
        `/api/guilds/${guildId}/members/${encodeURIComponent(lookupId)}`,
        undefined,
        ctrl.signal,
      )
      .then((res) => {
        setMember(res)
        setMemberLoading(false)
      })
      .catch((err: unknown) => {
        if (ctrl.signal.aborted) return
        setMemberError(err instanceof ApiError ? err.message : 'Failed to load member')
        setMemberLoading(false)
      })

    return () => ctrl.abort()
  }, [guildId, lookupId])

  const submitLookup = useCallback(() => {
    const trimmed = lookupInput.trim()
    if (trimmed) setLookupId(trimmed)
  }, [lookupInput])

  // Quick action breakdown for the header stats.
  const breakdown = useMemo(() => {
    const counts = { ban: 0, warn: 0, other: 0 }
    for (const c of cases) {
      const a = c.action.toLowerCase()
      if (a === 'ban' || a === 'unban' || a === 'kick') counts.ban += 1
      else if (a === 'warn' || a === 'mute' || a === 'timeout') counts.warn += 1
      else counts.other += 1
    }
    return counts
  }, [cases])

  if (guildLoading) {
    return (
      <div className="mx-auto max-w-6xl">
        <Panel title="Moderation">
          <p className="text-sm text-sentinel-muted">Loading guild...</p>
        </Panel>
      </div>
    )
  }

  if (!guildId) {
    return (
      <div className="mx-auto max-w-6xl">
        <Panel title="Moderation">
          <p className="text-sm text-sentinel-alert">No guild connected.</p>
        </Panel>
      </div>
    )
  }

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4">
      {/* Headline counts for the loaded case window. */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Panel>
          <StatField label="Total cases" value={total} sub="In this guild" />
        </Panel>
        <Panel>
          <StatField
            label="Severe (loaded)"
            value={breakdown.ban}
            tone="alert"
            sub="Ban / kick"
          />
        </Panel>
        <Panel>
          <StatField
            label="Warnings (loaded)"
            value={breakdown.warn}
            tone="caution"
            sub="Warn / mute / timeout"
          />
        </Panel>
        <Panel>
          <StatField label="Shown" value={cases.length} sub="Rows in view" />
        </Panel>
      </div>

      {/* Member lookup */}
      <Panel title="Member lookup">
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={lookupInput}
              onChange={(e) => setLookupInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submitLookup()
              }}
              placeholder="User ID"
              spellCheck={false}
              className="w-full max-w-xs rounded-[4px] border border-sentinel-border bg-sentinel-bg px-3 py-1.5 text-xs text-sentinel-text placeholder:text-sentinel-muted focus:border-sentinel-primary focus:outline-none sm:w-auto"
            />
            <Button variant="primary" onClick={submitLookup}>
              Lookup
            </Button>
            {lookupId !== null && (
              <Button
                variant="ghost"
                onClick={() => {
                  setLookupId(null)
                  setMember(null)
                  setMemberError(null)
                  setLookupInput('')
                }}
              >
                Clear
              </Button>
            )}
          </div>

          {lookupId === null ? (
            <p className="text-[11px] text-sentinel-muted">
              Enter a Discord user ID to view their cases and notes.
            </p>
          ) : memberLoading ? (
            <p className="text-sm text-sentinel-muted">Loading member...</p>
          ) : memberError ? (
            <p className="text-sm text-sentinel-alert">{memberError}</p>
          ) : member && member.profile ? (
            <MemberDetail data={member} />
          ) : (
            <p className="text-sm text-sentinel-muted">
              No record found for{' '}
              <span className="text-sentinel-text">{lookupId}</span>.
            </p>
          )}
        </div>
      </Panel>

      {/* Recent cases */}
      <Panel
        title="Recent cases"
        tag={
          casesLoading ? (
            <StatusDot status="idle" label="Loading" />
          ) : (
            <span>{`${cases.length} shown`}</span>
          )
        }
      >
        <div className="mb-3 flex flex-wrap gap-1.5">
          {ACTION_FILTERS.map((f) => {
            const selected = actionFilter === f.value
            return (
              <button
                key={f.value || 'all'}
                type="button"
                onClick={() => setActionFilter(f.value)}
                className={`rounded-[4px] border px-2.5 py-1 text-[10px] uppercase tracking-[0.12em] transition-colors ${
                  selected
                    ? 'border-sentinel-primary bg-sentinel-primary/20 text-sentinel-text'
                    : 'border-sentinel-border bg-transparent text-sentinel-muted hover:bg-sentinel-hover hover:text-sentinel-text'
                }`}
              >
                {f.label}
              </button>
            )
          })}
        </div>

        {casesError ? (
          <p className="px-1 py-4 text-sm text-sentinel-alert">{casesError}</p>
        ) : casesLoading ? (
          <p className="px-1 py-4 text-sm text-sentinel-muted">Loading cases...</p>
        ) : (
          <Table
            columns={caseColumns}
            rows={cases}
            rowKey={(row) => row.id}
            empty={actionFilter ? `No ${actionFilter} cases` : 'No cases recorded'}
          />
        )}
      </Panel>
    </div>
  )
}

// ---- Member detail sub-view -----------------------------------------------

const memberCaseColumns: Column<ModCase>[] = [
  { key: 'action', header: 'Action', cell: (row) => <ActionBadge action={row.action} /> },
  {
    key: 'reason',
    header: 'Reason',
    cell: (row) => (
      <span className="text-sentinel-muted">{row.reason?.trim() || 'No reason given'}</span>
    ),
  },
  {
    key: 'createdAt',
    header: 'Time',
    className: 'whitespace-nowrap text-sentinel-muted',
    cell: (row) => fmtTime(row.createdAt),
  },
]

function MemberDetail({ data }: { data: MemberResponse }) {
  const { profile, cases, notes } = data
  if (!profile) return null

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3 border-b border-sentinel-border pb-3">
        {profile.avatarUrl ? (
          <img
            src={profile.avatarUrl}
            alt=""
            className="h-10 w-10 rounded-[4px] border border-sentinel-border"
          />
        ) : (
          <div className="flex h-10 w-10 items-center justify-center rounded-[4px] border border-sentinel-border text-sentinel-muted">
            ?
          </div>
        )}
        <div className="flex flex-col">
          <span className="text-sentinel-text">{profile.displayName}</span>
          <span className="text-[10px] text-sentinel-muted">
            @{profile.username} {' / '} {profile.userId}
          </span>
        </div>
        <div className="ml-auto flex gap-6">
          <StatField label="Cases" value={cases.length} />
          <StatField label="Notes" value={notes.length} />
        </div>
      </div>

      <div>
        <h3 className="mb-2 text-[11px] uppercase tracking-[0.18em] text-sentinel-muted">
          Cases
        </h3>
        <Table
          columns={memberCaseColumns}
          rows={cases}
          rowKey={(row) => row.id}
          empty="No cases for this member"
        />
      </div>

      <div>
        <h3 className="mb-2 text-[11px] uppercase tracking-[0.18em] text-sentinel-muted">
          Notes
        </h3>
        {notes.length === 0 ? (
          <p className="px-1 py-2 text-[11px] uppercase tracking-[0.18em] text-sentinel-muted">
            No notes
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {notes.map((n) => (
              <li
                key={n.id}
                className="rounded-[4px] border border-sentinel-border bg-sentinel-bg px-3 py-2"
              >
                <div className="flex items-center justify-between gap-2">
                  <span
                    className={`text-[10px] uppercase tracking-[0.12em] ${severityClass(n.severity)}`}
                  >
                    {n.severity}
                  </span>
                  <span className="text-[10px] text-sentinel-muted">{fmtTime(n.createdAt)}</span>
                </div>
                <p className="mt-1 text-xs text-sentinel-text">{n.note}</p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
