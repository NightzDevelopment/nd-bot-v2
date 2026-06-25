/**
 * Single source of truth for dashboard sections. The sidebar renders this list
 * and App.tsx builds a route per entry, so adding a section in Phase C means
 * adding one record here plus its page component.
 */
export interface NavSection {
  /** url segment under the dashboard root; '' is the index (Overview) */
  path: string
  /** sidebar + page label */
  label: string
  /** short description used on placeholder pages */
  blurb: string
}

export const NAV_SECTIONS: readonly NavSection[] = [
  { path: '', label: 'Overview', blurb: 'Live server health, bot status, and key metrics.' },
  { path: 'moderation', label: 'Moderation', blurb: 'Cases, warnings, mod notes, and the audit feed.' },
  { path: 'tickets', label: 'Tickets', blurb: 'Open, claimed, and closed support tickets with transcripts.' },
  { path: 'ai', label: 'AI / Knowledge', blurb: 'Agent telemetry, memory, and the RAG knowledge base.' },
  { path: 'economy', label: 'Economy', blurb: 'Balances, transactions, shop, and quests.' },
  { path: 'levels', label: 'Levels', blurb: 'XP, level roles, and leaderboards.' },
  { path: 'community', label: 'Community', blurb: 'Polls, giveaways, suggestions, and counters.' },
  { path: 'automation', label: 'Automation', blurb: 'Trigger to condition to action rules and scheduled jobs.' },
  { path: 'analytics', label: 'Analytics', blurb: 'Message, command, join, and AI usage trends.' },
  { path: 'members', label: 'Members', blurb: 'Member directory with per-user profiles.' },
  { path: 'config', label: 'Config', blurb: 'Per-guild feature toggles, channels, and thresholds.' },
  { path: 'audit', label: 'Audit', blurb: 'Dashboard action log: who changed what, and when.' },
] as const
