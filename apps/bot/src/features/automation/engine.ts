/**
 * Automation engine: condition evaluation + action execution.
 *
 * Everything here is defensive. Rules are user-authored data running against a
 * live guild, so each condition and action is wrapped so a single bad rule can
 * never throw out of the listener that invoked it. Failures are logged and the
 * rule simply stops.
 */
import { container } from '@sapphire/framework'
import {
  type Guild,
  type GuildMember,
  PermissionFlagsBits,
  type SendableChannels,
  type TextBasedChannel,
} from 'discord.js'
import { getDb, modCases } from '@nd/db'
import type { Action, Condition, LoadedRule } from './types.ts'

/** The runtime context passed to the engine when a trigger fires. */
export interface EventContext {
  guild: Guild
  /** The member that caused the event, when there is one (join, message, reaction). */
  member: GuildMember | null
  /** The channel the event happened in, when applicable. */
  channel: TextBasedChannel | null
  /** The message content, for message-keyword and regex conditions. */
  content: string
  /** A captured match (keyword or first regex group) for {match} interpolation. */
  match: string
  /** Delete the triggering message if possible (set by message triggers). */
  deleteSource?: () => Promise<void>
}

/** Evaluate every condition with AND semantics. Unknown/failed conditions fail closed. */
export function conditionsPass(conditions: Condition[], ctx: EventContext): boolean {
  for (const condition of conditions) {
    if (!evaluateCondition(condition, ctx)) return false
  }
  return true
}

function evaluateCondition(condition: Condition, ctx: EventContext): boolean {
  try {
    switch (condition.type) {
      case 'roleHas':
        return ctx.member?.roles.cache.has(condition.roleId) ?? false
      case 'roleLacks':
        return ctx.member ? !ctx.member.roles.cache.has(condition.roleId) : false
      case 'channelIs':
        return ctx.channel?.id === condition.channelId
      case 'regexMatch':
        return safeRegex(condition.pattern)?.test(ctx.content) ?? false
      default:
        return false
    }
  } catch (err) {
    container.logger.warn({ err, condition: condition.type }, 'automation condition errored')
    return false
  }
}

/** Run a rule's actions in order. Each action is isolated; one failure does not abort the rest. */
export async function runActions(rule: LoadedRule, ctx: EventContext): Promise<void> {
  for (const action of rule.actions) {
    try {
      await executeAction(action, ctx, rule)
    } catch (err) {
      container.logger.warn(
        { err, rule: rule.id, action: action.type },
        'automation action failed',
      )
    }
  }
}

async function executeAction(action: Action, ctx: EventContext, rule: LoadedRule): Promise<void> {
  switch (action.type) {
    case 'sendMessage': {
      const target = await resolveSendTarget(action.channelId, ctx)
      if (!target) return
      const text = interpolate(action.content, ctx)
      if (text.length > 0) await target.send({ content: text.slice(0, 2000) })
      return
    }
    case 'addRole': {
      if (!ctx.member || !canManageRole(ctx.guild, action.roleId)) return
      await ctx.member.roles.add(action.roleId, `automation rule ${rule.id}`)
      return
    }
    case 'removeRole': {
      if (!ctx.member || !canManageRole(ctx.guild, action.roleId)) return
      await ctx.member.roles.remove(action.roleId, `automation rule ${rule.id}`)
      return
    }
    case 'warn': {
      if (!ctx.member) return
      await recordWarn(ctx, action.reason, rule)
      return
    }
    case 'delete': {
      if (ctx.deleteSource) await ctx.deleteSource()
      return
    }
    default:
      return
  }
}

// ---- Helpers --------------------------------------------------------------

/** Compile a regex defensively. Returns null on an invalid pattern. */
export function safeRegex(pattern: string, flags = 'i'): RegExp | null {
  try {
    return new RegExp(pattern, flags)
  } catch {
    return null
  }
}

/** Fill `{user} {guild} {channel} {match}` placeholders from the event context. */
function interpolate(template: string, ctx: EventContext): string {
  return template
    .replaceAll('{user}', ctx.member ? `<@${ctx.member.id}>` : '')
    .replaceAll('{guild}', ctx.guild.name)
    .replaceAll('{channel}', ctx.channel && 'name' in ctx.channel ? `#${ctx.channel.name ?? ''}` : '')
    .replaceAll('{match}', ctx.match)
}

async function resolveSendTarget(
  channelId: string | null,
  ctx: EventContext,
): Promise<SendableChannels | null> {
  if (!channelId) return ctx.channel && ctx.channel.isSendable() ? ctx.channel : null
  const channel = await ctx.guild.channels.fetch(channelId).catch(() => null)
  return channel && channel.isTextBased() && channel.isSendable() ? channel : null
}

/** Whether the bot can manage the given role (exists, manageable, has the permission). */
function canManageRole(guild: Guild, roleId: string): boolean {
  const me = guild.members.me
  if (!me || !me.permissions.has(PermissionFlagsBits.ManageRoles)) return false
  const role = guild.roles.cache.get(roleId)
  return role ? role.editable : false
}

async function recordWarn(ctx: EventContext, reason: string, rule: LoadedRule): Promise<void> {
  if (!ctx.member) return
  const db = getDb()
  await db.insert(modCases).values({
    guildId: ctx.guild.id,
    userId: ctx.member.id,
    moderatorId: ctx.guild.members.me?.id ?? ctx.guild.client.user.id,
    action: 'warn',
    reason: `[automation:${rule.id}] ${reason}`,
  })
  container.api?.hub.broadcast('moderation', 'case_created', {
    guildId: ctx.guild.id,
    userId: ctx.member.id,
    action: 'warn',
    source: 'automation',
    ruleId: rule.id,
  })
}
