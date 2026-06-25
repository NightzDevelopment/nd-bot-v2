/**
 * Tickets feature constants.
 *
 * Local defaults and stable custom ids. These live here (not in config.ts) so
 * the feature is self contained; settings that belong in the central config are
 * listed in the agent result for later promotion.
 */

/** Default cap on simultaneously open tickets per member when settings omit it. */
export const DEFAULT_MAX_OPEN_PER_USER = 1

/** Default ticket categories offered in the panel select menu. */
export const DEFAULT_CATEGORIES = [
  { value: 'support', label: 'General support' },
  { value: 'report', label: 'Report a member' },
  { value: 'billing', label: 'Billing and store' },
  { value: 'other', label: 'Something else' },
] as const

export type TicketCategoryValue = (typeof DEFAULT_CATEGORIES)[number]['value']

/** Stable interaction custom ids. The panel button opens a category select. */
export const CUSTOM_ID = {
  /** Panel button that starts the open flow. */
  panelOpen: 'tickets:panel:open',
  /** Category select rendered after the panel button. */
  categorySelect: 'tickets:open:category',
  /** Claim button inside a ticket channel. */
  claim: 'tickets:action:claim',
  /** Close button inside a ticket channel. */
  close: 'tickets:action:close',
} as const

/** Returns true when a custom id belongs to this feature. */
export function isTicketCustomId(id: string): boolean {
  return id.startsWith('tickets:')
}

/** Priority levels the AI triage may assign. */
export const PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const
export type TicketPriority = (typeof PRIORITIES)[number]
