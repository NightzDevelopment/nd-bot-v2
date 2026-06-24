/**
 * @nd/i18n: tiny type-safe translator over flat key catalogs. EN is the source
 * of truth; ES and FR mirror its keys. Build phase fills the catalogs.
 */
import type { Locale } from '@nd/core'
import { en } from './locales/en.ts'
import { es } from './locales/es.ts'
import { fr } from './locales/fr.ts'

export type Catalog = Record<string, string>
const catalogs: Record<Locale, Catalog> = { en, es, fr }

/** Translate a key for a locale, interpolating {placeholders}. Falls back to EN then the key. */
export function t(locale: Locale, key: string, vars: Record<string, string | number> = {}): string {
  const template = catalogs[locale]?.[key] ?? en[key] ?? key
  return template.replace(/\{(\w+)\}/g, (_m, name: string) =>
    name in vars ? String(vars[name]) : `{${name}}`,
  )
}

export { en, es, fr }
