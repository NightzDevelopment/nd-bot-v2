import { useCallback, useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { Panel } from '../components/ui/Panel'
import { Button } from '../components/ui/Button'
import { StatField } from '../components/ui/StatField'
import { StatusDot } from '../components/ui/StatusDot'
import { Table } from '../components/ui/Table'
import type { Column } from '../components/ui/Table'
import { api, ApiError } from '../lib/api'
import { useGuild } from '../lib/useGuild'

// ---- API response shapes (mirror apps/bot ai-support + dashboard routes) ----

interface KnowledgeDoc extends Record<string, unknown> {
  id: number
  source: string
  title: string
  content: string
  updatedAt: number
}

interface KnowledgeResponse {
  docs: KnowledgeDoc[]
}

interface TelemetryResponse {
  totalCalls: number
  byProvider: Record<string, number>
  byModel: Record<string, number>
  avgLatencyMs: number
  cachedRate: number
  dailyCalls: Array<{ date: string; count: number }>
}

interface ActivityEvent extends Record<string, unknown> {
  id: number
  guildId: string
  userId: string
  channelId: string
  createdAt: number
}

interface ActivityResponse {
  events: ActivityEvent[]
}

const EMPTY_TELEMETRY: TelemetryResponse = {
  totalCalls: 0,
  byProvider: {},
  byModel: {},
  avgLatencyMs: 0,
  cachedRate: 0,
  dailyCalls: [],
}

const SOURCES = ['rules', 'faq', 'fivem', 'store', 'custom'] as const
type Source = (typeof SOURCES)[number]

// ---- Small format helpers --------------------------------------------------

function fmtNumber(n: number): string {
  return n.toLocaleString('en-US')
}

function fmtPercent(rate: number): string {
  return `${Math.round(rate * 100)}%`
}

function fmtTime(ms: number): string {
  try {
    return new Date(ms).toLocaleString('en-US', {
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    })
  } catch {
    return String(ms)
  }
}

function shortId(id: string): string {
  if (!id) return '--'
  return id.length > 6 ? `...${id.slice(-6)}` : id
}

// ---- Breakdown bars (CSS, no deps) -----------------------------------------

function BreakdownBars({
  data,
  total,
}: {
  data: Record<string, number>
  total: number
}) {
  const rows = Object.entries(data).sort((a, b) => b[1] - a[1])
  if (rows.length === 0) {
    return <p className="text-[11px] uppercase tracking-[0.18em] text-sentinel-muted">No data</p>
  }
  const max = Math.max(...rows.map(([, v]) => v), 1)
  return (
    <div className="flex flex-col gap-2">
      {rows.map(([label, value]) => {
        const pct = total > 0 ? (value / total) * 100 : 0
        const width = (value / max) * 100
        return (
          <div key={label} className="flex flex-col gap-1">
            <div className="flex items-center justify-between text-[11px]">
              <span className="truncate text-sentinel-text">{label}</span>
              <span className="text-sentinel-muted">
                {fmtNumber(value)} / {Math.round(pct)}%
              </span>
            </div>
            <div className="h-1.5 w-full bg-sentinel-bg">
              <div
                className="h-full bg-sentinel-primary"
                style={{ width: `${Math.max(width, 2)}%` }}
              />
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ---- Daily calls bar chart (inline SVG) ------------------------------------

function DailyCallsChart({ data }: { data: Array<{ date: string; count: number }> }) {
  if (data.length === 0) {
    return (
      <div className="flex h-32 items-center justify-center text-[11px] uppercase tracking-[0.18em] text-sentinel-muted">
        No calls in window
      </div>
    )
  }

  const width = 600
  const height = 140
  const padBottom = 18
  const padTop = 8
  const plotH = height - padBottom - padTop
  const max = Math.max(...data.map((d) => d.count), 1)
  const slot = width / data.length
  const barW = Math.max(slot * 0.7, 1)

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width="100%"
      preserveAspectRatio="none"
      role="img"
      aria-label="Daily AI calls"
      className="block"
    >
      {data.map((d, i) => {
        const h = (d.count / max) * plotH
        const x = i * slot + (slot - barW) / 2
        const y = padTop + (plotH - h)
        return (
          <g key={d.date}>
            <rect
              x={x}
              y={y}
              width={barW}
              height={Math.max(h, d.count > 0 ? 1 : 0)}
              fill="var(--sentinel-bar, #3178C6)"
              className="fill-sentinel-primary"
            >
              <title>{`${d.date}: ${d.count}`}</title>
            </rect>
          </g>
        )
      })}
      <line
        x1={0}
        y1={padTop + plotH}
        x2={width}
        y2={padTop + plotH}
        stroke="#1E2A3A"
        strokeWidth={1}
      />
    </svg>
  )
}

// ---- Page ------------------------------------------------------------------

export default function AiPage() {
  const { guildId, loading: guildLoading } = useGuild()

  const [docs, setDocs] = useState<KnowledgeDoc[]>([])
  const [docsLoading, setDocsLoading] = useState(true)
  const [docsError, setDocsError] = useState<string | null>(null)

  const [telemetry, setTelemetry] = useState<TelemetryResponse>(EMPTY_TELEMETRY)
  const [telemetryLoading, setTelemetryLoading] = useState(true)
  const [telemetryError, setTelemetryError] = useState<string | null>(null)

  const [activity, setActivity] = useState<ActivityEvent[]>([])
  const [activityLoading, setActivityLoading] = useState(true)
  const [activityError, setActivityError] = useState<string | null>(null)

  // Add-doc form state.
  const [formSource, setFormSource] = useState<Source>('custom')
  const [formTitle, setFormTitle] = useState('')
  const [formContent, setFormContent] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [removingId, setRemovingId] = useState<number | null>(null)

  // ---- Fetch knowledge docs ----
  const loadDocs = useCallback((signal?: AbortSignal) => {
    setDocsLoading(true)
    setDocsError(null)
    api
      .get<KnowledgeResponse>('/api/ai/knowledge', undefined, signal)
      .then((res) => {
        setDocs(res.docs ?? [])
        setDocsLoading(false)
      })
      .catch((err) => {
        if (signal?.aborted) return
        setDocsError(err instanceof ApiError ? err.message : 'Failed to load knowledge base')
        setDocs([])
        setDocsLoading(false)
      })
  }, [])

  useEffect(() => {
    const ctrl = new AbortController()
    loadDocs(ctrl.signal)
    return () => ctrl.abort()
  }, [loadDocs])

  // ---- Fetch telemetry (per guild) ----
  useEffect(() => {
    if (guildLoading) return
    if (!guildId) {
      setTelemetry(EMPTY_TELEMETRY)
      setTelemetryLoading(false)
      return
    }
    const ctrl = new AbortController()
    setTelemetryLoading(true)
    setTelemetryError(null)
    api
      .get<TelemetryResponse>(`/api/guilds/${guildId}/ai/telemetry`, undefined, ctrl.signal)
      .then((res) => {
        setTelemetry({ ...EMPTY_TELEMETRY, ...res })
        setTelemetryLoading(false)
      })
      .catch((err) => {
        if (ctrl.signal.aborted) return
        setTelemetryError(err instanceof ApiError ? err.message : 'Failed to load usage telemetry')
        setTelemetry(EMPTY_TELEMETRY)
        setTelemetryLoading(false)
      })
    return () => ctrl.abort()
  }, [guildId, guildLoading])

  // ---- Fetch recent activity ----
  useEffect(() => {
    if (guildLoading) return
    const ctrl = new AbortController()
    setActivityLoading(true)
    setActivityError(null)
    const query = guildId ? { guildId } : undefined
    api
      .get<ActivityResponse>('/api/ai/activity', query, ctrl.signal)
      .then((res) => {
        setActivity(res.events ?? [])
        setActivityLoading(false)
      })
      .catch((err) => {
        if (ctrl.signal.aborted) return
        setActivityError(err instanceof ApiError ? err.message : 'Failed to load recent activity')
        setActivity([])
        setActivityLoading(false)
      })
    return () => ctrl.abort()
  }, [guildId, guildLoading])

  // ---- Add a knowledge doc ----
  const handleSubmit = useCallback(
    async (e: FormEvent) => {
      e.preventDefault()
      const title = formTitle.trim()
      const content = formContent.trim()
      if (!title || !content) {
        setFormError('Title and content are required.')
        return
      }
      setSubmitting(true)
      setFormError(null)
      try {
        await api.post('/api/ai/knowledge', { source: formSource, title, content })
        setFormTitle('')
        setFormContent('')
        setFormSource('custom')
        loadDocs()
      } catch (err) {
        setFormError(err instanceof ApiError ? err.message : 'Failed to add document.')
      } finally {
        setSubmitting(false)
      }
    },
    [formSource, formTitle, formContent, loadDocs],
  )

  // ---- Remove a knowledge doc ----
  const handleRemove = useCallback(
    async (id: number) => {
      setRemovingId(id)
      try {
        await api.del(`/api/ai/knowledge/${id}`)
        setDocs((prev) => prev.filter((d) => d.id !== id))
      } catch (err) {
        setDocsError(err instanceof ApiError ? err.message : 'Failed to remove document.')
      } finally {
        setRemovingId(null)
      }
    },
    [],
  )

  const cachedHits = useMemo(
    () => Math.round(telemetry.cachedRate * telemetry.totalCalls),
    [telemetry.cachedRate, telemetry.totalCalls],
  )

  const docColumns = useMemo<Column<KnowledgeDoc>[]>(
    () => [
      {
        key: 'source',
        header: 'Source',
        className: 'w-24',
        cell: (row) => (
          <span className="uppercase tracking-[0.12em] text-sentinel-primary">{row.source}</span>
        ),
      },
      {
        key: 'title',
        header: 'Title',
        cell: (row) => (
          <div className="flex flex-col gap-0.5">
            <span className="text-sentinel-text">{row.title}</span>
            <span className="line-clamp-1 max-w-md truncate text-[11px] text-sentinel-muted">
              {row.content}
            </span>
          </div>
        ),
      },
      {
        key: 'updatedAt',
        header: 'Updated',
        className: 'w-36 text-sentinel-muted',
        cell: (row) => fmtTime(row.updatedAt),
      },
      {
        key: 'actions',
        header: '',
        className: 'w-20 text-right',
        cell: (row) => (
          <Button
            variant="danger"
            disabled={removingId === row.id}
            onClick={() => handleRemove(row.id)}
          >
            {removingId === row.id ? '...' : 'Remove'}
          </Button>
        ),
      },
    ],
    [handleRemove, removingId],
  )

  const activityColumns = useMemo<Column<ActivityEvent>[]>(
    () => [
      {
        key: 'createdAt',
        header: 'When',
        className: 'w-36 text-sentinel-muted',
        cell: (row) => fmtTime(row.createdAt),
      },
      {
        key: 'userId',
        header: 'User',
        className: 'w-32',
        cell: (row) => shortId(row.userId),
      },
      {
        key: 'channelId',
        header: 'Channel',
        className: 'w-32 text-sentinel-muted',
        cell: (row) => shortId(row.channelId),
      },
      {
        key: 'guildId',
        header: 'Guild',
        className: 'text-sentinel-muted',
        cell: (row) => shortId(row.guildId),
      },
    ],
    [],
  )

  const inputClass =
    'w-full rounded-[4px] border border-sentinel-border bg-sentinel-bg px-2 py-1.5 text-xs text-sentinel-text placeholder:text-sentinel-muted focus:border-sentinel-primary focus:outline-none'

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4">
      {/* Usage summary */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Panel>
          <StatField
            label="Total calls"
            value={telemetryLoading ? '--' : fmtNumber(telemetry.totalCalls)}
            tone="primary"
            sub="Last 30 days"
          />
        </Panel>
        <Panel>
          <StatField
            label="Avg latency"
            value={telemetryLoading ? '--' : `${fmtNumber(telemetry.avgLatencyMs)}ms`}
            sub="Per call"
          />
        </Panel>
        <Panel>
          <StatField
            label="Cached rate"
            value={telemetryLoading ? '--' : fmtPercent(telemetry.cachedRate)}
            tone={telemetry.cachedRate > 0 ? 'active' : 'default'}
            sub={telemetryLoading ? 'Cache hits' : `${fmtNumber(cachedHits)} hits`}
          />
        </Panel>
        <Panel>
          <StatField
            label="Knowledge docs"
            value={docsLoading ? '--' : fmtNumber(docs.length)}
            sub="Indexed entries"
          />
        </Panel>
      </div>

      {/* Telemetry breakdowns + chart */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Panel
          title="Daily calls"
          tag={
            telemetryError ? (
              <StatusDot status="alert" label="Error" />
            ) : telemetryLoading ? (
              <StatusDot status="idle" label="Loading" />
            ) : (
              <StatusDot status="online" label="30d" />
            )
          }
          className="lg:col-span-2"
        >
          {telemetryError ? (
            <p className="text-xs text-sentinel-alert">{telemetryError}</p>
          ) : (
            <DailyCallsChart data={telemetry.dailyCalls} />
          )}
        </Panel>

        <Panel title="By provider">
          {telemetryLoading ? (
            <p className="text-[11px] uppercase tracking-[0.18em] text-sentinel-muted">Loading</p>
          ) : (
            <BreakdownBars data={telemetry.byProvider} total={telemetry.totalCalls} />
          )}
        </Panel>
      </div>

      <Panel title="By model">
        {telemetryLoading ? (
          <p className="text-[11px] uppercase tracking-[0.18em] text-sentinel-muted">Loading</p>
        ) : (
          <BreakdownBars data={telemetry.byModel} total={telemetry.totalCalls} />
        )}
      </Panel>

      {/* Knowledge base manager */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Panel title="Add document" className="lg:col-span-1">
          <form className="flex flex-col gap-3" onSubmit={handleSubmit}>
            <label className="flex flex-col gap-1">
              <span className="hud-label">Source</span>
              <select
                value={formSource}
                onChange={(e) => setFormSource(e.target.value as Source)}
                className={inputClass}
              >
                {SOURCES.map((s) => (
                  <option key={s} value={s} className="bg-sentinel-panel">
                    {s}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="hud-label">Title</span>
              <input
                type="text"
                value={formTitle}
                onChange={(e) => setFormTitle(e.target.value)}
                placeholder="Short label"
                className={inputClass}
                maxLength={200}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="hud-label">Content</span>
              <textarea
                value={formContent}
                onChange={(e) => setFormContent(e.target.value)}
                placeholder="Knowledge text the assistant can cite"
                rows={5}
                className={`${inputClass} resize-y`}
              />
            </label>
            {formError && <p className="text-[11px] text-sentinel-alert">{formError}</p>}
            <Button type="submit" variant="primary" disabled={submitting}>
              {submitting ? 'Adding...' : 'Add to knowledge base'}
            </Button>
          </form>
        </Panel>

        <Panel
          title="Knowledge base"
          tag={
            docsError ? (
              <StatusDot status="alert" label="Error" />
            ) : docsLoading ? (
              <StatusDot status="idle" label="Loading" />
            ) : (
              <span>{fmtNumber(docs.length)} docs</span>
            )
          }
          className="lg:col-span-2"
          bodyClassName="p-0"
        >
          {docsError ? (
            <p className="p-3 text-xs text-sentinel-alert">{docsError}</p>
          ) : docsLoading ? (
            <p className="p-3 text-[11px] uppercase tracking-[0.18em] text-sentinel-muted">
              Loading knowledge base
            </p>
          ) : (
            <Table
              columns={docColumns}
              rows={docs}
              rowKey={(row) => row.id}
              empty="No knowledge documents"
            />
          )}
        </Panel>
      </div>

      {/* Recent answers */}
      <Panel
        title="Recent answers"
        tag={
          activityError ? (
            <StatusDot status="alert" label="Error" />
          ) : activityLoading ? (
            <StatusDot status="idle" label="Loading" />
          ) : (
            <span>{fmtNumber(activity.length)} events</span>
          )
        }
        bodyClassName="p-0"
      >
        {activityError ? (
          <p className="p-3 text-xs text-sentinel-alert">{activityError}</p>
        ) : activityLoading ? (
          <p className="p-3 text-[11px] uppercase tracking-[0.18em] text-sentinel-muted">
            Loading activity
          </p>
        ) : (
          <Table
            columns={activityColumns}
            rows={activity}
            rowKey={(row) => row.id}
            empty="No recent AI activity"
          />
        )}
      </Panel>
    </div>
  )
}
