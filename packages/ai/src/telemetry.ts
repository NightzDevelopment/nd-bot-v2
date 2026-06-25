/**
 * AI telemetry: one row per generation attempt in the ai_telemetry table.
 * Writes are best effort and never throw into the caller's hot path.
 */
import { createLogger } from '@nd/core'
import { getDb, schema } from '@nd/db'

const log = createLogger('ai:telemetry')

export interface TelemetryRecord {
  provider: string
  model: string
  intent?: string | undefined
  latencyMs: number
  cached: boolean
  ok: boolean
  inputTokens?: number | undefined
  outputTokens?: number | undefined
}

/** Persist a telemetry row. Failures are logged, not propagated. */
export async function recordTelemetry(rec: TelemetryRecord): Promise<void> {
  try {
    const db = getDb()
    await db.insert(schema.aiTelemetry).values({
      provider: rec.provider,
      model: rec.model,
      intent: rec.intent ?? null,
      inputTokens: rec.inputTokens ?? null,
      outputTokens: rec.outputTokens ?? null,
      latencyMs: rec.latencyMs,
      cached: rec.cached,
      ok: rec.ok,
    })
  } catch (err) {
    log.warn({ err }, 'failed to record ai telemetry')
  }
}
