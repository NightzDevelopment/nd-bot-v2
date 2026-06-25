/**
 * AutomationService: loads enabled rules per guild (cached), dispatches trigger
 * events to matching rules, and runs them through the engine. Registered on the
 * Sapphire container as `container.automation` by setupAutomation().
 */
import { container } from '@sapphire/framework'
import { and, eq } from 'drizzle-orm'
import { type DB, automationRules, getDb } from '@nd/db'
import { type EventContext, conditionsPass, runActions, safeRegex } from './engine.ts'
import { type LoadedRule, type TriggerType, parseRuleDefinition } from './types.ts'

const RULES_DISABLED_DEFAULT = false

/** How a message/reaction event narrows down which rules to consider. */
interface MessageEventInput {
  ctx: EventContext
  channelId: string | null
}

export class AutomationService {
  private readonly db: DB
  /** guildId -> enabled rules, lazily loaded and invalidated on writes. */
  private readonly cache = new Map<string, LoadedRule[]>()

  constructor(db: DB = getDb()) {
    this.db = db
  }

  /** Load (cached) the enabled, valid rules for a guild. */
  async getRules(guildId: string): Promise<LoadedRule[]> {
    const cached = this.cache.get(guildId)
    if (cached) return cached

    const rows = await this.db
      .select()
      .from(automationRules)
      .where(and(eq(automationRules.guildId, guildId), eq(automationRules.enabled, true)))

    const loaded: LoadedRule[] = []
    for (const row of rows) {
      const def = parseRuleDefinition({
        trigger: row.trigger,
        conditions: row.conditions,
        actions: row.actions,
      })
      if (!def) {
        container.logger.warn({ rule: row.id }, 'automation rule failed to parse, skipping')
        continue
      }
      loaded.push({ id: row.id, name: row.name, enabled: row.enabled, ...def })
    }

    this.cache.set(guildId, loaded)
    return loaded
  }

  /** Drop a guild from the rule cache. Call after any create/enable/disable/delete. */
  invalidate(guildId: string): void {
    this.cache.delete(guildId)
  }

  private async rulesOfType(guildId: string, type: TriggerType): Promise<LoadedRule[]> {
    const rules = await this.getRules(guildId)
    return rules.filter((r) => r.trigger.type === type)
  }

  /** Dispatch a message event to message-keyword rules. */
  async handleMessage(input: MessageEventInput): Promise<void> {
    const { ctx, channelId } = input
    const rules = await this.rulesOfType(ctx.guild.id, 'messageKeyword')
    for (const rule of rules) {
      if (rule.trigger.type !== 'messageKeyword') continue
      const trig = rule.trigger
      if (trig.channelId && trig.channelId !== channelId) continue

      const matched = this.matchKeyword(trig.keyword, trig.regex, ctx.content)
      if (matched === null) continue

      await this.fire(rule, { ...ctx, match: matched })
    }
  }

  /** Dispatch a member-join event to memberJoin rules. */
  async handleMemberJoin(ctx: EventContext): Promise<void> {
    const rules = await this.rulesOfType(ctx.guild.id, 'memberJoin')
    for (const rule of rules) await this.fire(rule, ctx)
  }

  /** Dispatch a reaction-add event to reaction rules. */
  async handleReaction(input: {
    ctx: EventContext
    emoji: string
    messageId: string
  }): Promise<void> {
    const rules = await this.rulesOfType(input.ctx.guild.id, 'reaction')
    for (const rule of rules) {
      if (rule.trigger.type !== 'reaction') continue
      const trig = rule.trigger
      if (trig.messageId && trig.messageId !== input.messageId) continue
      if (trig.emoji && trig.emoji !== input.emoji) continue
      await this.fire(rule, input.ctx)
    }
  }

  /** Run all scheduled rules across all loaded guilds whose interval has elapsed. */
  async runScheduled(now: number): Promise<void> {
    for (const guild of container.client.guilds.cache.values()) {
      const rules = await this.rulesOfType(guild.id, 'scheduled')
      for (const rule of rules) {
        if (rule.trigger.type !== 'scheduled') continue
        const last = this.lastRun.get(rule.id) ?? 0
        if (now - last < rule.trigger.intervalMs) continue
        this.lastRun.set(rule.id, now)
        const ctx: EventContext = {
          guild,
          member: null,
          channel: null,
          content: '',
          match: '',
        }
        await this.fire(rule, ctx)
      }
    }
  }

  /** Tracks the last run time of scheduled rules so the loop respects intervals. */
  private readonly lastRun = new Map<number, number>()

  /** Evaluate conditions then run actions, broadcasting the firing to the dashboard. */
  private async fire(rule: LoadedRule, ctx: EventContext): Promise<void> {
    if (!conditionsPass(rule.conditions, ctx)) return
    await runActions(rule, ctx)
    container.api?.hub.broadcast('automation', 'rule_fired', {
      guildId: ctx.guild.id,
      ruleId: rule.id,
      name: rule.name,
      trigger: rule.trigger.type,
      ts: Date.now(),
    })
  }

  /**
   * Return the matched text if `content` matches, or null if not. An empty
   * keyword matches everything (returns ''). Regex returns its first group or
   * the whole match.
   */
  private matchKeyword(keyword: string, regex: boolean, content: string): string | null {
    if (keyword.length === 0) return ''
    if (regex) {
      const re = safeRegex(keyword)
      if (!re) return null
      const m = re.exec(content)
      return m ? (m[1] ?? m[0]) : null
    }
    return content.toLowerCase().includes(keyword.toLowerCase()) ? keyword : null
  }
}

export { RULES_DISABLED_DEFAULT }
