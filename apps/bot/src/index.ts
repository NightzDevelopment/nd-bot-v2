/**
 * nd-bot-v2 entrypoint. Sapphire client bootstrap.
 *
 * Boots the Discord client, registers the shared config service on the
 * container, and starts the dashboard API/WS server after login. Sapphire auto
 * loads pieces from `src/commands` and `src/listeners` (and any other piece
 * stores Phase B modules add), so feature modules just drop files into those
 * folders to extend the bot.
 */
import '@sapphire/plugin-logger/register'
import './lib/container.ts'
import { loadEnv, createLogger } from '@nd/core'
import { getDb } from '@nd/db'
import { container, SapphireClient } from '@sapphire/framework'
import { GatewayIntentBits, Partials } from 'discord.js'
import { ConfigService } from './lib/config.ts'
import { startApiServer } from './api/server.ts'

const log = createLogger('bot')
const env = loadEnv()

// Touch the DB early so a bad path fails fast, and reuse the connection.
const db = getDb(env.DATABASE_PATH)

const client = new SapphireClient({
  defaultPrefix: 'nd!',
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates,
  ],
  partials: [Partials.Message, Partials.Channel, Partials.Reaction, Partials.GuildMember, Partials.User],
  loadMessageCommandListeners: true,
})

// Share core services on the container before any piece loads.
container.config = new ConfigService(db)
container.api = null

async function main() {
  try {
    await client.login(env.DISCORD_BOT_TOKEN)
    // Start the dashboard API only after the gateway is up so /health and WS
    // broadcasts reflect a live client.
    container.api = startApiServer({ env })
  } catch (err) {
    log.fatal({ err }, 'startup failed')
    process.exit(1)
  }
}

async function shutdown(signal: string) {
  log.info({ signal }, 'shutting down')
  container.api?.stop()
  await client.destroy()
  process.exit(0)
}

process.on('SIGINT', () => void shutdown('SIGINT'))
process.on('SIGTERM', () => void shutdown('SIGTERM'))

void main()
