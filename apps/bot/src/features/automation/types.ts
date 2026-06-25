/**
 * Automation rule shapes.
 *
 * A rule is a trigger that, when fired, evaluates a list of conditions (all must
 * pass, AND) and then runs a list of actions in order. Triggers, conditions and
 * actions are stored as JSON blobs in `automation_rules` (trigger / conditions /
 * actions columns). These zod schemas are the single source of truth for that
 * JSON, used both when building a rule from command options and when loading and
 * running rules from the database.
 *
 * Defined locally to the automation feature so other modules do not depend on it.
 */
import { z } from 'zod'

// ---- Triggers -------------------------------------------------------------

/** Fires when a message matches a keyword (or any message, if no keyword). */
const messageKeywordTrigger = z.object({
  type: z.literal('messageKeyword'),
  /** Case-insensitive substring or, when `regex` is true, a regular expression. */
  keyword: z.string().default(''),
  regex: z.boolean().default(false),
  /** Only react in this channel when set. */
  channelId: z.string().nullable().default(null),
})

/** Fires when a member joins the guild. */
const memberJoinTrigger = z.object({
  type: z.literal('memberJoin'),
})

/** Fires when a reaction is added to a message. */
const reactionTrigger = z.object({
  type: z.literal('reaction'),
  /** Unicode emoji or custom emoji id to match; empty matches any. */
  emoji: z.string().default(''),
  /** Only react on this message when set. */
  messageId: z.string().nullable().default(null),
})

/** Fires on a fixed interval handled by the scheduler loop. */
const scheduledTrigger = z.object({
  type: z.literal('scheduled'),
  /** How often to run, in milliseconds. Minimum one minute. */
  intervalMs: z.number().int().min(60_000).default(3_600_000),
})

export const triggerSchema = z.discriminatedUnion('type', [
  messageKeywordTrigger,
  memberJoinTrigger,
  reactionTrigger,
  scheduledTrigger,
])
export type Trigger = z.infer<typeof triggerSchema>
export type TriggerType = Trigger['type']

// ---- Conditions -----------------------------------------------------------

/** The acting member has the given role. */
const roleHasCondition = z.object({
  type: z.literal('roleHas'),
  roleId: z.string(),
})

/** The acting member lacks the given role. */
const roleLacksCondition = z.object({
  type: z.literal('roleLacks'),
  roleId: z.string(),
})

/** The event happened in the given channel. */
const channelIsCondition = z.object({
  type: z.literal('channelIs'),
  channelId: z.string(),
})

/** The message content matches the given regular expression. */
const regexMatchCondition = z.object({
  type: z.literal('regexMatch'),
  pattern: z.string(),
})

export const conditionSchema = z.discriminatedUnion('type', [
  roleHasCondition,
  roleLacksCondition,
  channelIsCondition,
  regexMatchCondition,
])
export type Condition = z.infer<typeof conditionSchema>

// ---- Actions --------------------------------------------------------------

/**
 * Send a message. `{user}`, `{guild}`, `{channel}` and `{match}` placeholders in
 * the content are filled from the event context.
 */
const sendMessageAction = z.object({
  type: z.literal('sendMessage'),
  content: z.string(),
  /** Target channel; defaults to the channel the event happened in. */
  channelId: z.string().nullable().default(null),
})

/** Add a role to the acting member. */
const addRoleAction = z.object({
  type: z.literal('addRole'),
  roleId: z.string(),
})

/** Remove a role from the acting member. */
const removeRoleAction = z.object({
  type: z.literal('removeRole'),
  roleId: z.string(),
})

/** Record a moderation warning against the acting member. */
const warnAction = z.object({
  type: z.literal('warn'),
  reason: z.string().default('Automated warning'),
})

/** Delete the triggering message (message triggers only). */
const deleteAction = z.object({
  type: z.literal('delete'),
})

export const actionSchema = z.discriminatedUnion('type', [
  sendMessageAction,
  addRoleAction,
  removeRoleAction,
  warnAction,
  deleteAction,
])
export type Action = z.infer<typeof actionSchema>
export type ActionType = Action['type']

// ---- Rule -----------------------------------------------------------------

/** A complete rule definition (the JSON parts of an `automation_rules` row). */
export const ruleDefinitionSchema = z.object({
  trigger: triggerSchema,
  conditions: z.array(conditionSchema).default([]),
  actions: z.array(actionSchema).min(1),
})
export type RuleDefinition = z.infer<typeof ruleDefinitionSchema>

/** A rule loaded from the DB: the row id and name plus its parsed definition. */
export interface LoadedRule extends RuleDefinition {
  id: number
  name: string
  enabled: boolean
}

/** Parse the JSON columns of a row into a typed definition, or null if invalid. */
export function parseRuleDefinition(raw: {
  trigger: unknown
  conditions: unknown
  actions: unknown
}): RuleDefinition | null {
  const result = ruleDefinitionSchema.safeParse({
    trigger: raw.trigger,
    conditions: raw.conditions ?? [],
    actions: raw.actions,
  })
  return result.success ? result.data : null
}
