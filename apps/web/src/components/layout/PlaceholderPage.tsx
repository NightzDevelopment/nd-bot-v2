import { Panel } from '../ui/Panel'
import { StatusDot } from '../ui/StatusDot'

interface PlaceholderPageProps {
  title: string
  blurb: string
}

/**
 * Shared scaffold for every section page. Phase C replaces these bodies with
 * real data panels; the titled Panel and section blurb stay as the frame.
 */
export function PlaceholderPage({ title, blurb }: PlaceholderPageProps) {
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-4">
      <Panel title={title} tag={<StatusDot status="idle" label="Scaffold" />}>
        <p className="text-sm text-sentinel-muted">{blurb}</p>
        <p className="mt-3 text-[11px] uppercase tracking-[0.14em] text-sentinel-muted">
          Section pending // Phase C implementation
        </p>
      </Panel>
    </div>
  )
}
