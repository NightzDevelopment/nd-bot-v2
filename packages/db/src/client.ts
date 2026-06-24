/**
 * Drizzle client over bun:sqlite. Single shared connection with WAL enabled.
 */
import { Database } from 'bun:sqlite'
import { drizzle } from 'drizzle-orm/bun-sqlite'
import * as schema from './schema.ts'

let db: ReturnType<typeof drizzle<typeof schema>> | null = null
let sqlite: Database | null = null

export function getDb(path = process.env.DATABASE_PATH ?? './data/nd-bot-v2.sqlite') {
  if (db) return db
  sqlite = new Database(path, { create: true })
  sqlite.exec('PRAGMA journal_mode = WAL;')
  sqlite.exec('PRAGMA foreign_keys = ON;')
  sqlite.exec('PRAGMA busy_timeout = 5000;')
  db = drizzle(sqlite, { schema })
  return db
}

export function closeDb() {
  sqlite?.close()
  db = null
  sqlite = null
}

export type DB = ReturnType<typeof getDb>
