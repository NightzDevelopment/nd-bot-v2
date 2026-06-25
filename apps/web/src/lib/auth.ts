/**
 * Dashboard auth glue for the SPA.
 *
 * The bot's OAuth callback redirects back to the SPA root with the minted JWT in
 * the URL fragment (`#token=<jwt>`), which keeps the token out of server logs and
 * the Referer header. On load we lift that token into localStorage (via the api
 * client's setToken) and scrub the fragment so a refresh or a shared link does
 * not leak it.
 */
import { getToken, setToken } from './api'

/** Human-readable messages for the `?error=` codes the callback may set. */
const ERROR_MESSAGES: Record<string, string> = {
  not_authorized: 'That Discord account is not authorized for this dashboard.',
}

/**
 * Parse `#token=<jwt>` from the current URL, store it, and clean the hash.
 * Returns the captured token, or the already-stored token if none was present.
 * Call this once on app load before deciding whether to render the dashboard.
 */
export function captureTokenFromHash(): string | null {
  const hash = window.location.hash.startsWith('#')
    ? window.location.hash.slice(1)
    : window.location.hash

  if (hash) {
    const params = new URLSearchParams(hash)
    const token = params.get('token')
    if (token) {
      setToken(token)
      // Strip the fragment without adding a history entry.
      const clean = window.location.pathname + window.location.search
      window.history.replaceState(null, '', clean)
      return token
    }
  }

  return getToken()
}

/** Parse a login error from the current `?error=` query param, if any. */
export function parseLoginError(): string | null {
  const code = new URLSearchParams(window.location.search).get('error')
  if (!code) return null
  return ERROR_MESSAGES[code] ?? 'Login failed. Please try again.'
}

/** Clear the stored token and reload to return the user to the login screen. */
export function logout(): void {
  setToken(null)
  window.location.assign('/')
}
