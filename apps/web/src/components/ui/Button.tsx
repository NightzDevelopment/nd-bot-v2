import type { ButtonHTMLAttributes } from 'react'
import { cn } from '../../lib/cn'

type Variant = 'primary' | 'ghost' | 'danger'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
}

const base =
  'inline-flex items-center justify-center gap-2 rounded border px-3 py-1.5 text-xs uppercase tracking-[0.12em] transition-colors disabled:cursor-not-allowed disabled:opacity-50 focus:outline-none focus-visible:ring-1 focus-visible:ring-sentinel-primary'

const variants: Record<Variant, string> = {
  primary:
    'border-sentinel-primary bg-sentinel-primary/15 text-sentinel-text hover:bg-sentinel-primary/30',
  ghost: 'border-sentinel-border bg-transparent text-sentinel-muted hover:bg-sentinel-hover hover:text-sentinel-text',
  danger: 'border-sentinel-alert bg-sentinel-alert/10 text-sentinel-alert hover:bg-sentinel-alert/25',
}

export function Button({ variant = 'ghost', className, type, ...rest }: ButtonProps) {
  return (
    <button type={type ?? 'button'} className={cn(base, variants[variant], className)} {...rest} />
  )
}
