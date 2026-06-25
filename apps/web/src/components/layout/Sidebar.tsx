import { NavLink } from 'react-router-dom'
import { cn } from '../../lib/cn'
import { NAV_SECTIONS } from '../../nav'

/**
 * Persistent left rail. Text-only nav (HUD aesthetic, no icons). Entries derive
 * from NAV_SECTIONS so the sidebar and router never drift.
 */
export function Sidebar() {
  return (
    <aside className="flex w-56 shrink-0 flex-col border-r border-sentinel-border bg-sentinel-panel">
      <div className="flex h-12 items-center gap-2 border-b border-sentinel-border px-4">
        <span className="text-sm uppercase tracking-[0.22em] text-sentinel-text">Sentinel</span>
        <span className="text-[10px] uppercase tracking-[0.18em] text-sentinel-primary">v2</span>
      </div>

      <nav className="flex-1 overflow-y-auto py-2">
        <div className="px-4 pb-1 pt-2">
          <span className="hud-label">Sections</span>
        </div>
        <ul>
          {NAV_SECTIONS.map((section) => (
            <li key={section.path || 'overview'}>
              <NavLink
                to={`/${section.path}`}
                end={section.path === ''}
                className={({ isActive }) =>
                  cn(
                    'flex items-center border-l-2 px-4 py-2 text-xs uppercase tracking-[0.1em] transition-colors',
                    isActive
                      ? 'border-sentinel-primary bg-sentinel-hover text-sentinel-text'
                      : 'border-transparent text-sentinel-muted hover:bg-sentinel-hover hover:text-sentinel-text',
                  )
                }
              >
                {section.label}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>

      <div className="border-t border-sentinel-border px-4 py-3">
        <span className="text-[10px] uppercase tracking-[0.16em] text-sentinel-muted">
          nd-bot-v2 dashboard
        </span>
      </div>
    </aside>
  )
}
