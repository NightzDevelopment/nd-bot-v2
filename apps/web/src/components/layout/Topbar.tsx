import { useLocation } from 'react-router-dom'
import { StatusDot } from '../ui/StatusDot'
import { NAV_SECTIONS } from '../../nav'

function currentLabel(pathname: string): string {
  const segment = pathname.replace(/^\/+/, '').split('/')[0] ?? ''
  const match = NAV_SECTIONS.find((s) => s.path === segment)
  return match?.label ?? 'Overview'
}

/**
 * Top bar: shows the active section as a breadcrumb plus a connection readout.
 * Phase C swaps the static status for live WebSocket state and an account menu.
 */
export function Topbar() {
  const { pathname } = useLocation()
  return (
    <header className="flex h-12 shrink-0 items-center justify-between border-b border-sentinel-border bg-sentinel-panel px-4">
      <div className="flex items-baseline gap-2">
        <span className="text-[11px] uppercase tracking-[0.16em] text-sentinel-muted">Dashboard</span>
        <span className="text-sentinel-muted">/</span>
        <span className="text-xs uppercase tracking-[0.14em] text-sentinel-text">
          {currentLabel(pathname)}
        </span>
      </div>
      <div className="flex items-center gap-4">
        <StatusDot status="online" label="Bot online" />
        <StatusDot status="offline" label="WS idle" />
      </div>
    </header>
  )
}
