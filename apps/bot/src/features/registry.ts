/**
 * Feature registry. Each Phase B feature module exposes a setup<Feature>() that
 * registers its API routes, background loops, and container services. They are
 * called once from index.ts after the client logs in and the API server is up.
 * Commands and listeners auto-load by directory separately; this is only for the
 * non-Sapphire wiring each feature needs.
 */
import { createLogger } from '@nd/core'
import { setupAiSupport } from './ai-support/index.ts'
import { setupAutomation } from './automation/index.ts'
import { setupAutomod } from './automod/index.ts'
import { setupCommunity } from './community/index.ts'
import { setupEconomy } from './economy/index.ts'
import { setupLevels } from './levels/index.ts'
import { setupModeration } from './moderation/index.ts'
import { setupTickets } from './tickets/index.ts'
import { setupUtility } from './utility/index.ts'

const log = createLogger('features')

const FEATURES: ReadonlyArray<readonly [string, () => void]> = [
  ['moderation', setupModeration],
  ['automod', setupAutomod],
  ['tickets', setupTickets],
  ['ai-support', setupAiSupport],
  ['economy', setupEconomy],
  ['levels', setupLevels],
  ['community', setupCommunity],
  ['utility', setupUtility],
  ['automation', setupAutomation],
]

/** Run every feature setup, isolating failures so one bad module cannot abort the rest. */
export function setupFeatures(): void {
  for (const [name, setup] of FEATURES) {
    try {
      setup()
      log.info(`feature ready: ${name}`)
    } catch (err) {
      log.error({ err, feature: name }, 'feature setup failed')
    }
  }
}
