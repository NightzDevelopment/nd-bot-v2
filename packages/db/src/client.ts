/**
 * Drizzle client over bun:sqlite. Single shared connection with WAL enabled.
 */
import { mkdirSync } from 'node:fs'
import { dirname, isAbsolute, resolve } from 'node:path'
import { Database } from 'bun:sqlite'
import { drizzle } from 'drizzle-orm/bun-sqlite'
import * as schema from './schema.ts'

let db: ReturnType<typeof drizzle<typeof schema>> | null = null
let sqlite: Database | null = null

// Repo root, derived from this module's location (packages/db/src -> repo root).
// A relative DATABASE_PATH is anchored here, NOT to process.cwd(), so the bot
// (run with --cwd apps/bot) and migrations (run with --cwd packages/db) always
// open the SAME database file.
const REPO_ROOT = resolve(import.meta.dir, '../../..')

export function getDb(rawPath = process.env.DATABASE_PATH ?? 'data/nd-bot-v2.sqlite') {
  if (db) return db
  const path = isAbsolute(rawPath) ? rawPath : resolve(REPO_ROOT, rawPath)
  // bun:sqlite create:true makes the file but not its parent directory.
  mkdirSync(dirname(path), { recursive: true })
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
