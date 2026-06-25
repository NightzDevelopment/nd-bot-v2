import type { ReactNode } from 'react'
import { cn } from '../../lib/cn'

type Tone = 'default' | 'active' | 'alert' | 'caution' | 'primary'

const toneClass: Record<Tone, string> = {
  default: 'text-sentinel-text',
  active: 'text-sentinel-active',
  alert: 'text-sentinel-alert',
  caution: 'text-sentinel-caution',
  primary: 'text-sentinel-primary',
}

interface StatFieldProps {
  label: string
  value: ReactNode
  /** optional secondary line under the value */
  sub?: ReactNode
  tone?: Tone
  className?: string
}

/**
 * Key/value HUD readout: an uppercase muted label over a large mono value.
 * Used across dashboard panels for counters and metrics.
 */
export function StatField({ label, value, sub, tone = 'default', className }: StatFieldProps) {
  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <span className="hud-label">{label}</span>
      <span className={cn('text-2xl leading-none', toneClass[tone])}>{value}</span>
      {sub !== undefined && <span className="text-[11px] text-sentinel-muted">{sub}</span>}
    </div>
  )
}
