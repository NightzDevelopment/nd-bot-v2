import { useEffect, useState } from 'react'
import { Panel } from '../components/ui/Panel'
import { StatField } from '../components/ui/StatField'
import { StatusDot } from '../components/ui/StatusDot'
import { Table } from '../components/ui/Table'
import type { Column } from '../components/ui/Table'
import type { Status } from '../components/ui/StatusDot'
import { api, ApiError } from '../lib/api'
import { useGuild } from '../lib/useGuild'

// ---- API response shapes (mirror apps/bot/src/api/dashboard.ts) -----------

interface Overview {
  members: number
  online: number
  openTickets: number
  casesToday: number
  totalEconomy: number
  messagesToday: number
  aiCallsToday: number
  uptimeSeconds: number
}

interface Health {
  status: string
  uptime: number
  connections: number
}

interface AuditEntry {
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

// ---- Formatting helpers ---------------------------------------------------

function formatNumber(n: number): string {
  return n.toLocaleString('en-US')
}

function formatUptime(seconds: number): string {
  const s = Math.max(0, Math.round(seconds))
  const days = Math.floor(s / 86400)
  const hours = Math.floor((s % 86400) / 3600)
  const mins = Math.floor((s % 3600) / 60)
  if (days > 0) return `${days}d ${hours}h`
  if (hours > 0) return `${hours}h ${mins}m`
  return `${mins}m`
}

function formatRelative(ms: number): string {
  const diff = Date.now() - ms
  if (diff < 0) return 'now'
  const s = Math.floor(diff / 1000)
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  return `${d}d ago`
}

// ---- Services table -------------------------------------------------------

interface ServiceRow extends Record<string, unknown> {
  service: string
  state: Status
  detail: string
}

const serviceColumns: Column<ServiceRow>[] = [
  { key: 'service', header: 'Service' },
  {
    key: 'state',
    header: 'State',
    cell: (row) => <StatusDot status={row.state} label={row.state} />,
  },
  { key: 'detail', header: 'Detail', className: 'text-sentinel-muted' },
]

// ---- Audit table ----------------------------------------------------------

interface AuditRow extends Record<string, unknown> {
  id: number
  action: string
  actorId: string
  target: string
  when: string
}

const auditColumns: Column<AuditRow>[] = [
  { key: 'action', header: 'Action', className: 'text-sentinel-text' },
  { key: 'actorId', header: 'Actor', className: 'text-sentinel-muted' },
  { key: 'target', header: 'Target', className: 'text-sentinel-muted' },
  { key: 'when', header: 'When', className: 'text-sentinel-muted whitespace-nowrap' },
]

export default function OverviewPage() {
  const { guildId, loading: guildLoading } = useGuild()

  const [overview, setOverview] = useState<Overview | null>(null)
  const [health, setHealth] = useState<Health | null>(null)
  const [audit, setAudit] = useState<AuditEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (guildLoading) return
    if (!guildId) {
      setLoading(false)
      return
    }

    const controller = new AbortController()
    setLoading(true)
    setError(null)

    Promise.all([
      api.get<Overview>(`/api/guilds/${guildId}/overview`, undefined, controller.signal),
      api.get<Health>('/health', undefined, controller.signal),
      api.get<AuditResponse>(
        `/api/guilds/${guildId}/audit`,
        { limit: 8 },
        controller.signal,
      ),
    ])
      .then(([ov, hl, au]) => {
        if (controller.signal.aborted) return
        setOverview(ov)
        setHealth(hl)
        setAudit(au.entries ?? [])
        setLoading(false)
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return
        const message =
          err instanceof ApiError ? err.message : 'Failed to load overview data'
        setError(message)
        setLoading(false)
      })

    return () => controller.abort()
  }, [guildId, guildLoading])

  const services: ServiceRow[] = [
    {
      service: 'Dashboard API',
      state: health?.status === 'ok' ? 'online' : 'offline',
      detail: health?.status === 'ok' ? 'Responding' : 'Unreachable',
    },
    {
      service: 'Gateway',
      state: overview ? 'online' : 'offline',
      detail: overview ? 'Connected' : 'No guild data',
    },
    {
      service: 'WebSocket hub',
      state: health ? 'online' : 'offline',
      detail: health ? `${formatNumber(health.connections)} connection(s)` : 'Offline',
    },
    {
      service: 'AI router',
      state: overview && overview.aiCallsToday > 0 ? 'online' : 'idle',
      detail: overview
        ? `${formatNumber(overview.aiCallsToday)} call(s) today`
        : 'No telemetry',
    },
  ]

  const auditRows: AuditRow[] = audit.map((e) => ({
    id: e.id,
    action: e.action,
    actorId: e.actorId,
    target: e.target ?? '-',
    when: formatRelative(e.createdAt),
  }))

  const stillLoading = guildLoading || loading

  // ---- States -------------------------------------------------------------

  if (stillLoading) {
    return (
      <div className="mx-auto flex max-w-6xl flex-col gap-4">
        <Panel>
          <StatField label="Status" value="Loading" sub="Fetching live metrics" />
        </Panel>
      </div>
    )
  }

  if (!guildId) {
    return (
      <div className="mx-auto flex max-w-6xl flex-col gap-4">
        <Panel title="Overview" tag={<StatusDot status="offline" label="No guild" />}>
          <p className="text-sm text-sentinel-muted">
            No guild is connected. Once the bot joins a server its metrics will appear here.
          </p>
        </Panel>
      </div>
    )
  }

  if (error) {
    return (
      <div className="mx-auto flex max-w-6xl flex-col gap-4">
        <Panel title="Overview" tag={<StatusDot status="alert" label="Error" />}>
          <p className="text-sm text-sentinel-alert">{error}</p>
          <p className="mt-1 text-[11px] text-sentinel-muted">
            The API may be unavailable. Try reloading the page.
          </p>
        </Panel>
      </div>
    )
  }

  // ---- Loaded -------------------------------------------------------------

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <Panel>
          <StatField
            label="Members"
            value={formatNumber(overview?.members ?? 0)}
            sub="Total members"
          />
        </Panel>
        <Panel>
          <StatField
            label="Online"
            value={formatNumber(overview?.online ?? 0)}
            tone="active"
            sub="Present now"
          />
        </Panel>
        <Panel>
          <StatField
            label="Open tickets"
            value={formatNumber(overview?.openTickets ?? 0)}
            tone={overview && overview.openTickets > 0 ? 'caution' : 'default'}
            sub="Awaiting reply"
          />
        </Panel>
        <Panel>
          <StatField
            label="Economy"
            value={formatNumber(overview?.totalEconomy ?? 0)}
            tone="primary"
            sub="Total in circulation"
          />
        </Panel>
        <Panel>
          <StatField
            label="AI calls"
            value={formatNumber(overview?.aiCallsToday ?? 0)}
            sub="Today"
          />
        </Panel>
        <Panel>
          <StatField
            label="Uptime"
            value={formatUptime(overview?.uptimeSeconds ?? 0)}
            tone="active"
            sub="Since last restart"
          />
        </Panel>
      </div>

      <Panel
        title="Services"
        tag={
          <StatusDot
            status={health?.status === 'ok' ? 'online' : 'alert'}
            label={health?.status === 'ok' ? 'Healthy' : 'Degraded'}
          />
        }
      >
        <Table
          columns={serviceColumns}
          rows={services}
          rowKey={(row) => row.service}
          empty="No services reporting"
        />
      </Panel>

      <Panel
        title="Recent activity"
        tag={<span>{formatNumber(auditRows.length)} latest</span>}
      >
        <Table
          columns={auditColumns}
          rows={auditRows}
          rowKey={(row) => row.id}
          empty="No recent activity"
        />
      </Panel>
    </div>
  )
}
