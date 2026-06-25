/**
 * Utility feature service.
 *
 * Owns the persisted reminder scheduler (restart safe), shared lookups for
 * reaction roles, and the welcome/goodbye template helpers. Commands and
 * listeners reach it through `container.utility`.
 *
 * The scheduler keeps a single in memory timer for the next due reminder rather
 * than one timer per row, so it scales and survives restarts: on boot the
 * resume loop fires anything already overdue, then schedules the soonest
 * remaining reminder. Repeating reminders (repeatMs) are rescheduled in place.
 */
import { and, asc, eq, lte } from 'drizzle-orm'
import { container } from '@sapphire/framework'
import { type DB, getDb, reminders } from '@nd/db'
import { reminderEmbedFor } from './embeds.ts'
import type { Reminder } from './types.ts'

/** Hard ceiling for a single setTimeout so far future reminders re-arm safely. */
const MAX_TIMEOUT_MS = 2_147_000_000

export class UtilityService {
  private readonly db: DB
  private timer: ReturnType<typeof setTimeout> | null = null
  private running = false

  constructor(db: DB = getDb()) {
    this.db = db
  }

  // ---- Reminders ----------------------------------------------------------

  /** Persist a reminder and (re)arm the scheduler if it becomes the soonest. */
  async createReminder(input: {
    guildId: string | null
    channelId: string
    userId: string
    content: string
    remindAt: number
    repeatMs: number | null
  }): Promise<Reminder> {
    const rows = await this.db
      .insert(reminders)
      .values({
        guildId: input.guildId,
        channelId: input.channelId,
        userId: input.userId,
        content: input.content,
        remindAt: input.remindAt,
        repeatMs: input.repeatMs,
      })
      .returning()
    const row = rows[0]
    if (!row) throw new Error('failed to persist reminder')
    this.scheduleNext()
    return row
  }

  /** List a user's pending reminders, soonest first. */
  async listReminders(userId: string): Promise<Reminder[]> {
    return this.db
      .select()
      .from(reminders)
      .where(eq(reminders.userId, userId))
      .orderBy(asc(reminders.remindAt))
  }

  /**
   * Delete a reminder owned by `userId`. Returns true when a row was removed so
   * callers can tell "cancelled" from "not yours / not found".
   */
  async cancelReminder(id: number, userId: string): Promise<boolean> {
    const removed = await this.db
      .delete(reminders)
      .where(and(eq(reminders.id, id), eq(reminders.userId, userId)))
      .returning({ id: reminders.id })
    this.scheduleNext()
    return removed.length > 0
  }

  /** Start the scheduler. Fires overdue reminders, then arms the next timer. */
  start(): void {
    if (this.running) return
    this.running = true
    void this.tick()
  }

  /** Stop the scheduler and clear any pending timer. */
  stop(): void {
    this.running = false
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
  }

  /** Fire everything due now, reschedule repeats, then arm the next timer. */
  private async tick(): Promise<void> {
    if (!this.running) return
    const nowMs = Date.now()

    let due: Reminder[]
    try {
      due = await this.db
        .select()
        .from(reminders)
        .where(lte(reminders.remindAt, nowMs))
        .orderBy(asc(reminders.remindAt))
    } catch (err) {
      container.logger.error({ err }, 'utility: failed to load due reminders')
      this.armRetry()
      return
    }

    for (const reminder of due) {
      try {
        await this.deliver(reminder)
      } catch (err) {
        container.logger.error({ err, reminderId: reminder.id }, 'utility: reminder delivery failed')
      }

      if (reminder.repeatMs && reminder.repeatMs > 0) {
        // Advance the next fire time past now so a backlog does not loop forever.
        let next = reminder.remindAt + reminder.repeatMs
        while (next <= nowMs) next += reminder.repeatMs
        await this.db.update(reminders).set({ remindAt: next }).where(eq(reminders.id, reminder.id))
      } else {
        await this.db.delete(reminders).where(eq(reminders.id, reminder.id))
      }
    }

    this.scheduleNext()
  }

  /** Look up the soonest pending reminder and arm a single timer for it. */
  private scheduleNext(): void {
    if (!this.running) return
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    void this.armSoonest()
  }

  private async armSoonest(): Promise<void> {
    if (!this.running) return
    let soonest: Reminder | undefined
    try {
      const rows = await this.db.select().from(reminders).orderBy(asc(reminders.remindAt)).limit(1)
      soonest = rows[0]
    } catch (err) {
      container.logger.error({ err }, 'utility: failed to query next reminder')
      this.armRetry()
      return
    }

    if (!soonest) return
    const delay = Math.max(0, Math.min(soonest.remindAt - Date.now(), MAX_TIMEOUT_MS))
    this.timer = setTimeout(() => void this.tick(), delay)
  }

  /** On a transient DB error, retry the scheduler shortly instead of stalling. */
  private armRetry(): void {
    if (!this.running) return
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => void this.tick(), 30_000)
  }

  /** Deliver a single reminder to its channel, or DM as a fallback. */
  private async deliver(reminder: Reminder): Promise<void> {
    const { client } = container
    const text = reminder.content

    const channel = await client.channels.fetch(reminder.channelId).catch(() => null)
    const mention = `<@${reminder.userId}>`

    if (channel && channel.isTextBased() && 'send' in channel && channel.isSendable()) {
      await channel.send({ content: `${mention}`, embeds: [reminderEmbedFor(text)] })
      return
    }

    // Fallback: DM the user when the channel is gone or not sendable.
    const user = await client.users.fetch(reminder.userId).catch(() => null)
    if (user) await user.send({ embeds: [reminderEmbedFor(text)] }).catch(() => undefined)
  }
}
