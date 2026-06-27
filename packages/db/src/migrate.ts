/**
 * Apply Drizzle migrations from ./drizzle. Run: bun run --cwd packages/db migrate
 */
import { resolve } from 'node:path'
import { migrate } from 'drizzle-orm/bun-sqlite/migrator'
import { getDb } from './client.ts'

// Resolve the migrations folder from this module's location (not cwd, and not a
// file:// URL pathname which is malformed on Windows).
const migrationsFolder = resolve(import.meta.dir, '../drizzle')

const db = getDb()
migrate(db, { migrationsFolder })
console.log('[db] migrations applied')
