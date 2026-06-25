import { Panel } from '../components/ui/Panel'
import { StatField } from '../components/ui/StatField'
import { StatusDot } from '../components/ui/StatusDot'
import { Table } from '../components/ui/Table'
import type { Column } from '../components/ui/Table'

interface ServiceRow extends Record<string, unknown> {
  service: string
  state: 'online' | 'idle' | 'offline' | 'alert'
  detail: string
}

// Static scaffold rows. Phase C feeds these from the bot health endpoint.
const services: ServiceRow[] = [
  { service: 'Gateway', state: 'online', detail: 'Connected' },
  { service: 'Dashboard API', state: 'idle', detail: 'Awaiting Phase C' },
  { service: 'AI router', state: 'idle', detail: 'Providers not wired' },
  { service: 'Scheduler', state: 'offline', detail: 'Not started' },
]

const serviceColumns: Column<ServiceRow>[] = [
  { key: 'service', header: 'Service' },
  {
    key: 'state',
    header: 'State',
    cell: (row) => <StatusDot status={row.state} label={row.state} />,
  },
  { key: 'detail', header: 'Detail', className: 'text-sentinel-muted' },
]

export function Overview() {
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Panel>
          <StatField label="Guilds" value="--" sub="Connected servers" />
        </Panel>
        <Panel>
          <StatField label="Members" value="--" sub="Across all guilds" />
        </Panel>
        <Panel>
          <StatField label="Open tickets" value="--" tone="caution" sub="Awaiting reply" />
        </Panel>
        <Panel>
          <StatField label="Bot" value="ONLINE" tone="active" sub="Gateway ready" />
        </Panel>
      </div>

      <Panel title="Services" tag={<StatusDot status="idle" label="Scaffold" />}>
        <Table
          columns={serviceColumns}
          rows={services}
          rowKey={(row) => row.service}
          empty="No services reporting"
        />
      </Panel>

      <Panel title="Overview">
        <p className="text-sm text-sentinel-muted">
          Live server health, bot status, and key metrics. This view aggregates data from the other
          sections once Phase C wires the API.
        </p>
      </Panel>
    </div>
  )
}
