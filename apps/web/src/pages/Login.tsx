/**
 * Login screen.
 *
 * Rendered by App when there is no stored token. Sentinel themed: a centered
 * panel on the HUD background, the Nightz wordmark, and a single "Login with
 * Discord" action that hands off to the bot's OAuth route. A failed/blocked
 * login comes back as `?error=not_authorized`, surfaced inline.
 */
import { parseLoginError } from '../lib/auth'

export function Login() {
  const error = parseLoginError()

  return (
    <main className="flex min-h-full items-center justify-center bg-sentinel-bg px-4 py-12">
      <section className="w-full max-w-sm border border-sentinel-border bg-sentinel-panel rounded">
        <header className="border-b border-sentinel-border px-5 py-4">
          <p className="text-[11px] uppercase tracking-[0.18em] text-sentinel-muted">Nightz</p>
          <h1 className="mt-1 text-sm uppercase tracking-[0.22em] text-sentinel-text">Sentinel</h1>
        </header>

        <div className="px-5 py-6">
          <p className="text-[13px] leading-relaxed text-sentinel-muted">
            Dashboard access is restricted to authorized staff. Sign in with the Discord
            account that holds dashboard permissions.
          </p>

          {error !== null && (
            <p className="mt-4 border border-sentinel-alert/40 bg-sentinel-alert/10 px-3 py-2 text-[12px] text-sentinel-alert rounded">
              {error}
            </p>
          )}

          <a
            href="/api/auth/login"
            className="mt-6 flex w-full items-center justify-center border border-sentinel-primary bg-sentinel-primary/10 px-4 py-2.5 text-[12px] uppercase tracking-[0.18em] text-sentinel-text transition-colors hover:bg-sentinel-primary/20 rounded"
          >
            Login with Discord
          </a>
        </div>

        <footer className="border-t border-sentinel-border px-5 py-3">
          <p className="text-[10px] uppercase tracking-[0.18em] text-sentinel-muted">
            nd-bot-v2 dashboard
          </p>
        </footer>
      </section>
    </main>
  )
}
