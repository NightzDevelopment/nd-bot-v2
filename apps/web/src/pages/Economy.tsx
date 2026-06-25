/**
 * Economy dashboard page.
 *
 * Three live reads against the bot economy API:
 *   - GET /api/guilds/:id/economy/leaderboard -> net-worth ranking
 *   - GET /api/guilds/:id/economy/shop         -> enabled shop catalog
 *   - GET /api/guilds/:id/economy/members/:userId -> single account + tx history
 *
 * Response shapes mirror apps/bot/src/features/economy/index.ts exactly. All
 * fetches run in useEffect with an AbortController and degrade to clear
 * empty / error states (the API may return empties).
 */
import { useEffect, useMemo, useState } from 'react'
import { Panel } from '../components/ui/Panel'
import { Button } from '../components/ui/Button'
import { StatField } from '../components/ui/StatField'
import { StatusDot } from '../components/ui/StatusDot'
import { Table } from '../components/ui/Table'
import type { Column } from '../components/ui/Table'
import { api, ApiError } from '../lib/api'
import { useGuild } from '../lib/useGuild'

// ---- Response shapes (from the bot economy routes) ------------------------

interface LeaderboardEntry {
  userId: string
  wallet: number
  bank: number
  total: number
}

interface LeaderboardResponse {
  guildId: string
  leaderboard: LeaderboardEntry[]
}

interface ShopItem {
  id: number
  guildId: string
  key: string
  name: string
  description: string | null
  price: number
  roleId: string | null
  stock: number | null
  enabled: boolean
}

interface ShopResponse {
  guildId: string
  items: ShopItem[]
}

interface EconomyAccount {
  guildId: string
  userId: string
  wallet: number
  bank: number
  lastDailyAt: number | null
  lastWorkAt: number | null
  lastCrimeAt: number | null
  streak: number
}

interface EconomyTransaction {
  id: number
  amount: number
  reason: string
  createdAt: number
}

interface MemberResponse {
  account: EconomyAccount
  transactions: EconomyTransaction[]
}

// ---- Formatting helpers ---------------------------------------------------

const num = new Intl.NumberFormat('en-US')

function fmt(n: number): string {
  return num.format(n)
}

function shortId(id: string): string {
  return id.length > 10 ? `${id.slice(0, 6)}..${id.slice(-4)}` : id
}

function fmtTime(ms: number): string {
  const d = new Date(ms)
  if (Number.isNaN(d.getTime())) return '--'
  return d.toLocaleString('en-US', {
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}

// ---- Table column definitions ---------------------------------------------

interface LbRow extends Record<string, unknown> {
  rank: number
  userId: string
  wallet: number
  bank: number
  total: number
}

const RANK_TONE = ['text-sentinel-active', 'text-sentinel-text', 'text-sentinel-caution']

const leaderboardColumns: Column<LbRow>[] = [
  {
    key: 'rank',
    header: '#',
    className: 'w-10',
    cell: (row) => (
      <span className={RANK_TONE[row.rank - 1] ?? 'text-sentinel-muted'}>
        {String(row.rank).padStart(2, '0')}
      </span>
    ),
  },
  {
    key: 'userId',
    header: 'User',
    cell: (row) => <span className="text-sentinel-text">{shortId(row.userId)}</span>,
  },
  {
    key: 'wallet',
    header: 'Wallet',
    className: 'text-right tabular-nums',
    cell: (row) => fmt(row.wallet),
  },
  {
    key: 'bank',
    header: 'Bank',
    className: 'text-right tabular-nums',
    cell: (row) => fmt(row.bank),
  },
  {
    key: 'total',
    header: 'Net worth',
    className: 'text-right tabular-nums',
    cell: (row) => <span className="text-sentinel-active">{fmt(row.total)}</span>,
  },
]

interface ShopRow extends ShopItem, Record<string, unknown> {}

const shopColumns: Column<ShopRow>[] = [
  {
    key: 'name',
    header: 'Item',
    cell: (row) => (
      <div className="flex flex-col gap-0.5">
        <span className="text-sentinel-text">{row.name}</span>
        <span className="text-[10px] uppercase tracking-[0.12em] text-sentinel-muted">{row.key}</span>
      </div>
    ),
  },
  {
    key: 'description',
    header: 'Description',
    className: 'text-sentinel-muted max-w-[18rem]',
    cell: (row) => row.description ?? '--',
  },
  {
    key: 'roleId',
    header: 'Role',
    cell: (row) =>
      row.roleId ? (
        <span className="text-sentinel-primary">{shortId(row.roleId)}</span>
      ) : (
        <span className="text-sentinel-muted">--</span>
      ),
  },
  {
    key: 'stock',
    header: 'Stock',
    className: 'text-right tabular-nums',
    cell: (row) =>
      row.stock === null ? (
        <span className="text-sentinel-muted">inf</span>
      ) : row.stock === 0 ? (
        <span className="text-sentinel-alert">0</span>
      ) : (
        fmt(row.stock)
      ),
  },
  {
    key: 'price',
    header: 'Price',
    className: 'text-right tabular-nums',
    cell: (row) => <span className="text-sentinel-caution">{fmt(row.price)}</span>,
  },
]

interface TxRow extends EconomyTransaction, Record<string, unknown> {}

const txColumns: Column<TxRow>[] = [
  {
    key: 'createdAt',
    header: 'When',
    className: 'text-sentinel-muted whitespace-nowrap',
    cell: (row) => fmtTime(row.createdAt),
  },
  { key: 'reason', header: 'Reason', cell: (row) => row.reason },
  {
    key: 'amount',
    header: 'Amount',
    className: 'text-right tabular-nums',
    cell: (row) => (
      <span className={row.amount < 0 ? 'text-sentinel-alert' : 'text-sentinel-active'}>
        {row.amount > 0 ? `+${fmt(row.amount)}` : fmt(row.amount)}
      </span>
    ),
  },
]

// ---- Page -----------------------------------------------------------------

export default function EconomyPage() {
  const { guildId, loading: guildLoading } = useGuild()

  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([])
  const [shop, setShop] = useState<ShopItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Member lookup state (independent of the page-level fetch).
  const [lookupInput, setLookupInput] = useState('')
  const [lookupId, setLookupId] = useState<string | null>(null)
  const [member, setMember] = useState<MemberResponse | null>(null)
  const [memberLoading, setMemberLoading] = useState(false)
  const [memberError, setMemberError] = useState<string | null>(null)

  // Leaderboard + shop load whenever the guild resolves.
  useEffect(() => {
    if (guildLoading) return
    if (!guildId) {
      setLoading(false)
      return
    }
    const ctrl = new AbortController()
    setLoading(true)
    setError(null)

    Promise.all([
      api.get<LeaderboardResponse>(
        `/api/guilds/${guildId}/economy/leaderboard`,
        { limit: 25 },
        ctrl.signal,
      ),
      api.get<ShopResponse>(`/api/guilds/${guildId}/economy/shop`, undefined, ctrl.signal),
    ])
      .then(([lb, sh]) => {
        if (ctrl.signal.aborted) return
        setLeaderboard(lb.leaderboard ?? [])
        setShop(sh.items ?? [])
        setLoading(false)
      })
      .catch((err: unknown) => {
        if (ctrl.signal.aborted) return
        setError(err instanceof ApiError ? err.message : 'Failed to load economy data')
        setLoading(false)
      })

    return () => ctrl.abort()
  }, [guildId, guildLoading])

  // Member lookup fires when a target id is committed.
  useEffect(() => {
    if (!guildId || !lookupId) return
    const ctrl = new AbortController()
    setMemberLoading(true)
    setMemberError(null)
    setMember(null)

    api
      .get<MemberResponse>(
        `/api/guilds/${guildId}/economy/members/${lookupId}`,
        undefined,
        ctrl.signal,
      )
      .then((res) => {
        if (ctrl.signal.aborted) return
        setMember(res)
        setMemberLoading(false)
      })
      .catch((err: unknown) => {
        if (ctrl.signal.aborted) return
        setMemberError(err instanceof ApiError ? err.message : 'Lookup failed')
        setMemberLoading(false)
      })

    return () => ctrl.abort()
  }, [guildId, lookupId])

  const lbRows = useMemo<LbRow[]>(
    () =>
      leaderboard.map((e, i) => ({
        rank: i + 1,
        userId: e.userId,
        wallet: e.wallet,
        bank: e.bank,
        total: e.total,
      })),
    [leaderboard],
  )

  const shopRows = useMemo<ShopRow[]>(() => shop.map((s) => ({ ...s })), [shop])

  // Headline metrics derived from the leaderboard slice.
  const totals = useMemo(() => {
    let circulating = 0
    let banked = 0
    for (const e of leaderboard) {
      circulating += e.wallet
      banked += e.bank
    }
    return {
      net: circulating + banked,
      circulating,
      banked,
      richest: leaderboard[0]?.total ?? 0,
    }
  }, [leaderboard])

  function submitLookup(e: React.FormEvent) {
    e.preventDefault()
    const id = lookupInput.trim()
    if (id) setLookupId(id)
  }

  // ---- Render states ------------------------------------------------------

  if (guildLoading || loading) {
    return (
      <div className="mx-auto max-w-6xl">
        <Panel title="Economy" tag={<StatusDot status="idle" label="Loading" />}>
          <p className="text-sm text-sentinel-muted">Loading economy data...</p>
        </Panel>
      </div>
    )
  }

  if (!guildId) {
    return (
      <div className="mx-auto max-w-6xl">
        <Panel title="Economy" tag={<StatusDot status="offline" label="No guild" />}>
          <p className="text-sm text-sentinel-muted">No guild connected.</p>
        </Panel>
      </div>
    )
  }

  if (error) {
    return (
      <div className="mx-auto max-w-6xl">
        <Panel title="Economy" tag={<StatusDot status="alert" label="Error" />}>
          <p className="text-sm text-sentinel-alert">{error}</p>
        </Panel>
      </div>
    )
  }

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Panel>
          <StatField
            label="Net worth"
            value={fmt(totals.net)}
            tone="active"
            sub="Top 25 wallet + bank"
          />
        </Panel>
        <Panel>
          <StatField label="Circulating" value={fmt(totals.circulating)} sub="In wallets" />
        </Panel>
        <Panel>
          <StatField label="Banked" value={fmt(totals.banked)} tone="primary" sub="In bank" />
        </Panel>
        <Panel>
          <StatField
            label="Richest"
            value={fmt(totals.richest)}
            tone="caution"
            sub="Rank 01 net worth"
          />
        </Panel>
      </div>

      <Panel title="Member lookup">
        <form onSubmit={submitLookup} className="flex flex-wrap items-center gap-2">
          <input
            value={lookupInput}
            onChange={(e) => setLookupInput(e.target.value)}
            placeholder="Discord user id"
            spellCheck={false}
            className="min-w-[14rem] flex-1 rounded border border-sentinel-border bg-sentinel-bg px-3 py-1.5 text-xs text-sentinel-text placeholder:text-sentinel-muted focus:border-sentinel-primary focus:outline-none"
          />
          <Button variant="primary" type="submit" disabled={!lookupInput.trim()}>
            Lookup
          </Button>
          {lookupId && (
            <Button
              variant="ghost"
              onClick={() => {
                setLookupId(null)
                setLookupInput('')
                setMember(null)
                setMemberError(null)
              }}
            >
              Clear
            </Button>
          )}
        </form>

        {lookupId && (
          <div className="mt-3 border-t border-sentinel-border pt-3">
            {memberLoading ? (
              <p className="text-xs text-sentinel-muted">Loading account...</p>
            ) : memberError ? (
              <p className="text-xs text-sentinel-alert">{memberError}</p>
            ) : member && member.account ? (
              <div className="flex flex-col gap-3">
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                  <StatField label="Wallet" value={fmt(member.account.wallet)} tone="active" />
                  <StatField label="Bank" value={fmt(member.account.bank)} tone="primary" />
                  <StatField
                    label="Net worth"
                    value={fmt(member.account.wallet + member.account.bank)}
                  />
                  <StatField
                    label="Streak"
                    value={`${member.account.streak}d`}
                    tone="caution"
                  />
                </div>
                <div>
                  <span className="hud-label">User</span>
                  <p className="mt-1 break-all text-xs text-sentinel-muted">
                    {member.account.userId}
                  </p>
                </div>
                <div>
                  <span className="hud-label">Recent transactions</span>
                  <div className="mt-1">
                    <Table
                      columns={txColumns}
                      rows={member.transactions.map((t) => ({ ...t }))}
                      rowKey={(row) => row.id}
                      empty="No transactions"
                    />
                  </div>
                </div>
              </div>
            ) : (
              <p className="text-xs text-sentinel-muted">No account found for that id.</p>
            )}
          </div>
        )}
      </Panel>

      <Panel
        title="Leaderboard"
        tag={<span className="text-sentinel-muted">{lbRows.length} accounts</span>}
      >
        <Table
          columns={leaderboardColumns}
          rows={lbRows}
          rowKey={(row) => row.userId}
          empty="No accounts with a balance"
        />
      </Panel>

      <Panel
        title="Shop"
        tag={
          shop.length > 0 ? (
            <StatusDot status="online" label={`${shop.length} items`} />
          ) : (
            <StatusDot status="offline" label="Empty" />
          )
        }
      >
        <Table
          columns={shopColumns}
          rows={shopRows}
          rowKey={(row) => row.id}
          empty="No shop items configured"
        />
      </Panel>
    </div>
  )
}
