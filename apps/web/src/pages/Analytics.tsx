import { useEffect, useMemo, useState } from 'react'
import { Panel } from '../components/ui/Panel'
import { StatField } from '../components/ui/StatField'
import { StatusDot } from '../components/ui/StatusDot'
import { Table } from '../components/ui/Table'
import type { Column } from '../components/ui/Table'
import { api, ApiError } from '../lib/api'
import { useGuild } from '../lib/useGuild'

// ---- Response shapes (mirror GET /api/guilds/:id/analytics) ----------------

interface DailyPoint {
  date: string
  messages: number
  commands: number
  joins: number
  leaves: number
  ai: number
}

interface TopCommand extends Record<string, unknown> {
  name: string
  count: number
}

interface AnalyticsResponse {
  daily: DailyPoint[]
  byType: Record<string, number>
  topCommands: TopCommand[]
}

// ---- Chart config ----------------------------------------------------------

type SeriesKey = 'messages' | 'commands' | 'joins'

interface SeriesDef {
  key: SeriesKey
  label: string
  color: string
}

// Colors drawn from the Sentinel palette. Neon green reserved for the most
// "active" signal (messages); blue + caution for the rest.
const SERIES: SeriesDef[] = [
  { key: 'messages', label: 'Messages', color: '#00FF88' },
  { key: 'commands', label: 'Commands', color: '#3178C6' },
  { key: 'joins', label: 'Joins', color: '#FFA500' },
]

const CHART_W = 720
const CHART_H = 220
const PAD_L = 36
const PAD_R = 12
const PAD_T = 12
const PAD_B = 24

function niceMax(value: number): number {
  if (value <= 0) return 1
  const pow = 10 ** Math.floor(Math.log10(value))
  const norm = value / pow
  let step: number
  if (norm <= 1) step = 1
  else if (norm <= 2) step = 2
  else if (norm <= 5) step = 5
  else step = 10
  return step * pow
}

function shortDay(date: string): string {
  // date is YYYY-MM-DD; show MM-DD for axis ticks.
  return date.length >= 10 ? date.slice(5) : date
}

// ---- Trends line chart ------------------------------------------------------

function TrendsChart({ daily }: { daily: DailyPoint[] }) {
  const maxVal = useMemo(() => {
    let m = 0
    for (const d of daily) {
      m = Math.max(m, d.messages, d.commands, d.joins)
    }
    return niceMax(m)
  }, [daily])

  if (daily.length === 0) {
    return (
      <div className="px-3 py-10 text-center text-[11px] uppercase tracking-[0.18em] text-sentinel-muted">
        No activity in the last 30 days
      </div>
    )
  }

  const plotW = CHART_W - PAD_L - PAD_R
  const plotH = CHART_H - PAD_T - PAD_B
  const stepX = daily.length > 1 ? plotW / (daily.length - 1) : 0

  const xFor = (i: number): number => PAD_L + (daily.length > 1 ? i * stepX : plotW / 2)
  const yFor = (v: number): number => PAD_T + plotH - (v / maxVal) * plotH

  const gridLines = [0, 0.25, 0.5, 0.75, 1].map((frac) => {
    const y = PAD_T + plotH - frac * plotH
    const value = Math.round(maxVal * frac)
    return { y, value }
  })

  // Show roughly six x-axis ticks to avoid label crowding.
  const tickEvery = Math.max(1, Math.ceil(daily.length / 6))

  const pathFor = (key: SeriesKey): string =>
    daily
      .map((d, i) => `${i === 0 ? 'M' : 'L'} ${xFor(i).toFixed(1)} ${yFor(d[key]).toFixed(1)}`)
      .join(' ')

  return (
    <svg
      viewBox={`0 0 ${CHART_W} ${CHART_H}`}
      className="w-full"
      role="img"
      aria-label="Daily activity trends over the last 30 days"
    >
      {/* horizontal grid + y labels */}
      {gridLines.map((g) => (
        <g key={g.y}>
          <line
            x1={PAD_L}
            x2={CHART_W - PAD_R}
            y1={g.y}
            y2={g.y}
            stroke="#1E2A3A"
            strokeWidth={1}
          />
          <text
            x={PAD_L - 6}
            y={g.y + 3}
            textAnchor="end"
            className="fill-sentinel-muted"
            fontSize={9}
            fontFamily="monospace"
          >
            {g.value}
          </text>
        </g>
      ))}

      {/* x-axis ticks */}
      {daily.map((d, i) =>
        i % tickEvery === 0 ? (
          <text
            key={d.date}
            x={xFor(i)}
            y={CHART_H - 8}
            textAnchor="middle"
            className="fill-sentinel-muted"
            fontSize={9}
            fontFamily="monospace"
          >
            {shortDay(d.date)}
          </text>
        ) : null,
      )}

      {/* series lines */}
      {SERIES.map((s) => (
        <path
          key={s.key}
          d={pathFor(s.key)}
          fill="none"
          stroke={s.color}
          strokeWidth={1.5}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      ))}
    </svg>
  )
}

// ---- By-type breakdown (CSS bars) ------------------------------------------

const TYPE_ORDER = ['message', 'command', 'join', 'leave']

function ByTypeBreakdown({ byType }: { byType: Record<string, number> }) {
  const entries = useMemo(() => {
    const keys = new Set<string>([...TYPE_ORDER, ...Object.keys(byType)])
    const list = [...keys].map((type) => ({ type, count: byType[type] ?? 0 }))
    list.sort((a, b) => b.count - a.count)
    return list
  }, [byType])

  const max = entries.reduce((m, e) => Math.max(m, e.count), 0)
  const total = entries.reduce((sum, e) => sum + e.count, 0)

  if (total === 0) {
    return (
      <div className="px-1 py-6 text-center text-[11px] uppercase tracking-[0.18em] text-sentinel-muted">
        No events recorded
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      {entries.map((e) => {
        const pct = max > 0 ? (e.count / max) * 100 : 0
        return (
          <div key={e.type} className="flex flex-col gap-1">
            <div className="flex items-center justify-between text-[11px]">
              <span className="uppercase tracking-[0.12em] text-sentinel-muted">{e.type}</span>
              <span className="text-sentinel-text">{e.count.toLocaleString()}</span>
            </div>
            <div className="h-2 w-full rounded-[2px] bg-sentinel-bg">
              <div
                className="h-2 rounded-[2px] bg-sentinel-primary"
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ---- Top commands table -----------------------------------------------------

function buildCommandColumns(max: number): Column<TopCommand>[] {
  return [
    {
      key: 'rank',
      header: '#',
      className: 'w-8 text-sentinel-muted',
      cell: (row) => row.rank as number,
    },
    {
      key: 'name',
      header: 'Command',
      cell: (row) => <span className="text-sentinel-text">/{row.name}</span>,
    },
    {
      key: 'count',
      header: 'Uses',
      className: 'w-16 text-right',
      cell: (row) => row.count.toLocaleString(),
    },
    {
      key: 'bar',
      header: 'Share',
      className: 'w-40',
      cell: (row) => {
        const pct = max > 0 ? (row.count / max) * 100 : 0
        return (
          <div className="h-2 w-full rounded-[2px] bg-sentinel-bg">
            <div
              className="h-2 rounded-[2px] bg-sentinel-active"
              style={{ width: `${pct}%` }}
            />
          </div>
        )
      },
    },
  ]
}

// ---- Page -------------------------------------------------------------------

export default function AnalyticsPage() {
  const { guildId, loading: guildLoading } = useGuild()
  const [data, setData] = useState<AnalyticsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (guildLoading) return
    if (!guildId) {
      setLoading(false)
      setData(null)
      return
    }

    const controller = new AbortController()
    setLoading(true)
    setError(null)

    api
      .get<AnalyticsResponse>(
        `/api/guilds/${guildId}/analytics`,
        undefined,
        controller.signal,
      )
      .then((res) => {
        setData({
          daily: res.daily ?? [],
          byType: res.byType ?? {},
          topCommands: res.topCommands ?? [],
        })
        setLoading(false)
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return
        const message =
          err instanceof ApiError ? err.message : 'Failed to load analytics'
        setError(message)
        setLoading(false)
      })

    return () => controller.abort()
  }, [guildId, guildLoading])

  const totals = useMemo(() => {
    const daily = data?.daily ?? []
    return daily.reduce(
      (acc, d) => {
        acc.messages += d.messages
        acc.commands += d.commands
        acc.joins += d.joins
        acc.leaves += d.leaves
        return acc
      },
      { messages: 0, commands: 0, joins: 0, leaves: 0 },
    )
  }, [data])

  const commandRows: TopCommand[] = useMemo(
    () =>
      (data?.topCommands ?? []).map((c, i) => ({
        ...c,
        rank: i + 1,
      })),
    [data],
  )
  const maxCommand = commandRows.reduce((m, c) => Math.max(m, c.count), 0)
  const commandColumns = useMemo(() => buildCommandColumns(maxCommand), [maxCommand])

  const isLoading = guildLoading || loading

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4">
      {/* Headline totals */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Panel>
          <StatField
            label="Messages / 30d"
            value={isLoading ? '--' : totals.messages.toLocaleString()}
            tone="active"
            sub="Tracked events"
          />
        </Panel>
        <Panel>
          <StatField
            label="Commands / 30d"
            value={isLoading ? '--' : totals.commands.toLocaleString()}
            tone="primary"
            sub="Slash invocations"
          />
        </Panel>
        <Panel>
          <StatField
            label="Joins / 30d"
            value={isLoading ? '--' : totals.joins.toLocaleString()}
            tone="caution"
            sub="New members"
          />
        </Panel>
        <Panel>
          <StatField
            label="Leaves / 30d"
            value={isLoading ? '--' : totals.leaves.toLocaleString()}
            sub="Departures"
          />
        </Panel>
      </div>

      {/* Trends chart */}
      <Panel
        title="Daily Trends"
        tag={
          isLoading ? (
            <StatusDot status="idle" label="Loading" />
          ) : error ? (
            <StatusDot status="alert" label="Error" />
          ) : (
            <StatusDot status="online" label="30d window" />
          )
        }
      >
        {error ? (
          <div className="px-3 py-10 text-center text-[11px] uppercase tracking-[0.18em] text-sentinel-alert">
            {error}
          </div>
        ) : isLoading ? (
          <div className="px-3 py-10 text-center text-[11px] uppercase tracking-[0.18em] text-sentinel-muted">
            Loading analytics
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <TrendsChart daily={data?.daily ?? []} />
            <div className="flex flex-wrap items-center gap-4 border-t border-sentinel-border px-1 pt-3">
              {SERIES.map((s) => (
                <span key={s.key} className="inline-flex items-center gap-2">
                  <span
                    className="inline-block h-[2px] w-4"
                    style={{ backgroundColor: s.color }}
                    aria-hidden="true"
                  />
                  <span className="text-[11px] uppercase tracking-[0.12em] text-sentinel-muted">
                    {s.label}
                  </span>
                </span>
              ))}
            </div>
          </div>
        )}
      </Panel>

      {/* Breakdown + top commands */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Panel title="Events by Type">
          {error ? (
            <div className="px-1 py-6 text-center text-[11px] uppercase tracking-[0.18em] text-sentinel-alert">
              {error}
            </div>
          ) : isLoading ? (
            <div className="px-1 py-6 text-center text-[11px] uppercase tracking-[0.18em] text-sentinel-muted">
              Loading
            </div>
          ) : (
            <ByTypeBreakdown byType={data?.byType ?? {}} />
          )}
        </Panel>

        <Panel title="Top Commands" tag={<span>{commandRows.length} tracked</span>}>
          {error ? (
            <div className="px-1 py-6 text-center text-[11px] uppercase tracking-[0.18em] text-sentinel-alert">
              {error}
            </div>
          ) : (
            <Table
              columns={commandColumns}
              rows={commandRows}
              rowKey={(row) => row.name}
              empty={isLoading ? 'LOADING' : 'No commands used'}
            />
          )}
        </Panel>
      </div>
    </div>
  )
}
