/**
 * Router: resolves a request to a concrete provider, serves from cache when
 * possible, falls back to the other provider on error, and records telemetry
 * for every attempt.
 *
 * Routing in 'auto' mode: technical / code intents go to Claude, everything
 * else to Gemini. An explicit mode of 'gemini' or 'claude' pins the provider
 * (fallback to the other still applies on failure).
 */
import { loadEnv } from '@nd/core'
import { cacheKey, getCached, setCached } from './cache.ts'
import { claudeGenerateText } from './providers/claude.ts'
import { geminiGenerateText } from './providers/gemini.ts'
import { recordTelemetry } from './telemetry.ts'
import type { GenerateOptions, GenerateResult, ProviderName } from './index.ts'

const TECHNICAL_INTENTS = new Set([
  'code',
  'coding',
  'technical',
  'debug',
  'lua',
  'fivem',
  'scripting',
  'sql',
  'review',
])

/** Decide which provider handles an intent in auto mode. */
export function routeIntent(intent: string | undefined): ProviderName {
  if (!intent) return 'gemini'
  return TECHNICAL_INTENTS.has(intent.toLowerCase()) ? 'claude' : 'gemini'
}

/** Resolve the requested mode into a primary provider and its fallback. */
function resolveProviders(opts: GenerateOptions): { primary: ProviderName; fallback: ProviderName } {
  const mode = opts.mode ?? loadEnv().AI_PROVIDER_MODE
  const primary: ProviderName = mode === 'auto' ? routeIntent(opts.intent) : mode
  const fallback: ProviderName = primary === 'gemini' ? 'claude' : 'gemini'
  return { primary, fallback }
}

interface ProviderCall {
  text: string
  model: string
  inputTokens?: number | undefined
  outputTokens?: number | undefined
}

async function callProvider(name: ProviderName, opts: GenerateOptions): Promise<ProviderCall> {
  return name === 'claude' ? claudeGenerateText(opts) : geminiGenerateText(opts)
}

async function attempt(
  name: ProviderName,
  opts: GenerateOptions,
): Promise<GenerateResult> {
  const start = Date.now()
  try {
    const call = await callProvider(name, opts)
    await recordTelemetry({
      provider: name,
      model: call.model,
      intent: opts.intent,
      latencyMs: Date.now() - start,
      cached: false,
      ok: true,
      inputTokens: call.inputTokens,
      outputTokens: call.outputTokens,
    })
    const result: GenerateResult = { text: call.text, provider: name, model: call.model, cached: false }
    setCached(cacheKey(opts), { text: call.text, provider: name, model: call.model })
    return result
  } catch (err) {
    await recordTelemetry({
      provider: name,
      model: name === 'claude' ? loadEnv().ANTHROPIC_MODEL : loadEnv().GEMINI_MODEL,
      intent: opts.intent,
      latencyMs: Date.now() - start,
      cached: false,
      ok: false,
    })
    throw err
  }
}

export interface Router {
  generate(opts: GenerateOptions): Promise<GenerateResult>
}

function createRouter(): Router {
  return {
    async generate(opts: GenerateOptions): Promise<GenerateResult> {
      const key = cacheKey(opts)
      const hit = getCached(key)
      if (hit) {
        await recordTelemetry({
          provider: hit.provider,
          model: hit.model,
          intent: opts.intent,
          latencyMs: 0,
          cached: true,
          ok: true,
        })
        return { text: hit.text, provider: hit.provider, model: hit.model, cached: true }
      }

      const { primary, fallback } = resolveProviders(opts)
      try {
        return await attempt(primary, opts)
      } catch (primaryErr) {
        try {
          return await attempt(fallback, opts)
        } catch (fallbackErr) {
          const detail = fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr)
          const primaryDetail = primaryErr instanceof Error ? primaryErr.message : String(primaryErr)
          throw new Error(
            `both providers failed (primary ${primary}: ${primaryDetail}; fallback ${fallback}: ${detail})`,
          )
        }
      }
    },
  }
}

let router: Router | null = null

/** Shared router singleton. */
export function getRouter(): Router {
  if (!router) router = createRouter()
  return router
}
