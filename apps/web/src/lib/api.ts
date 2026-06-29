/**
 * Typed fetch client for the bot dashboard API.
 *
 * The bot (apps/bot) hosts a REST + WebSocket server on API_PORT. In dev,
 * vite proxies /api and /ws to it (see vite.config.ts); in production the SPA
 * is served from the same origin behind NGINX, so a relative base works in
 * both cases. Phase C wires real endpoints; the client surface is stable now.
 */

const TOKEN_KEY = 'nd.dashboard.token'

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY)
  } catch {
    return null
  }
}

export function setToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token)
    else localStorage.removeItem(TOKEN_KEY)
  } catch {
    // storage unavailable (private mode); ignore
  }
}

export class ApiError extends Error {
  readonly status: number
  readonly body: unknown
  constructor(status: number, message: string, body: unknown) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.body = body
  }
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'
  body?: unknown
  signal?: AbortSignal
  query?: Record<string, string | number | boolean | undefined>
}

const API_BASE = ''

function buildUrl(path: string, query?: RequestOptions['query']): string {
  const normalized = path.startsWith('/') ? path : `/${path}`
  let url = `${API_BASE}${normalized}`
  if (query) {
    const params = new URLSearchParams()
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) params.set(key, String(value))
    }
    const qs = params.toString()
    if (qs) url += `?${qs}`
  }
  return url
}

export async function request<T = unknown>(path: string, opts: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' }
  const token = getToken()
  if (token) headers.Authorization = `Bearer ${token}`

  const init: RequestInit = { method: opts.method ?? 'GET', headers }
  if (opts.signal) init.signal = opts.signal
  if (opts.body !== undefined) {
    headers['Content-Type'] = 'application/json'
    init.body = JSON.stringify(opts.body)
  }

  const res = await fetch(buildUrl(path, opts.query), init)

  const text = await res.text()
  let parsed: unknown = null
  if (text) {
    try {
      parsed = JSON.parse(text)
    } catch {
      parsed = text
    }
  }

  if (!res.ok) {
    const message =
      parsed && typeof parsed === 'object' && 'error' in parsed
        ? String((parsed as { error: unknown }).error)
        : `request failed (${res.status})`
    throw new ApiError(res.status, message, parsed)
  }

  return parsed as T
}

export const api = {
  get: <T = unknown>(path: string, query?: RequestOptions['query'], signal?: AbortSignal) => {
    const opts: RequestOptions = { method: 'GET' }
    if (query) opts.query = query
    if (signal) opts.signal = signal
    return request<T>(path, opts)
  },
  post: <T = unknown>(path: string, body?: unknown) => request<T>(path, { method: 'POST', body }),
  patch: <T = unknown>(path: string, body?: unknown) => request<T>(path, { method: 'PATCH', body }),
  del: <T = unknown>(path: string) => request<T>(path, { method: 'DELETE' }),
}

/**
 * Open the dashboard event WebSocket. Phase C streams live bot events
 * (mod actions, tickets, presence) over this channel.
 */
export function openEventSocket(): WebSocket {
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
  const token = getToken()
  const suffix = token ? `?token=${encodeURIComponent(token)}` : ''
  return new WebSocket(`${proto}://${window.location.host}/ws${suffix}`)
}
