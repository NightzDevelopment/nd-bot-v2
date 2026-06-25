/**
 * Shared helpers for the economy commands: locating the singleton service,
 * formatting currency + durations, and the module-enabled gate. Keeping these
 * here means each command file stays focused on its own flow.
 */
import { container } from '@sapphire/framework'
import { t } from '@nd/i18n'
import type { Locale } from '@nd/core'
import { EconomyService } from './service.ts'

/**
 * Resolve the economy service. `setupEconomy()` registers it on the container,
 * but commands can load before setup runs during boot, so fall back to a lazily
 * constructed instance that shares the default DB connection.
 */
let fallback: EconomyService | null = null
export function economyService(): EconomyService {
  if (container.economy) return container.economy
  fallback ??= new EconomyService()
  return fallback
}

/** Format an amount with the localized currency name, e.g. "250 coins". */
export function money(locale: Locale, amount: number): string {
  return `${amount.toLocaleString('en-US')} ${t(locale, 'economy.currency_name')}`
}

/** Human-friendly remaining cooldown, e.g. "2h 5m" or "45s". */
export function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  const parts: string[] = []
  if (hours > 0) parts.push(`${hours}h`)
  if (minutes > 0) parts.push(`${minutes}m`)
  if (seconds > 0 && hours === 0) parts.push(`${seconds}s`)
  return parts.length > 0 ? parts.join(' ') : '0s'
}

/** True when the economy module is enabled for the guild (defaults to on). */
export async function economyEnabled(guildId: string): Promise<boolean> {
  try {
    const settings = await container.config.getSettings(guildId)
    return settings.modules.economy.enabled
  } catch {
    return true
  }
}
