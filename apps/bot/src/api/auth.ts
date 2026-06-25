/**
 * Dashboard authentication helpers: JWT (HS256), Discord OAuth2, and admin gating.
 *
 * The dashboard login flow lives in `server.ts` (registerAuthRoutes). This module
 * provides the security primitives those routes and the auth middleware use:
 *
 *   - A minimal, dependency free HS256 JWT mint/verify built on node:crypto. We
 *     sign `header.payload` with HMAC-SHA256 and compare with timingSafeEqual.
 *     This is a real MAC, not a hash of secret + payload.
 *   - `resolveJwtSecret`: returns DASHBOARD_JWT_SECRET when strong (>= 32 chars),
 *     otherwise generates a loud, per boot random secret. We NEVER ship a
 *     hardcoded default: a leaked default secret lets anyone forge admin tokens.
 *   - OAuth state CSRF: sign a random state value with the JWT secret so the
 *     callback can verify it came from our own login redirect.
 *   - `isAdminDiscordUser`: allowlist by user id OR by holding one of the admin
 *     roles in the configured guild, fetched via the live Sapphire client and
 *     cached for ~2 minutes so we do not hammer Discord on every request.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { container } from '@sapphire/framework'
import { type Env, createLogger, parseIdSet } from '@nd/core'

const log = createLogger('dashboard-auth')

// ---- JWT secret -----------------------------------------------------------

/** A secret shorter than this is treated as missing/weak. */
const MIN_SECRET_LENGTH = 32

let generatedSecret: string | null = null

/**
 * Resolve the secret used to sign dashboard JWTs.
 *
 * Returns DASHBOARD_JWT_SECRET when it is at least 32 chars. When it is unset or
 * too weak we generate a random secret once per boot and warn loudly: tokens
 * minted this run still work, but they will not survive a restart and OAuth
 * cannot be relied on. We deliberately never fall back to a constant default.
 */
export function resolveJwtSecret(env: Env): string {
  const configured = env.DASHBOARD_JWT_SECRET
  if (configured && configured.length >= MIN_SECRET_LENGTH) return configured

  if (!generatedSecret) {
    generatedSecret = randomBytes(48).toString('base64url')
    log.warn(
      'DASHBOARD_JWT_SECRET is unset or weaker than 32 chars. Generated a random ' +
        'per-boot secret. Dashboard sessions will not survive a restart. Set a ' +
        'strong DASHBOARD_JWT_SECRET in the environment for production.',
    )
  }
  return generatedSecret
}

// ---- base64url helpers ----------------------------------------------------

function base64UrlEncode(input: string | Buffer): string {
  return Buffer.from(input).toString('base64url')
}

function base64UrlDecodeToString(input: string): string {
  return Buffer.from(input, 'base64url').toString('utf8')
}

// ---- JWT (HS256) ----------------------------------------------------------

export interface JwtClaims {
  /** Subject: the Discord user id. */
  sub: string
  /** Roles surfaced at login, for finer gating later. */
  roleIds: string[]
  /** Whether the admin check passed when the token was minted. */
  isAdmin: boolean
  /** Issued at (seconds since epoch). */
  iat: number
  /** Expiry (seconds since epoch). */
  exp: number
}

interface JwtHeader {
  alg: 'HS256'
  typ: 'JWT'
}

function hmacSha256(message: string, secret: string): Buffer {
  return createHmac('sha256', secret).update(message).digest()
}

/** Constant-time comparison of two base64url signatures. */
function signaturesMatch(a: Buffer, expected: Buffer): boolean {
  if (a.length !== expected.length) return false
  return timingSafeEqual(a, expected)
}

/**
 * Mint a signed JWT. `payload` carries the user-specific claims; iat/exp are
 * derived from `ttlSeconds`.
 */
export function signJwt(
  payload: Pick<JwtClaims, 'sub' | 'roleIds' | 'isAdmin'>,
  secret: string,
  ttlSeconds: number,
): string {
  const header: JwtHeader = { alg: 'HS256', typ: 'JWT' }
  const now = Math.floor(Date.now() / 1000)
  const claims: JwtClaims = {
    sub: payload.sub,
    roleIds: payload.roleIds,
    isAdmin: payload.isAdmin,
    iat: now,
    exp: now + ttlSeconds,
  }

  const encodedHeader = base64UrlEncode(JSON.stringify(header))
  const encodedPayload = base64UrlEncode(JSON.stringify(claims))
  const signingInput = `${encodedHeader}.${encodedPayload}`
  const signature = base64UrlEncode(hmacSha256(signingInput, secret))
  return `${signingInput}.${signature}`
}

/**
 * Verify a JWT: structure, HS256 signature (timing-safe), and expiry. Returns
 * the claims on success or null on any failure. Never throws.
 */
export function verifyJwt(token: string, secret: string): JwtClaims | null {
  const parts = token.split('.')
  if (parts.length !== 3) return null
  const [encodedHeader, encodedPayload, encodedSignature] = parts
  if (!encodedHeader || !encodedPayload || !encodedSignature) return null

  const signingInput = `${encodedHeader}.${encodedPayload}`
  const expected = hmacSha256(signingInput, secret)

  let provided: Buffer
  try {
    provided = Buffer.from(encodedSignature, 'base64url')
  } catch {
    return null
  }
  if (!signaturesMatch(provided, expected)) return null

  let header: unknown
  let claims: unknown
  try {
    header = JSON.parse(base64UrlDecodeToString(encodedHeader))
    claims = JSON.parse(base64UrlDecodeToString(encodedPayload))
  } catch {
    return null
  }

  if (
    typeof header !== 'object' ||
    header === null ||
    (header as { alg?: unknown }).alg !== 'HS256'
  ) {
    return null
  }

  if (!isJwtClaims(claims)) return null

  const now = Math.floor(Date.now() / 1000)
  if (claims.exp <= now) return null

  return claims
}

function isJwtClaims(value: unknown): value is JwtClaims {
  if (typeof value !== 'object' || value === null) return false
  const c = value as Record<string, unknown>
  return (
    typeof c.sub === 'string' &&
    Array.isArray(c.roleIds) &&
    c.roleIds.every((r) => typeof r === 'string') &&
    typeof c.isAdmin === 'boolean' &&
    typeof c.iat === 'number' &&
    typeof c.exp === 'number'
  )
}

// ---- OAuth CSRF state -----------------------------------------------------

/**
 * Build a signed `state` value for the OAuth redirect. Shape is
 * `<nonce>.<hmac>` so the callback can confirm it originated here without server
 * side storage. The same value is mirrored into a short-lived httpOnly cookie.
 */
export function createOauthState(secret: string): string {
  const nonce = randomBytes(16).toString('base64url')
  const sig = base64UrlEncode(hmacSha256(nonce, secret))
  return `${nonce}.${sig}`
}

/** Verify a signed `state` value (timing-safe). */
export function verifyOauthState(state: string, secret: string): boolean {
  const parts = state.split('.')
  if (parts.length !== 2) return false
  const [nonce, sig] = parts
  if (!nonce || !sig) return false
  const expected = hmacSha256(nonce, secret)
  let provided: Buffer
  try {
    provided = Buffer.from(sig, 'base64url')
  } catch {
    return false
  }
  return signaturesMatch(provided, expected)
}

// ---- Discord OAuth2 -------------------------------------------------------

const DISCORD_API = 'https://discord.com/api/v10'

export interface DiscordUser {
  id: string
  username: string
}

export interface OauthExchangeResult {
  accessToken: string
  user: DiscordUser
}

/** The redirect URI Discord calls back to. Derived from DASHBOARD_PUBLIC_URL. */
export function oauthRedirectUri(env: Env): string {
  const base = (env.DASHBOARD_PUBLIC_URL ?? '').replace(/\/+$/, '')
  return `${base}/api/auth/callback`
}

/** Build the Discord authorize URL with our client id, scope, and signed state. */
export function buildAuthorizeUrl(env: Env, state: string): string {
  const params = new URLSearchParams({
    client_id: env.DISCORD_OAUTH_CLIENT_ID ?? '',
    redirect_uri: oauthRedirectUri(env),
    response_type: 'code',
    scope: 'identify guilds.members.read',
    state,
    prompt: 'none',
  })
  return `${DISCORD_API}/oauth2/authorize?${params.toString()}`
}

/**
 * Exchange an OAuth `code` for an access token, then fetch the user's identity.
 * Returns null on any failure. Never throws.
 */
export async function exchangeCodeForUser(
  env: Env,
  code: string,
): Promise<OauthExchangeResult | null> {
  const clientId = env.DISCORD_OAUTH_CLIENT_ID
  const clientSecret = env.DISCORD_OAUTH_CLIENT_SECRET
  if (!clientId || !clientSecret) {
    log.error('OAuth callback hit without DISCORD_OAUTH_CLIENT_ID/SECRET configured')
    return null
  }

  try {
    const tokenRes = await fetch(`${DISCORD_API}/oauth2/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: 'authorization_code',
        code,
        redirect_uri: oauthRedirectUri(env),
      }).toString(),
    })
    if (!tokenRes.ok) {
      log.warn({ status: tokenRes.status }, 'oauth token exchange failed')
      return null
    }
    const tokenBody = (await tokenRes.json()) as { access_token?: unknown }
    const accessToken = tokenBody.access_token
    if (typeof accessToken !== 'string' || accessToken.length === 0) return null

    const userRes = await fetch(`${DISCORD_API}/users/@me`, {
      headers: { authorization: `Bearer ${accessToken}` },
    })
    if (!userRes.ok) {
      log.warn({ status: userRes.status }, 'oauth user fetch failed')
      return null
    }
    const userBody = (await userRes.json()) as { id?: unknown; username?: unknown }
    if (typeof userBody.id !== 'string') return null

    return {
      accessToken,
      user: {
        id: userBody.id,
        username: typeof userBody.username === 'string' ? userBody.username : userBody.id,
      },
    }
  } catch (err) {
    log.error({ err }, 'oauth exchange threw')
    return null
  }
}

// ---- Admin gating ---------------------------------------------------------

export interface AdminCheckResult {
  isAdmin: boolean
  /** Admin role ids the user holds in the configured guild (empty when none). */
  roleIds: string[]
}

interface CacheEntry {
  value: AdminCheckResult
  expiresAt: number
}

const ADMIN_CACHE_TTL_MS = 2 * 60 * 1000
const adminCache = new Map<string, CacheEntry>()

/**
 * Decide whether a Discord user id is a dashboard admin.
 *
 * True when the id is in DASHBOARD_ADMIN_USER_IDS, OR the user holds any of
 * DASHBOARD_ADMIN_ROLE_IDS in DISCORD_GUILD_ID. The role check fetches the guild
 * member through the live Sapphire client; the result is cached ~2 minutes.
 */
export async function isAdminDiscordUser(userId: string, env: Env): Promise<AdminCheckResult> {
  const cached = adminCache.get(userId)
  if (cached && cached.expiresAt > Date.now()) return cached.value

  const result = await computeAdmin(userId, env)
  adminCache.set(userId, { value: result, expiresAt: Date.now() + ADMIN_CACHE_TTL_MS })
  return result
}

async function computeAdmin(userId: string, env: Env): Promise<AdminCheckResult> {
  const adminUserIds = parseIdSet(env.DASHBOARD_ADMIN_USER_IDS)
  if (adminUserIds.has(userId)) return { isAdmin: true, roleIds: [] }

  const adminRoleIds = parseIdSet(env.DASHBOARD_ADMIN_ROLE_IDS)
  const guildId = env.DISCORD_GUILD_ID
  if (adminRoleIds.size === 0 || !guildId) return { isAdmin: false, roleIds: [] }

  try {
    const guild =
      container.client.guilds.cache.get(guildId) ??
      (await container.client.guilds.fetch(guildId).catch(() => null))
    if (!guild) return { isAdmin: false, roleIds: [] }

    const member =
      guild.members.cache.get(userId) ??
      (await guild.members.fetch(userId).catch(() => null))
    if (!member) return { isAdmin: false, roleIds: [] }

    const held = member.roles.cache.filter((role) => adminRoleIds.has(role.id)).map((role) => role.id)
    return { isAdmin: held.length > 0, roleIds: held }
  } catch (err) {
    log.error({ err, userId }, 'admin role check threw')
    return { isAdmin: false, roleIds: [] }
  }
}
