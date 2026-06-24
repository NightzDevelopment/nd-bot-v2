import type { Config } from 'drizzle-kit'

export default {
  schema: './src/schema.ts',
  out: './drizzle',
  dialect: 'sqlite',
  dbCredentials: {
    url: process.env.DATABASE_PATH ?? './data/nd-bot-v2.sqlite',
  },
} satisfies Config
