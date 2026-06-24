/**
 * @nd/core: shared env config, logger, constants, and Result helpers.
 * Every other package/app imports from here.
 */
import { pino } from 'pino'
import { z } from 'zod'

// ---- Environment ----------------------------------------------------------

const envSchema = z.object({
  // Discord
  DISCORD_BOT_TOKEN: z.string().min(1, 'DISCORD_BOT_TOKEN is required'),
  DISCORD_CLIENT_ID: z.string().min(1),
  DISCORD_GUILD_ID: z.string().optional(),
  SLASH_COMMANDS_GUILD_ID: z.string().optional(),

  // AI
  GEMINI_API_KEY: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  AI_PROVIDER_MODE: z.enum(['auto', 'gemini', 'claude']).default('auto'),
  GEMINI_MODEL: z.string().default('gemini-2.0-flash'),
  ANTHROPIC_MODEL: z.string().default('claude-opus-4-8'),

  // Database
  DATABASE_PATH: z.string().default('./data/nd-bot-v2.sqlite'),

  // Dashboard API
  API_HOST: z.string().default('127.0.0.1'),
  API_PORT: z.coerce.number().default(4000),
  DASHBOARD_PUBLIC_URL: z.string().optional(),
  DASHBOARD_JWT_SECRET: z.string().optional(),
  DISCORD_OAUTH_CLIENT_ID: z.string().optional(),
  DISCORD_OAUTH_CLIENT_SECRET: z.string().optional(),
  DASHBOARD_ADMIN_USER_IDS: z.string().default(''),
  DASHBOARD_ADMIN_ROLE_IDS: z.string().default(''),

  // Runtime
  NODE_ENV: z.enum(['development', 'production', 'test']).default('production'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  DEFAULT_LOCALE: z.enum(['en', 'es', 'fr']).default('en'),
})

export type Env = z.infer<typeof envSchema>

let cachedEnv: Env | null = null

/** Parse and cache process.env. Throws with a readable message if invalid. */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  if (cachedEnv) return cachedEnv
  const parsed = envSchema.safeParse(source)
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n')
    throw new Error(`Invalid environment:\n${issues}`)
  }
  cachedEnv = parsed.data
  return cachedEnv
}

/** Parse a comma/space separated id list into a Set of snowflake strings. */
export function parseIdSet(raw: string | undefined): Set<string> {
  return new Set(
    (raw ?? '')
      .split(/[\s,]+/)
      .map((s) => s.trim())
      .filter((s) => /^\d{5,25}$/.test(s)),
  )
}

// ---- Logger ---------------------------------------------------------------

export function createLogger(name: string, level = process.env.LOG_LEVEL ?? 'info') {
  const isDev = process.env.NODE_ENV !== 'production'
  return pino({
    name,
    level,
    ...(isDev
      ? { transport: { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss' } } }
      : {}),
  })
}

export type Logger = ReturnType<typeof createLogger>

// ---- Result helper --------------------------------------------------------

export type Result<T, E = string> = { ok: true; value: T } | { ok: false; error: E }
export const Ok = <T>(value: T): Result<T, never> => ({ ok: true, value })
export const Err = <E>(error: E): Result<never, E> => ({ ok: false, error })

// ---- Constants ------------------------------------------------------------

export const BRAND = {
  name: 'Nightz Development',
  colors: {
    bg: 0x0d1117,
    panel: 0x111827,
    primary: 0x3178c6, // ND blue
    active: 0x00ff88, // neon green (active/online only)
    text: 0xffffff,
    textMuted: 0xa0adb8,
    alert: 0xff4444,
    caution: 0xffa500,
  },
} as const

export const LOCALES = ['en', 'es', 'fr'] as const
export type Locale = (typeof LOCALES)[number]
