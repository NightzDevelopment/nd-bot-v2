import { useCallback, useEffect, useState } from 'react'
import { Panel } from '../components/ui/Panel'
import { Button } from '../components/ui/Button'
import { StatField } from '../components/ui/StatField'
import { StatusDot } from '../components/ui/StatusDot'
import { Table } from '../components/ui/Table'
import type { Column } from '../components/ui/Table'
import { api, ApiError } from '../lib/api'
import { useGuild } from '../lib/useGuild'

// ---- Rule shapes (mirror apps/bot automation/types.ts + the DB row) --------

interface Trigger {
  type: 'messageKeyword' | 'memberJoin' | 'reaction' | 'scheduled'
  keyword?: string
  regex?: boolean
  channelId?: string | null
  emoji?: string
  messageId?: string | null
  intervalMs?: number
}

interface Condition {
  type: 'roleHas' | 'roleLacks' | 'channelIs' | 'regexMatch'
  roleId?: string
  channelId?: string
  pattern?: string
}

interface Action {
  type: 'sendMessage' | 'addRole' | 'removeRole' | 'warn' | 'delete'
  content?: string
  channelId?: string | null
  roleId?: string
  reason?: string
}

interface Rule extends Record<string, unknown> {
  id: number
  guildId: string
  name: string
  enabled: boolean
  trigger: Trigger
  conditions: Condition[]
  actions: Action[]
  createdAt: number
}

interface RulesResponse {
  rules: Rule[]
}

// ---- Human-readable summaries ---------------------------------------------

function triggerLabel(t: Trigger): string {
  switch (t.type) {
    case 'messageKeyword':
      return 'Message keyword'
    case 'memberJoin':
      return 'Member join'
    case 'reaction':
      return 'Reaction'
    case 'scheduled':
      return 'Scheduled'
    default:
      return String(t.type)
  }
}

function triggerDetail(t: Trigger): string | null {
  switch (t.type) {
    case 'messageKeyword': {
      const kw = t.keyword?.trim()
      if (!kw) return 'any message'
      return `${t.regex ? 'regex' : 'contains'} "${kw}"`
    }
    case 'reaction': {
      const e = t.emoji?.trim()
      return e ? `emoji ${e}` : 'any reaction'
    }
    case 'scheduled': {
      const ms = t.intervalMs ?? 0
      return `every ${formatInterval(ms)}`
    }
    default:
      return null
  }
}

function formatInterval(ms: number): string {
  if (ms <= 0) return '0s'
  const mins = Math.round(ms / 60_000)
  if (mins < 60) return `${mins}m`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.round(hours / 24)
  return `${days}d`
}

function conditionLabel(c: Condition): string {
  switch (c.type) {
    case 'roleHas':
      return 'has role'
    case 'roleLacks':
      return 'lacks role'
    case 'channelIs':
      return 'in channel'
    case 'regexMatch':
      return `matches /${c.pattern ?? ''}/`
    default:
      return String(c.type)
  }
}

function actionLabel(a: Action): string {
  switch (a.type) {
    case 'sendMessage':
      return 'send message'
    case 'addRole':
      return 'add role'
    case 'removeRole':
      return 'remove role'
    case 'warn':
      return 'warn member'
    case 'delete':
      return 'delete message'
    default:
      return String(a.type)
  }
}

// ---- Sub-components --------------------------------------------------------

function FlowSummary({ rule }: { rule: Rule }) {
  const detail = triggerDetail(rule.trigger)
  return (
    <div className="flex flex-col gap-1 text-[11px]">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="rounded border border-sentinel-primary/50 bg-sentinel-primary/10 px-1.5 py-0.5 uppercase tracking-[0.1em] text-sentinel-primary">
          {triggerLabel(rule.trigger)}
        </span>
        {detail && <span className="text-sentinel-muted">{detail}</span>}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="w-16 shrink-0 uppercase tracking-[0.12em] text-sentinel-muted">If</span>
        {rule.conditions.length === 0 ? (
          <span className="text-sentinel-muted">always</span>
        ) : (
          rule.conditions.map((c, i) => (
            <span
              key={`${c.type}-${i}`}
              className="rounded border border-sentinel-border bg-sentinel-bg px-1.5 py-0.5 text-sentinel-text"
            >
              {conditionLabel(c)}
            </span>
          ))
        )}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="w-16 shrink-0 uppercase tracking-[0.12em] text-sentinel-muted">Then</span>
        {rule.actions.length === 0 ? (
          <span className="text-sentinel-muted">none</span>
        ) : (
          rule.actions.map((a, i) => (
            <span
              key={`${a.type}-${i}`}
              className="rounded border border-sentinel-border bg-sentinel-hover px-1.5 py-0.5 text-sentinel-text"
            >
              {actionLabel(a)}
            </span>
          ))
        )}
      </div>
    </div>
  )
}

// ---- Page ------------------------------------------------------------------

export default function AutomationPage() {
  const { guildId, loading: guildLoading } = useGuild()
  const [rules, setRules] = useState<Rule[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<number | null>(null)

  const load = useCallback(
    (signal?: AbortSignal) => {
      if (!guildId) return
      setLoading(true)
      setError(null)
      api
        .get<RulesResponse>(`/api/guilds/${guildId}/automation/rules`, undefined, signal)
        .then((res) => {
          if (signal?.aborted) return
          setRules(Array.isArray(res.rules) ? res.rules : [])
          setLoading(false)
        })
        .catch((err: unknown) => {
          if (signal?.aborted) return
          const msg = err instanceof ApiError ? err.message : 'Failed to load rules'
          setError(msg)
          setRules([])
          setLoading(false)
        })
    },
    [guildId],
  )

  useEffect(() => {
    if (guildLoading) return
    const ctrl = new AbortController()
    load(ctrl.signal)
    return () => ctrl.abort()
  }, [guildLoading, load])

  const toggleRule = useCallback(
    async (rule: Rule) => {
      if (!guildId) return
      setBusyId(rule.id)
      const next = !rule.enabled
      try {
        await api.post(`/api/guilds/${guildId}/automation/rules/${rule.id}/toggle`, {
          enabled: next,
        })
        setRules((prev) =>
          prev.map((r) => (r.id === rule.id ? { ...r, enabled: next } : r)),
        )
      } catch (err) {
        const msg = err instanceof ApiError ? err.message : 'Toggle failed'
        setError(msg)
      } finally {
        setBusyId(null)
      }
    },
    [guildId],
  )

  const deleteRule = useCallback(
    async (rule: Rule) => {
      if (!guildId) return
      setBusyId(rule.id)
      try {
        await api.post(`/api/guilds/${guildId}/automation/rules/${rule.id}/delete`, {})
        setRules((prev) => prev.filter((r) => r.id !== rule.id))
      } catch (err) {
        const msg = err instanceof ApiError ? err.message : 'Delete failed'
        setError(msg)
      } finally {
        setBusyId(null)
      }
    },
    [guildId],
  )

  const total = rules.length
  const active = rules.filter((r) => r.enabled).length
  const scheduled = rules.filter((r) => r.trigger.type === 'scheduled').length

  const columns: Column<Rule>[] = [
    {
      key: 'name',
      header: 'Rule',
      cell: (row) => (
        <div className="flex flex-col gap-0.5">
          <span className="text-sentinel-text">{row.name}</span>
          <span className="text-[10px] text-sentinel-muted">#{row.id}</span>
        </div>
      ),
    },
    {
      key: 'trigger',
      header: 'Trigger',
      cell: (row) => (
        <span className="text-sentinel-muted">{triggerLabel(row.trigger)}</span>
      ),
    },
    {
      key: 'flow',
      header: 'Trigger / Conditions / Actions',
      cell: (row) => <FlowSummary rule={row} />,
    },
    {
      key: 'enabled',
      header: 'State',
      cell: (row) =>
        row.enabled ? (
          <StatusDot status="online" label="Enabled" />
        ) : (
          <StatusDot status="offline" label="Disabled" />
        ),
    },
    {
      key: 'actions',
      header: '',
      className: 'text-right',
      cell: (row) => (
        <div className="flex justify-end gap-2">
          <Button
            variant={row.enabled ? 'ghost' : 'primary'}
            disabled={busyId === row.id}
            onClick={() => void toggleRule(row)}
          >
            {row.enabled ? 'Disable' : 'Enable'}
          </Button>
          <Button
            variant="danger"
            disabled={busyId === row.id}
            onClick={() => void deleteRule(row)}
          >
            Delete
          </Button>
        </div>
      ),
    },
  ]

  const showLoading = guildLoading || loading

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Panel>
          <StatField label="Rules" value={showLoading ? '--' : total} sub="Total configured" />
        </Panel>
        <Panel>
          <StatField
            label="Active"
            value={showLoading ? '--' : active}
            tone="active"
            sub="Currently enabled"
          />
        </Panel>
        <Panel>
          <StatField
            label="Scheduled"
            value={showLoading ? '--' : scheduled}
            sub="Interval triggers"
          />
        </Panel>
      </div>

      <Panel
        title="Automation Rules"
        tag={
          showLoading ? (
            <StatusDot status="idle" label="Loading" />
          ) : error ? (
            <StatusDot status="alert" label="Error" />
          ) : (
            <StatusDot status="online" label={`${active}/${total}`} />
          )
        }
      >
        {error && !showLoading && (
          <div className="mb-3 rounded border border-sentinel-alert/50 bg-sentinel-alert/10 px-3 py-2 text-[11px] text-sentinel-alert">
            {error}
          </div>
        )}

        {!guildId && !guildLoading ? (
          <p className="px-1 py-6 text-center text-[11px] uppercase tracking-[0.18em] text-sentinel-muted">
            No guild connected
          </p>
        ) : showLoading ? (
          <p className="px-1 py-6 text-center text-[11px] uppercase tracking-[0.18em] text-sentinel-muted">
            Loading rules
          </p>
        ) : (
          <Table
            columns={columns}
            rows={rules}
            rowKey={(row) => row.id}
            empty="No automation rules configured"
          />
        )}
      </Panel>
    </div>
  )
}
