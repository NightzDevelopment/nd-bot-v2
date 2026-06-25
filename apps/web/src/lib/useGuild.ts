/**
 * Shared current-guild lookup. The bot serves one primary guild, so pages read
 * the guild id from here instead of each refetching. The guild list is cached at
 * module scope so it is fetched once per page load.
 */
import { useEffect, useState } from 'react'
import { api } from './api'

export interface GuildSummary {
  id: string
  name: string
  memberCount?: number
  iconUrl?: string | null
}

let cache: Promise<GuildSummary[]> | null = null

/** Fetch (and cache) the bot's guilds. Shape: GET /api/guilds -> { guilds: GuildSummary[] }. */
export function loadGuilds(): Promise<GuildSummary[]> {
  if (!cache) {
    cache = api
      .get<{ guilds: GuildSummary[] }>('/api/guilds')
      .then((r) => r.guilds ?? [])
      .catch(() => [])
  }
  return cache
}

export interface UseGuildResult {
  guildId: string | null
  guilds: GuildSummary[]
  loading: boolean
}

export function useGuild(): UseGuildResult {
  const [guilds, setGuilds] = useState<GuildSummary[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    loadGuilds().then((g) => {
      if (!active) return
      setGuilds(g)
      setLoading(false)
    })
    return () => {
      active = false
    }
  }, [])

  return { guildId: guilds[0]?.id ?? null, guilds, loading }
}
