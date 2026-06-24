/**
 * nd-bot-v2 entrypoint. Sapphire client bootstrap.
 * SCAFFOLD: the build phase registers commands/, listeners/, preconditions/,
 * and the feature modules, plus starts the dashboard API/WS server.
 */
import '@sapphire/plugin-logger/register'
import { loadEnv, createLogger } from '@nd/core'
import { getDb } from '@nd/db'
import { SapphireClient } from '@sapphire/framework'
import { GatewayIntentBits, Partials } from 'discord.js'

const log = createLogger('bot')
const env = loadEnv()

// Touch the DB early so a bad path fails fast.
getDb(env.DATABASE_PATH)

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

async function main() {
  try {
    await client.login(env.DISCORD_BOT_TOKEN)
  } catch (err) {
    log.fatal({ err }, 'login failed')
    process.exit(1)
  }
}

void main()
