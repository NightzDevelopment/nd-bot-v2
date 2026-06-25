import { cn } from '../../lib/cn'

export type Status = 'online' | 'idle' | 'offline' | 'alert'

const colorFor: Record<Status, string> = {
  online: 'bg-sentinel-active', // neon green: active/online ONLY
  idle: 'bg-sentinel-caution',
  offline: 'bg-sentinel-muted',
  alert: 'bg-sentinel-alert',
}

interface StatusDotProps {
  status: Status
  label?: string
  className?: string
}

/** Small HUD status indicator: a 8px dot plus optional uppercase label. */
export function StatusDot({ status, label, className }: StatusDotProps) {
  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      <span className={cn('h-2 w-2 rounded-full', colorFor[status])} aria-hidden="true" />
      {label !== undefined && (
        <span className="text-[11px] uppercase tracking-[0.12em] text-sentinel-muted">{label}</span>
      )}
    </span>
  )
}
