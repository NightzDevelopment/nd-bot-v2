import type { ReactNode } from 'react'
import { cn } from '../../lib/cn'

interface PanelProps {
  title?: string
  /** small uppercase tag shown on the right of the header, e.g. a status */
  tag?: ReactNode
  className?: string
  bodyClassName?: string
  children?: ReactNode
}

/**
 * Sentinel surface container: panel background, sharp 1px border, 4px radius.
 * Optional HUD-style header bar with an uppercase title.
 */
export function Panel({ title, tag, className, bodyClassName, children }: PanelProps) {
  return (
    <section
      className={cn(
        'border border-sentinel-border bg-sentinel-panel rounded',
        className,
      )}
    >
      {title !== undefined && (
        <header className="flex items-center justify-between border-b border-sentinel-border px-3 py-2">
          <h2 className="text-xs uppercase tracking-[0.18em] text-sentinel-text">{title}</h2>
          {tag !== undefined && <div className="text-[11px] text-sentinel-muted">{tag}</div>}
        </header>
      )}
      <div className={cn('p-3', bodyClassName)}>{children}</div>
    </section>
  )
}
