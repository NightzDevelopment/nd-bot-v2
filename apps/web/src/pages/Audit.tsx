import { useEffect, useMemo, useState } from 'react'
import { Panel } from '../components/ui/Panel'
import { Button } from '../components/ui/Button'
import { StatusDot } from '../components/ui/StatusDot'
import { Table } from '../components/ui/Table'
import type { Column } from '../components/ui/Table'
import { api, ApiError } from '../lib/api'
import { useGuild } from '../lib/useGuild'

/** Shape returned by GET /api/guilds/:id/audit (see apps/bot/src/api/dashboard.ts). */
interface AuditEntry extends Record<string, unknown> {
  id: number
  actorId: string
  action: string
  target: string | null
  details: unknown
  ip: string | null
  createdAt: number
}

interface AuditResponse {
  entries: AuditEntry[]
  total: number
}

const PAGE_SIZE = 50

/** Format a unix-ms timestamp as a compact local date + time. */
function formatTime(ms: number): string {
  if (!Number.isFinite(ms)) return '--'
  const d = new Date(ms)
  if (Number.isNaN(d.getTime())) return '--'
  const date = d.toLocaleDateString(undefined, { month: 'short', day: '2-digit' })
  const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false })
  return `${date} ${time}`
}

/** Pretty-print a details payload as JSON, tolerating strings and nulls. */
function stringifyDetails(details: unknown): string {
  if (details === null || details === undefined) return 'null'
  if (typeof details === 'string') {
    try {
      return JSON.stringify(JSON.parse(details), null, 2)
    } catch {
      return details
    }
  }
  try {
    return JSON.stringify(details, null, 2)
  } catch {
    return String(details)
  }
}

export default function AuditPage() {
  const { guildId, loading: guildLoading } = useGuild()

  const [entries, setEntries] = useState<AuditEntry[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(0)
  const [actionFilter, setActionFilter] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<number | null>(null)

  useEffect(() => {
    if (!guildId) return
    const ctrl = new AbortController()
    setLoading(true)
    setError(null)

    api
      .get<AuditResponse>(
        `/api/guilds/${guildId}/audit`,
        { limit: PAGE_SIZE, offset: page * PAGE_SIZE },
        ctrl.signal,
      )
      .then((res) => {
        setEntries(Array.isArray(res.entries) ? res.entries : [])
        setTotal(typeof res.total === 'number' ? res.total : 0)
        setLoading(false)
      })
      .catch((err: unknown) => {
        if (ctrl.signal.aborted) return
        const message = err instanceof ApiError ? err.message : 'Failed to load audit log'
        setError(message)
        setEntries([])
        setTotal(0)
        setLoading(false)
      })

    return () => ctrl.abort()
  }, [guildId, page])

  // Distinct actions present on the current page, for the filter dropdown.
  const actions = useMemo(() => {
    const set = new Set<string>()
    for (const e of entries) set.add(e.action)
    return [...set].sort()
  }, [entries])

  const filtered = useMemo(
    () => (actionFilter ? entries.filter((e) => e.action === actionFilter) : entries),
    [entries, actionFilter],
  )

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const rangeStart = total === 0 ? 0 : page * PAGE_SIZE + 1
  const rangeEnd = Math.min(total, page * PAGE_SIZE + entries.length)

  const columns: Column<AuditEntry>[] = [
    {
      key: 'createdAt',
      header: 'Time',
      className: 'whitespace-nowrap text-sentinel-muted',
      cell: (row) => formatTime(row.createdAt),
    },
    {
      key: 'actorId',
      header: 'Actor',
      className: 'font-mono text-sentinel-text',
      cell: (row) => row.actorId || '--',
    },
    {
      key: 'action',
      header: 'Action',
      cell: (row) => (
        <span className="uppercase tracking-[0.08em] text-sentinel-primary">{row.action}</span>
      ),
    },
    {
      key: 'target',
      header: 'Target',
      className: 'font-mono text-sentinel-muted',
      cell: (row) => row.target || '--',
    },
    {
      key: 'details',
      header: 'Details',
      cell: (row) => {
        const isOpen = expanded === row.id
        return (
          <Button
            variant="ghost"
            className="px-2 py-1 text-[10px]"
            onClick={() => setExpanded(isOpen ? null : row.id)}
          >
            {isOpen ? 'Hide' : 'View'}
          </Button>
        )
      },
    },
  ]

  // Render with inline expansion: we cannot inject extra rows through the shared
  // Table, so when a row is expanded we surface its JSON in a panel below.
  const expandedEntry = expanded !== null ? entries.find((e) => e.id === expanded) ?? null : null

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4">
      <Panel
        title="Audit Log"
        tag={
          <StatusDot
            status={error ? 'alert' : loading ? 'idle' : 'online'}
            label={error ? 'Error' : loading ? 'Loading' : 'Live'}
          />
        }
      >
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-[11px] uppercase tracking-[0.12em] text-sentinel-muted">
            Action
            <select
              value={actionFilter}
              onChange={(e) => setActionFilter(e.target.value)}
              className="rounded border border-sentinel-border bg-sentinel-bg px-2 py-1 text-xs text-sentinel-text focus:border-sentinel-primary focus:outline-none"
            >
              <option value="">All</option>
              {actions.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          </label>
          <span className="text-[11px] uppercase tracking-[0.12em] text-sentinel-muted">
            {total} total
          </span>
        </div>
      </Panel>

      <Panel
        title="Entries"
        bodyClassName="p-0"
        tag={
          <span className="text-[11px] text-sentinel-muted">
            {rangeStart}-{rangeEnd} of {total}
          </span>
        }
      >
        {guildLoading || loading ? (
          <div className="px-3 py-8 text-center text-[11px] uppercase tracking-[0.18em] text-sentinel-muted">
            Loading audit log
          </div>
        ) : error ? (
          <div className="px-3 py-8 text-center text-xs text-sentinel-alert">{error}</div>
        ) : !guildId ? (
          <div className="px-3 py-8 text-center text-[11px] uppercase tracking-[0.18em] text-sentinel-muted">
            No guild connected
          </div>
        ) : (
          <Table
            columns={columns}
            rows={filtered}
            rowKey={(row) => row.id}
            empty={actionFilter ? 'No entries match this action' : 'No audit entries'}
          />
        )}
      </Panel>

      {expandedEntry && (
        <Panel
          title={`Details / #${expandedEntry.id}`}
          tag={
            <Button variant="ghost" className="px-2 py-1 text-[10px]" onClick={() => setExpanded(null)}>
              Close
            </Button>
          }
        >
          <div className="mb-3 grid grid-cols-1 gap-2 text-xs sm:grid-cols-3">
            <div>
              <div className="text-[10px] uppercase tracking-[0.12em] text-sentinel-muted">Actor</div>
              <div className="font-mono text-sentinel-text">{expandedEntry.actorId || '--'}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-[0.12em] text-sentinel-muted">IP</div>
              <div className="font-mono text-sentinel-text">{expandedEntry.ip || '--'}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-[0.12em] text-sentinel-muted">Time</div>
              <div className="text-sentinel-text">{formatTime(expandedEntry.createdAt)}</div>
            </div>
          </div>
          <pre className="overflow-x-auto rounded border border-sentinel-border bg-sentinel-bg p-3 text-[11px] leading-relaxed text-sentinel-text">
            {stringifyDetails(expandedEntry.details)}
          </pre>
        </Panel>
      )}

      <div className="flex items-center justify-between">
        <Button
          variant="ghost"
          disabled={page === 0 || loading}
          onClick={() => {
            setExpanded(null)
            setPage((p) => Math.max(0, p - 1))
          }}
        >
          Prev
        </Button>
        <span className="text-[11px] uppercase tracking-[0.12em] text-sentinel-muted">
          Page {page + 1} / {totalPages}
        </span>
        <Button
          variant="ghost"
          disabled={page + 1 >= totalPages || loading}
          onClick={() => {
            setExpanded(null)
            setPage((p) => p + 1)
          }}
        >
          Next
        </Button>
      </div>
    </div>
  )
}
