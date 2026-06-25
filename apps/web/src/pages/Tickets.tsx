import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button } from '../components/ui/Button'
import { Panel } from '../components/ui/Panel'
import { StatusDot } from '../components/ui/StatusDot'
import type { Status } from '../components/ui/StatusDot'
import { Table } from '../components/ui/Table'
import type { Column } from '../components/ui/Table'
import { api, ApiError } from '../lib/api'
import { useGuild } from '../lib/useGuild'

/** A persisted ticket row as returned by the bot dashboard API. */
interface Ticket extends Record<string, unknown> {
  id: number
  guildId: string
  channelId: string
  userId: string
  category: string | null
  status: string
  claimedBy: string | null
  priority: string | null
  subject: string | null
  createdAt: number
  closedAt: number | null
  closedBy: string | null
}

interface TicketsResponse {
  tickets: Ticket[]
}

interface TranscriptResponse {
  ticket: Ticket
  transcript: string
}

type TabKey = 'open' | 'claimed' | 'closed'

const TABS: { key: TabKey; label: string }[] = [
  { key: 'open', label: 'Open' },
  { key: 'claimed', label: 'Claimed' },
  { key: 'closed', label: 'Closed' },
]

/** Map a ticket status to the Sentinel StatusDot tone. */
function statusTone(status: string): Status {
  switch (status) {
    case 'open':
      return 'online'
    case 'claimed':
      return 'idle'
    case 'closed':
      return 'offline'
    default:
      return 'alert'
  }
}

/** Truncate long ids so the table stays compact. */
function shortId(id: string | null): string {
  if (!id) return '--'
  return id.length > 10 ? `${id.slice(0, 6)}...${id.slice(-4)}` : id
}

/** Format a unix-ms timestamp as a compact local date + time. */
function formatTime(ms: number | null): string {
  if (!ms) return '--'
  const d = new Date(ms)
  if (Number.isNaN(d.getTime())) return '--'
  return d.toLocaleString(undefined, {
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export default function TicketsPage() {
  const { guildId, loading: guildLoading } = useGuild()

  const [tickets, setTickets] = useState<Ticket[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<TabKey>('open')

  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [transcript, setTranscript] = useState<TranscriptResponse | null>(null)
  const [transcriptLoading, setTranscriptLoading] = useState(false)
  const [transcriptError, setTranscriptError] = useState<string | null>(null)

  // Load the ticket list for the active guild.
  useEffect(() => {
    if (guildLoading) return
    if (!guildId) {
      setTickets([])
      setLoading(false)
      return
    }

    const controller = new AbortController()
    setLoading(true)
    setError(null)

    api
      .get<TicketsResponse>(`/api/guilds/${guildId}/tickets`, undefined, controller.signal)
      .then((res) => {
        setTickets(Array.isArray(res.tickets) ? res.tickets : [])
        setLoading(false)
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return
        const message = err instanceof ApiError ? err.message : 'Failed to load tickets'
        setError(message)
        setTickets([])
        setLoading(false)
      })

    return () => controller.abort()
  }, [guildId, guildLoading])

  // Load the transcript whenever a ticket is selected.
  useEffect(() => {
    if (selectedId === null) {
      setTranscript(null)
      setTranscriptError(null)
      return
    }

    const controller = new AbortController()
    setTranscriptLoading(true)
    setTranscriptError(null)
    setTranscript(null)

    api
      .get<TranscriptResponse>(`/api/tickets/${selectedId}/transcript`, undefined, controller.signal)
      .then((res) => {
        setTranscript(res)
        setTranscriptLoading(false)
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return
        const message =
          err instanceof ApiError && err.status === 404
            ? 'Ticket not found'
            : err instanceof ApiError
              ? err.message
              : 'Failed to load transcript'
        setTranscriptError(message)
        setTranscriptLoading(false)
      })

    return () => controller.abort()
  }, [selectedId])

  const closeTranscript = useCallback(() => setSelectedId(null), [])

  const counts = useMemo(() => {
    const acc: Record<TabKey, number> = { open: 0, claimed: 0, closed: 0 }
    for (const t of tickets) {
      if (t.status === 'open') acc.open += 1
      else if (t.status === 'claimed') acc.claimed += 1
      else if (t.status === 'closed') acc.closed += 1
    }
    return acc
  }, [tickets])

  const visible = useMemo(() => tickets.filter((t) => t.status === tab), [tickets, tab])

  const columns: Column<Ticket>[] = useMemo(
    () => [
      {
        key: 'id',
        header: 'ID',
        className: 'w-16 text-sentinel-muted',
        cell: (row) => <span className="tabular-nums">#{row.id}</span>,
      },
      {
        key: 'userId',
        header: 'User',
        cell: (row) => (
          <span className="font-mono text-sentinel-text" title={row.userId}>
            {shortId(row.userId)}
          </span>
        ),
      },
      {
        key: 'subject',
        header: 'Subject',
        cell: (row) => (
          <span className="text-sentinel-text">
            {row.subject && row.subject.trim().length > 0 ? (
              row.subject
            ) : (
              <span className="text-sentinel-muted">--</span>
            )}
            {row.category ? (
              <span className="ml-2 text-[10px] uppercase tracking-[0.12em] text-sentinel-muted">
                [{row.category}]
              </span>
            ) : null}
          </span>
        ),
      },
      {
        key: 'claimedBy',
        header: 'Claimed by',
        cell: (row) =>
          row.claimedBy ? (
            <span className="font-mono text-sentinel-text" title={row.claimedBy}>
              {shortId(row.claimedBy)}
            </span>
          ) : (
            <span className="text-sentinel-muted">--</span>
          ),
      },
      {
        key: 'createdAt',
        header: 'Created',
        className: 'whitespace-nowrap text-sentinel-muted',
        cell: (row) => <span className="tabular-nums">{formatTime(row.createdAt)}</span>,
      },
      {
        key: 'actions',
        header: '',
        className: 'w-20 text-right',
        cell: (row) => (
          <Button
            variant={selectedId === row.id ? 'primary' : 'ghost'}
            onClick={() => setSelectedId(row.id)}
          >
            View
          </Button>
        ),
      },
    ],
    [selectedId],
  )

  const renderList = () => {
    if (guildLoading || loading) {
      return (
        <p className="px-3 py-6 text-center text-[11px] uppercase tracking-[0.18em] text-sentinel-muted">
          Loading tickets...
        </p>
      )
    }
    if (!guildId) {
      return (
        <p className="px-3 py-6 text-center text-[11px] uppercase tracking-[0.18em] text-sentinel-muted">
          No guild connected
        </p>
      )
    }
    if (error) {
      return (
        <div className="px-3 py-6 text-center">
          <p className="text-[11px] uppercase tracking-[0.18em] text-sentinel-alert">{error}</p>
        </div>
      )
    }
    return (
      <Table
        columns={columns}
        rows={visible}
        rowKey={(row) => row.id}
        empty={`No ${tab} tickets`}
      />
    )
  }

  const renderTranscript = () => {
    if (selectedId === null) {
      return (
        <p className="text-[11px] uppercase tracking-[0.16em] text-sentinel-muted">
          Select a ticket to view its transcript
        </p>
      )
    }
    if (transcriptLoading) {
      return (
        <p className="text-[11px] uppercase tracking-[0.16em] text-sentinel-muted">
          Loading transcript...
        </p>
      )
    }
    if (transcriptError) {
      return (
        <p className="text-[11px] uppercase tracking-[0.16em] text-sentinel-alert">
          {transcriptError}
        </p>
      )
    }
    if (!transcript) {
      return (
        <p className="text-[11px] uppercase tracking-[0.16em] text-sentinel-muted">
          No transcript available
        </p>
      )
    }

    const t = transcript.ticket
    return (
      <div className="flex flex-col gap-3">
        <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
          <div>
            <dt className="text-[10px] uppercase tracking-[0.14em] text-sentinel-muted">Ticket</dt>
            <dd className="text-sentinel-text">#{t.id}</dd>
          </div>
          <div>
            <dt className="text-[10px] uppercase tracking-[0.14em] text-sentinel-muted">Status</dt>
            <dd>
              <StatusDot status={statusTone(t.status)} label={t.status} />
            </dd>
          </div>
          <div>
            <dt className="text-[10px] uppercase tracking-[0.14em] text-sentinel-muted">User</dt>
            <dd className="font-mono text-sentinel-text" title={t.userId}>
              {shortId(t.userId)}
            </dd>
          </div>
          <div>
            <dt className="text-[10px] uppercase tracking-[0.14em] text-sentinel-muted">
              Priority
            </dt>
            <dd className="text-sentinel-text">{t.priority ?? '--'}</dd>
          </div>
          <div className="col-span-2">
            <dt className="text-[10px] uppercase tracking-[0.14em] text-sentinel-muted">Subject</dt>
            <dd className="text-sentinel-text">{t.subject ?? '--'}</dd>
          </div>
          <div>
            <dt className="text-[10px] uppercase tracking-[0.14em] text-sentinel-muted">Created</dt>
            <dd className="tabular-nums text-sentinel-text">{formatTime(t.createdAt)}</dd>
          </div>
          <div>
            <dt className="text-[10px] uppercase tracking-[0.14em] text-sentinel-muted">Closed</dt>
            <dd className="tabular-nums text-sentinel-text">{formatTime(t.closedAt)}</dd>
          </div>
        </dl>

        <div className="border-t border-sentinel-border pt-3">
          <p className="mb-2 text-[10px] uppercase tracking-[0.14em] text-sentinel-muted">
            Transcript
          </p>
          <pre className="max-h-[60vh] overflow-auto whitespace-pre-wrap break-words rounded-[4px] border border-sentinel-border bg-sentinel-bg p-3 text-[11px] leading-relaxed text-sentinel-text">
            {transcript.transcript || 'No messages were recorded.'}
          </pre>
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_minmax(320px,420px)]">
        <Panel
          title="Tickets"
          tag={
            <StatusDot
              status={loading ? 'idle' : 'online'}
              label={loading ? 'Loading' : `${tickets.length} total`}
            />
          }
          bodyClassName="p-0"
        >
          <div className="flex flex-wrap items-center gap-1 border-b border-sentinel-border px-3 py-2">
            {TABS.map((entry) => {
              const active = tab === entry.key
              return (
                <button
                  key={entry.key}
                  type="button"
                  onClick={() => setTab(entry.key)}
                  className={[
                    'rounded-[4px] border px-3 py-1 text-[11px] uppercase tracking-[0.12em] transition-colors',
                    active
                      ? 'border-sentinel-primary bg-sentinel-primary/15 text-sentinel-text'
                      : 'border-sentinel-border bg-transparent text-sentinel-muted hover:bg-sentinel-hover hover:text-sentinel-text',
                  ].join(' ')}
                >
                  {entry.label}
                  <span className="ml-2 tabular-nums text-sentinel-muted">
                    {counts[entry.key]}
                  </span>
                </button>
              )
            })}
          </div>
          {renderList()}
        </Panel>

        <Panel
          title="Transcript"
          tag={
            selectedId !== null ? (
              <Button variant="ghost" onClick={closeTranscript}>
                Close
              </Button>
            ) : undefined
          }
        >
          {renderTranscript()}
        </Panel>
      </div>
    </div>
  )
}
