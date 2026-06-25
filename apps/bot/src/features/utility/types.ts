/**
 * Shared types for the utility feature. The row types are inferred from the
 * Drizzle table shapes so they track the schema automatically.
 */
import type { reactionRoles, reminders } from '@nd/db'

export type Reminder = typeof reminders.$inferSelect
export type ReactionRole = typeof reactionRoles.$inferSelect
