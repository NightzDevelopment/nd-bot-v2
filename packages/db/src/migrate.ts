/**
 * Apply Drizzle migrations from ./drizzle. Run: bun run --cwd packages/db migrate
 */
import { migrate } from 'drizzle-orm/bun-sqlite/migrator'
import { getDb } from './client.ts'

const db = getDb()
migrate(db, { migrationsFolder: new URL('../drizzle', import.meta.url).pathname })
console.log('[db] migrations applied')
