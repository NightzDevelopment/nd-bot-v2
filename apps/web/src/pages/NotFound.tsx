import { Link } from 'react-router-dom'
import { Panel } from '../components/ui/Panel'

export function NotFound() {
  return (
    <div className="mx-auto max-w-xl">
      <Panel title="404 // Not found">
        <p className="text-sm text-sentinel-muted">This route does not exist.</p>
        <Link
          to="/"
          className="mt-3 inline-block text-xs uppercase tracking-[0.14em] text-sentinel-primary hover:underline"
        >
          Return to overview
        </Link>
      </Panel>
    </div>
  )
}
