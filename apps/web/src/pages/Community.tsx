import { useEffect, useState } from 'react'
import { Panel } from '../components/ui/Panel'
import { StatusDot } from '../components/ui/StatusDot'
import { Table } from '../components/ui/Table'
import type { Column } from '../components/ui/Table'
import { api, ApiError } from '../lib/api'
import { useGuild } from '../lib/useGuild'

// ---- API response shapes (match apps/bot community routes + DB schema) -----

interface PollRow extends Record<string, unknown> {
  id: number
  guildId: string
  channelId: string
  messageId: string
  question: string
  options: string[]
  endsAt: number | null
  closed: boolean
}

interface GiveawayRow extends Record<string, unknown> {
  id: string
  guildId: string
  channelId: string
  messageId: string
  prize: string
  winnerCount: number
  hostId: string
  endsAt: number
  ended: boolean
}

interface SuggestionRow extends Record<string, unknown> {
  id: number
  guildId: string
  userId: string
  content: string
  status: string
  messageId: string | null
  createdAt: number
}

interface CounterRow extends Record<string, unknown> {
  guildId: string
  channelId: string
  kind: string
  template: string
}

// ---- Helpers ---------------------------------------------------------------

function fmtTime(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms)) return '--'
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

function truncate(text: string, max: number): string {
  if (text.length <= max) return text
  return `${text.slice(0, max - 1)}…`
}

/** Loading / empty / error sub-states for a single panel section. */
interface SectionState<T> {
  loading: boolean
  error: string | null
  rows: T[]
}

function emptyState<T>(): SectionState<T> {
  return { loading: true, error: null, rows: [] }
}

/** Body shown when a section is loading or errored, else null to render the table. */
function SectionStatus({ loading, error }: { loading: boolean; error: string | null }) {
  if (loading) {
    return (
      <p className="px-1 py-4 text-[11px] uppercase tracking-[0.18em] text-sentinel-muted">
        Loading
      </p>
    )
  }
  if (error) {
    return (
      <p className="px-1 py-4 text-[11px] uppercase tracking-[0.18em] text-sentinel-alert">
        {error}
      </p>
    )
  }
  return null
}

// ---- Column definitions ----------------------------------------------------

const pollColumns: Column<PollRow>[] = [
  {
    key: 'question',
    header: 'Question',
    cell: (row) => <span className="text-sentinel-text">{truncate(row.question, 60)}</span>,
  },
  {
    key: 'options',
    header: 'Options',
    className: 'text-sentinel-muted',
    cell: (row) => String(Array.isArray(row.options) ? row.options.length : 0),
  },
  {
    key: 'endsAt',
    header: 'Ends',
    className: 'text-sentinel-muted whitespace-nowrap',
    cell: (row) => fmtTime(row.endsAt),
  },
  {
    key: 'closed',
    header: 'Status',
    cell: (row) =>
      row.closed ? (
        <StatusDot status="offline" label="Closed" />
      ) : (
        <StatusDot status="online" label="Open" />
      ),
  },
]

const giveawayColumns: Column<GiveawayRow>[] = [
  {
    key: 'prize',
    header: 'Prize',
    cell: (row) => <span className="text-sentinel-text">{truncate(row.prize, 50)}</span>,
  },
  {
    key: 'winnerCount',
    header: 'Winners',
    className: 'text-sentinel-muted',
    cell: (row) => String(row.winnerCount),
  },
  {
    key: 'endsAt',
    header: 'Ends',
    className: 'text-sentinel-muted whitespace-nowrap',
    cell: (row) => fmtTime(row.endsAt),
  },
  {
    key: 'ended',
    header: 'Status',
    cell: (row) =>
      row.ended ? (
        <StatusDot status="offline" label="Ended" />
      ) : (
        <StatusDot status="online" label="Live" />
      ),
  },
]

function suggestionStatusDot(status: string) {
  switch (status) {
    case 'approved':
      return <StatusDot status="online" label="Approved" />
    case 'denied':
      return <StatusDot status="alert" label="Denied" />
    default:
      return <StatusDot status="idle" label="Open" />
  }
}

const suggestionColumns: Column<SuggestionRow>[] = [
  {
    key: 'content',
    header: 'Suggestion',
    cell: (row) => <span className="text-sentinel-text">{truncate(row.content, 70)}</span>,
  },
  {
    key: 'createdAt',
    header: 'Submitted',
    className: 'text-sentinel-muted whitespace-nowrap',
    cell: (row) => fmtTime(row.createdAt),
  },
  {
    key: 'status',
    header: 'Status',
    cell: (row) => suggestionStatusDot(row.status),
  },
]

const counterColumns: Column<CounterRow>[] = [
  {
    key: 'kind',
    header: 'Kind',
    cell: (row) => (
      <span className="uppercase tracking-[0.12em] text-sentinel-text">{row.kind}</span>
    ),
  },
  {
    key: 'template',
    header: 'Template',
    className: 'text-sentinel-muted',
    cell: (row) => truncate(row.template, 60),
  },
  {
    key: 'channelId',
    header: 'Channel',
    className: 'text-sentinel-muted whitespace-nowrap',
    cell: (row) => row.channelId,
  },
]

// ---- Page ------------------------------------------------------------------

export default function CommunityPage() {
  const { guildId, loading: guildLoading } = useGuild()

  const [polls, setPolls] = useState<SectionState<PollRow>>(emptyState)
  const [giveaways, setGiveaways] = useState<SectionState<GiveawayRow>>(emptyState)
  const [suggestions, setSuggestions] = useState<SectionState<SuggestionRow>>(emptyState)
  const [counters, setCounters] = useState<SectionState<CounterRow>>(emptyState)

  useEffect(() => {
    if (guildLoading) return
    if (!guildId) {
      const noGuild = { loading: false, error: 'No guild connected', rows: [] }
      setPolls(noGuild)
      setGiveaways(noGuild)
      setSuggestions(noGuild)
      setCounters(noGuild)
      return
    }

    const controller = new AbortController()
    const base = `/api/guilds/${guildId}/community`

    async function load<T>(
      path: string,
      pick: (data: unknown) => T[],
      set: (s: SectionState<T>) => void,
    ): Promise<void> {
      set({ loading: true, error: null, rows: [] })
      try {
        const data = await api.get<unknown>(path, undefined, controller.signal)
        set({ loading: false, error: null, rows: pick(data) })
      } catch (err) {
        if (controller.signal.aborted) return
        const message =
          err instanceof ApiError ? `Failed to load (${err.status})` : 'Failed to load'
        set({ loading: false, error: message, rows: [] })
      }
    }

    void load<PollRow>(
      `${base}/polls`,
      (d) => ((d as { polls?: PollRow[] }).polls ?? []),
      setPolls,
    )
    void load<GiveawayRow>(
      `${base}/giveaways`,
      (d) => ((d as { giveaways?: GiveawayRow[] }).giveaways ?? []),
      setGiveaways,
    )
    void load<SuggestionRow>(
      `${base}/suggestions`,
      (d) => ((d as { suggestions?: SuggestionRow[] }).suggestions ?? []),
      setSuggestions,
    )
    void load<CounterRow>(
      `${base}/counters`,
      (d) => ((d as { counters?: CounterRow[] }).counters ?? []),
      setCounters,
    )

    return () => {
      controller.abort()
    }
  }, [guildId, guildLoading])

  if (guildLoading) {
    return (
      <div className="mx-auto flex max-w-6xl flex-col gap-4">
        <Panel title="Community" tag={<StatusDot status="idle" label="Loading" />}>
          <p className="text-[11px] uppercase tracking-[0.18em] text-sentinel-muted">
            Resolving guild
          </p>
        </Panel>
      </div>
    )
  }

  const openPolls = polls.rows.filter((p) => !p.closed).length
  const liveGiveaways = giveaways.rows.filter((g) => !g.ended).length
  const openSuggestions = suggestions.rows.filter((s) => s.status === 'open').length

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Panel>
          <div className="flex flex-col gap-1">
            <span className="hud-label">Open polls</span>
            <span className="text-2xl leading-none text-sentinel-active">
              {polls.loading ? '--' : openPolls}
            </span>
            <span className="text-[11px] text-sentinel-muted">{polls.rows.length} total</span>
          </div>
        </Panel>
        <Panel>
          <div className="flex flex-col gap-1">
            <span className="hud-label">Live giveaways</span>
            <span className="text-2xl leading-none text-sentinel-active">
              {giveaways.loading ? '--' : liveGiveaways}
            </span>
            <span className="text-[11px] text-sentinel-muted">{giveaways.rows.length} total</span>
          </div>
        </Panel>
        <Panel>
          <div className="flex flex-col gap-1">
            <span className="hud-label">Open suggestions</span>
            <span className="text-2xl leading-none text-sentinel-caution">
              {suggestions.loading ? '--' : openSuggestions}
            </span>
            <span className="text-[11px] text-sentinel-muted">
              {suggestions.rows.length} total
            </span>
          </div>
        </Panel>
        <Panel>
          <div className="flex flex-col gap-1">
            <span className="hud-label">Counters</span>
            <span className="text-2xl leading-none text-sentinel-text">
              {counters.loading ? '--' : counters.rows.length}
            </span>
            <span className="text-[11px] text-sentinel-muted">Channel counters</span>
          </div>
        </Panel>
      </div>

      <Panel
        title="Polls"
        tag={<span className="text-[11px] text-sentinel-muted">{polls.rows.length}</span>}
      >
        <SectionStatus loading={polls.loading} error={polls.error} />
        {!polls.loading && !polls.error && (
          <Table
            columns={pollColumns}
            rows={polls.rows}
            rowKey={(row) => row.id}
            empty="No polls"
          />
        )}
      </Panel>

      <Panel
        title="Giveaways"
        tag={<span className="text-[11px] text-sentinel-muted">{giveaways.rows.length}</span>}
      >
        <SectionStatus loading={giveaways.loading} error={giveaways.error} />
        {!giveaways.loading && !giveaways.error && (
          <Table
            columns={giveawayColumns}
            rows={giveaways.rows}
            rowKey={(row) => row.id}
            empty="No giveaways"
          />
        )}
      </Panel>

      <Panel
        title="Suggestions"
        tag={<span className="text-[11px] text-sentinel-muted">{suggestions.rows.length}</span>}
      >
        <SectionStatus loading={suggestions.loading} error={suggestions.error} />
        {!suggestions.loading && !suggestions.error && (
          <Table
            columns={suggestionColumns}
            rows={suggestions.rows}
            rowKey={(row) => row.id}
            empty="No suggestions"
          />
        )}
      </Panel>

      <Panel
        title="Counters"
        tag={<span className="text-[11px] text-sentinel-muted">{counters.rows.length}</span>}
      >
        <SectionStatus loading={counters.loading} error={counters.error} />
        {!counters.loading && !counters.error && (
          <Table
            columns={counterColumns}
            rows={counters.rows}
            rowKey={(row) => row.channelId}
            empty="No counters"
          />
        )}
      </Panel>
    </div>
  )
}
