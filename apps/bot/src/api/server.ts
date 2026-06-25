/**
 * Dashboard API + WebSocket server.
 *
 * The bot process also hosts the HTTP/WS API the React dashboard (apps/web)
 * talks to. This module provides the spine that Phase B and the dashboard
 * sections plug into:
 *
 *   - `Bun.serve` bound to API_HOST / API_PORT from env (@nd/core only).
 *   - A tiny router with a `registerRoute` pattern so feature modules can add
 *     endpoints without touching this file.
 *   - A `/health` route out of the box.
 *   - A WebSocket hub (`wsHub`) with topic based subscribe / broadcast so the
 *     bot can push live events (mod actions, tickets, economy, ...) to the UI.
 *   - An auth middleware SKELETON (JWT + Discord OAuth) with clear TODOs. It is
 *     intentionally permissive in development and must be completed before any
 *     write endpoints ship.
 *
 * Wire up: `startApiServer()` is called from `index.ts` after the client logs in.
 */
import { type Logger, type Env, loadEnv, createLogger, parseIdSet } from '@nd/core'
import type { Server, ServerWebSocket } from 'bun'

// ---- Types ----------------------------------------------------------------

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

/** The authenticated principal attached to a request once auth resolves. */
export interface AuthContext {
  /** Discord user id, or null for an unauthenticated (public) request. */
  userId: string | null
  /** True when the principal passed the admin allowlist check. */
  isAdmin: boolean
  /** Roles surfaced from the OAuth/JWT claims, for finer gating later. */
  roleIds: string[]
}

export interface RouteContext {
  req: Request
  /** Path parameters captured from a `:name` style route pattern. */
  params: Record<string, string>
  /** Parsed query string. */
  url: URL
  auth: AuthContext
  server: Server<SocketData>
  logger: Logger
}

export type RouteHandler = (ctx: RouteContext) => Response | Promise<Response>

interface Route {
  method: HttpMethod
  /** Compiled matcher built from a pattern like `/api/guilds/:id/config`. */
  match: (path: string) => Record<string, string> | null
  handler: RouteHandler
  /** When true, the auth middleware must resolve an admin before the handler runs. */
  requireAdmin: boolean
}

/** Per socket state carried by Bun's WebSocket. */
interface SocketData {
  /** Topics this socket subscribed to. */
  topics: Set<string>
  auth: AuthContext
}

// ---- JSON helpers ---------------------------------------------------------

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' } as const

export function json(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { ...JSON_HEADERS, ...(init.headers ?? {}) },
  })
}

export function problem(status: number, message: string): Response {
  return json({ error: message, status }, { status })
}

// ---- Route table ----------------------------------------------------------

/** Compile `/api/guilds/:id` into a matcher returning captured params or null. */
function compilePattern(pattern: string): (path: string) => Record<string, string> | null {
  const segments = pattern.split('/').filter(Boolean)
  return (path: string) => {
    const parts = path.split('/').filter(Boolean)
    if (parts.length !== segments.length) return null
    const params: Record<string, string> = {}
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i] as string
      const part = parts[i] as string
      if (seg.startsWith(':')) {
        params[seg.slice(1)] = decodeURIComponent(part)
      } else if (seg !== part) {
        return null
      }
    }
    return params
  }
}

/**
 * The registry feature modules extend. Create one router, register routes from
 * anywhere, then hand it to `startApiServer`.
 */
export class ApiRouter {
  private readonly routes: Route[] = []

  /** Register a route. `pattern` supports `:name` path params. */
  register(
    method: HttpMethod,
    pattern: string,
    handler: RouteHandler,
    options: { requireAdmin?: boolean } = {},
  ): this {
    this.routes.push({
      method,
      match: compilePattern(pattern),
      handler,
      requireAdmin: options.requireAdmin ?? false,
    })
    return this
  }

  get(pattern: string, handler: RouteHandler, options?: { requireAdmin?: boolean }): this {
    return this.register('GET', pattern, handler, options ?? {})
  }

  post(pattern: string, handler: RouteHandler, options?: { requireAdmin?: boolean }): this {
    return this.register('POST', pattern, handler, options ?? {})
  }

  /** Find the first route matching the method + path. */
  resolve(method: string, path: string): { route: Route; params: Record<string, string> } | null {
    for (const route of this.routes) {
      if (route.method !== method) continue
      const params = route.match(path)
      if (params) return { route, params }
    }
    return null
  }
}

// ---- WebSocket hub --------------------------------------------------------

/**
 * Topic based pub/sub over Bun's native WebSocket. The bot calls `broadcast`
 * to push events; the dashboard subscribes to topics it cares about. Bun's
 * built in `subscribe`/`publish` does the fan out, so this is a thin, typed
 * wrapper plus connection bookkeeping.
 */
export class WebSocketHub {
  private readonly sockets = new Set<ServerWebSocket<SocketData>>()

  constructor(private readonly logger: Logger) {}

  add(ws: ServerWebSocket<SocketData>): void {
    this.sockets.add(ws)
  }

  remove(ws: ServerWebSocket<SocketData>): void {
    this.sockets.delete(ws)
  }

  subscribe(ws: ServerWebSocket<SocketData>, topic: string): void {
    ws.data.topics.add(topic)
    ws.subscribe(topic)
  }

  unsubscribe(ws: ServerWebSocket<SocketData>, topic: string): void {
    ws.data.topics.delete(topic)
    ws.unsubscribe(topic)
  }

  /** Push an event to every socket subscribed to `topic`. */
  broadcast(topic: string, event: string, data: unknown): void {
    if (!this.server) return
    const payload = JSON.stringify({ topic, event, data, ts: Date.now() })
    this.server.publish(topic, payload)
  }

  get connectionCount(): number {
    return this.sockets.size
  }

  /** Set once the server boots so `broadcast` can use Bun's pub/sub. */
  private server: Server<SocketData> | null = null
  attachServer(server: Server<SocketData>): void {
    this.server = server
    this.logger.debug('ws hub attached to server')
  }
}

// ---- Auth middleware (SKELETON) -------------------------------------------

/**
 * Resolve the auth context for a request.
 *
 * SKELETON. The full flow is:
 *   1. Read the `Authorization: Bearer <jwt>` header (or a signed cookie).
 *   2. Verify the JWT with DASHBOARD_JWT_SECRET (HS256). Reject on failure.
 *   3. Map the verified `sub` claim to a Discord user id and pull `roleIds`
 *      from the claims minted at OAuth login time.
 *   4. The OAuth login route (TODO, see `registerAuthRoutes`) exchanges a
 *      Discord OAuth `code` for a token, fetches the user + guild member, then
 *      mints the JWT above.
 *
 * Until that is implemented this returns an unauthenticated context, except in
 * development where, if no secret is configured, it grants admin so the
 * dashboard can be built against live data. NEVER ship that branch enabled.
 */
async function resolveAuth(req: Request, env: Env): Promise<AuthContext> {
  const adminUserIds = parseIdSet(env.DASHBOARD_ADMIN_USER_IDS)
  const adminRoleIds = parseIdSet(env.DASHBOARD_ADMIN_ROLE_IDS)

  const header = req.headers.get('authorization')
  const token = header?.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : null

  // TODO(phase-5): verify `token` as a JWT signed with env.DASHBOARD_JWT_SECRET,
  // extract { sub, roleIds } from the claims, and build the context from them.
  if (token && env.DASHBOARD_JWT_SECRET) {
    // const claims = await verifyJwt(token, env.DASHBOARD_JWT_SECRET)
    // const roleIds = claims.roleIds ?? []
    // return { userId: claims.sub, isAdmin: isAdmin(claims.sub, roleIds), roleIds }
  }

  // Development convenience: no secret configured means auth is not wired yet.
  if (env.NODE_ENV !== 'production' && !env.DASHBOARD_JWT_SECRET) {
    return { userId: 'dev', isAdmin: true, roleIds: [] }
  }

  void adminUserIds
  void adminRoleIds
  return { userId: null, isAdmin: false, roleIds: [] }
}

/**
 * Register the Discord OAuth + JWT auth routes.
 *
 * SKELETON. Adds the endpoints the dashboard login flow needs. Bodies are TODOs
 * so the surface is stable for Phase 5 to fill in.
 */
export function registerAuthRoutes(router: ApiRouter, env: Env): void {
  // Step 1: redirect the browser to Discord's OAuth consent screen.
  router.get('/api/auth/login', ({ url }) => {
    // TODO(phase-5): build the Discord authorize URL with DISCORD_OAUTH_CLIENT_ID,
    // a `redirect_uri` derived from DASHBOARD_PUBLIC_URL, scope `identify guilds`,
    // and a signed `state` to defend against CSRF, then 302 to it.
    void url
    void env
    return problem(501, 'oauth login not implemented')
  })

  // Step 2: Discord redirects back here with `?code=...&state=...`.
  router.get('/api/auth/callback', ({ url }) => {
    // TODO(phase-5): validate `state`, exchange `code` for an access token with
    // DISCORD_OAUTH_CLIENT_SECRET, fetch the user + guild member, then mint a
    // JWT (HS256, DASHBOARD_JWT_SECRET) and set it as a secure http only cookie.
    void url
    return problem(501, 'oauth callback not implemented')
  })

  // Return the current principal so the SPA can render the right shell.
  router.get('/api/auth/me', ({ auth }) => json({ auth }))

  // Clear the session cookie.
  router.post('/api/auth/logout', () => json({ ok: true }))
}

// ---- Server ---------------------------------------------------------------

export interface ApiServer {
  server: Server<SocketData>
  router: ApiRouter
  hub: WebSocketHub
  stop(): void
}

export interface StartApiOptions {
  env?: Env
  /** Pre populate the router before the server boots (e.g. from index.ts). */
  configureRoutes?: (router: ApiRouter) => void
}

/**
 * Boot the HTTP + WebSocket server. Returns the server, router, and hub so the
 * caller can register more routes or broadcast events later.
 */
export function startApiServer(options: StartApiOptions = {}): ApiServer {
  const env = options.env ?? loadEnv()
  const logger = createLogger('api')
  const router = new ApiRouter()
  const hub = new WebSocketHub(logger)

  // Built in routes.
  router.get('/health', () =>
    json({ status: 'ok', uptime: Math.round(process.uptime()), connections: hub.connectionCount }),
  )
  registerAuthRoutes(router, env)
  options.configureRoutes?.(router)

  const server = Bun.serve<SocketData, never>({
    hostname: env.API_HOST,
    port: env.API_PORT,

    async fetch(req, srv) {
      const url = new URL(req.url)

      // Upgrade the WS endpoint. Auth is resolved before the upgrade so the
      // socket carries an authenticated context.
      if (url.pathname === '/ws') {
        const auth = await resolveAuth(req, env)
        const ok = srv.upgrade(req, { data: { topics: new Set<string>(), auth } })
        return ok ? undefined : problem(426, 'expected a websocket upgrade')
      }

      const resolved = router.resolve(req.method, url.pathname)
      if (!resolved) return problem(404, 'not found')

      const auth = await resolveAuth(req, env)
      if (resolved.route.requireAdmin && !auth.isAdmin) {
        return problem(auth.userId ? 403 : 401, auth.userId ? 'forbidden' : 'unauthorized')
      }

      try {
        return await resolved.route.handler({ req, params: resolved.params, url, auth, server: srv, logger })
      } catch (err) {
        logger.error({ err, path: url.pathname }, 'route handler threw')
        return problem(500, 'internal error')
      }
    },

    websocket: {
      open(ws) {
        hub.add(ws)
        logger.debug({ connections: hub.connectionCount }, 'ws open')
      },
      close(ws) {
        hub.remove(ws)
        logger.debug({ connections: hub.connectionCount }, 'ws close')
      },
      message(ws, raw) {
        // Minimal control protocol: { action: 'subscribe' | 'unsubscribe', topic }.
        // Feature topics are pushed via hub.broadcast from the bot side.
        try {
          const text = typeof raw === 'string' ? raw : raw.toString()
          const msg = JSON.parse(text) as { action?: string; topic?: string }
          if (!msg.topic) return
          if (msg.action === 'subscribe') hub.subscribe(ws, msg.topic)
          else if (msg.action === 'unsubscribe') hub.unsubscribe(ws, msg.topic)
        } catch {
          ws.send(JSON.stringify({ error: 'invalid message' }))
        }
      },
    },
  })

  hub.attachServer(server)
  logger.info(`API listening on http://${env.API_HOST}:${env.API_PORT}`)

  return {
    server,
    router,
    hub,
    stop() {
      server.stop(true)
    },
  }
}
