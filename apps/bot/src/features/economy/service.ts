/**
 * Economy service: the single source of truth for all currency math.
 *
 * Every balance change is atomic at the SQL level (UPDATE wallet = wallet + ?)
 * and writes a paired row into `economy_tx` so the dashboard and any audit view
 * can replay history. Commands never touch the DB directly; they go through here
 * so cooldowns, clamping, and transaction logging stay consistent.
 */
import { and, desc, eq, gt, sql } from 'drizzle-orm'
import { economy, economyTx, getDb, inventory, shopItems } from '@nd/db'
import type { DB } from '@nd/db'
import { container } from '@sapphire/framework'

// ---- Tunables (local defaults; mirror into settings.thresholds later) -------

/**
 * Economy defaults. These live here until the corresponding fields are added to
 * the shared config schema (see this feature's result for the requested keys).
 * Cooldowns are in milliseconds.
 */
export const ECONOMY_DEFAULTS = {
  dailyAmount: 250,
  dailyStreakBonus: 25, // added per consecutive day, capped by streakBonusMax
  streakBonusMax: 500,
  dailyCooldownMs: 22 * 60 * 60 * 1000, // claimable a little early to be forgiving
  streakGraceMs: 48 * 60 * 60 * 1000, // miss beyond this and the streak resets
  workCooldownMs: 60 * 60 * 1000,
  workMin: 50,
  workMax: 300,
  crimeCooldownMs: 90 * 60 * 1000,
  crimeMin: 100,
  crimeMax: 600,
  crimeSuccessChance: 0.55,
  crimeFineMin: 50,
  crimeFineMax: 400,
  sellRefundPct: 0.5, // sell items back for half the shop price
  leaderboardSize: 10,
} as const

export type EconomyAction =
  | 'daily'
  | 'work'
  | 'crime'
  | 'pay'
  | 'deposit'
  | 'withdraw'
  | 'buy'
  | 'sell'
  | 'admin'

export interface EconomyAccount {
  guildId: string
  userId: string
  wallet: number
  bank: number
  lastDailyAt: number | null
  lastWorkAt: number | null
  lastCrimeAt: number | null
  streak: number
}

export interface ShopItem {
  id: number
  guildId: string
  key: string
  name: string
  description: string | null
  price: number
  roleId: string | null
  stock: number | null
  enabled: boolean
}

export interface InventoryEntry {
  itemKey: string
  qty: number
}

/** Result of a mutating operation, carrying the post-change balances for embeds. */
export interface MutationResult {
  wallet: number
  bank: number
}

function clampInt(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(value)))
}

/** Broadcast an economy event to dashboard subscribers, guarding the optional hub. */
function broadcast(event: string, data: unknown): void {
  container.api?.hub.broadcast('economy', event, data)
}

export class EconomyService {
  private readonly db: DB

  constructor(db: DB = getDb()) {
    this.db = db
  }

  // ---- Accounts -----------------------------------------------------------

  /** Read an account, creating a zeroed row on first touch so callers always get one. */
  async account(guildId: string, userId: string): Promise<EconomyAccount> {
    const rows = await this.db
      .select()
      .from(economy)
      .where(and(eq(economy.guildId, guildId), eq(economy.userId, userId)))
      .limit(1)

    const row = rows[0]
    if (row) return row as EconomyAccount

    await this.db
      .insert(economy)
      .values({ guildId, userId })
      .onConflictDoNothing()

    return {
      guildId,
      userId,
      wallet: 0,
      bank: 0,
      lastDailyAt: null,
      lastWorkAt: null,
      lastCrimeAt: null,
      streak: 0,
    }
  }

  /**
   * Apply a signed delta to the wallet atomically and log a transaction row.
   * Ensures the account row exists first so the UPDATE always hits.
   */
  private async adjustWallet(
    guildId: string,
    userId: string,
    delta: number,
    reason: string,
  ): Promise<void> {
    await this.account(guildId, userId)
    await this.db
      .update(economy)
      .set({ wallet: sql`${economy.wallet} + ${delta}` })
      .where(and(eq(economy.guildId, guildId), eq(economy.userId, userId)))
    await this.logTx(guildId, userId, delta, reason)
  }

  private async logTx(guildId: string, userId: string, amount: number, reason: string): Promise<void> {
    await this.db.insert(economyTx).values({ guildId, userId, amount, reason })
  }

  // ---- Daily --------------------------------------------------------------

  /**
   * Claim the daily reward. Returns either the awarded amount + streak, or the
   * milliseconds remaining on cooldown. Streak increments when claimed within
   * the grace window and resets otherwise.
   */
  async daily(
    guildId: string,
    userId: string,
  ): Promise<
    | { ok: true; amount: number; streak: number; wallet: number }
    | { ok: false; retryInMs: number }
  > {
    const acct = await this.account(guildId, userId)
    const now = Date.now()
    const last = acct.lastDailyAt ?? 0
    const sinceLast = now - last

    if (last !== 0 && sinceLast < ECONOMY_DEFAULTS.dailyCooldownMs) {
      return { ok: false, retryInMs: ECONOMY_DEFAULTS.dailyCooldownMs - sinceLast }
    }

    const continued = last !== 0 && sinceLast <= ECONOMY_DEFAULTS.streakGraceMs
    const streak = continued ? acct.streak + 1 : 1
    const bonus = Math.min(
      streak * ECONOMY_DEFAULTS.dailyStreakBonus,
      ECONOMY_DEFAULTS.streakBonusMax,
    )
    const amount = ECONOMY_DEFAULTS.dailyAmount + bonus

    await this.db
      .update(economy)
      .set({ wallet: sql`${economy.wallet} + ${amount}`, lastDailyAt: now, streak })
      .where(and(eq(economy.guildId, guildId), eq(economy.userId, userId)))
    await this.logTx(guildId, userId, amount, 'daily')

    const wallet = acct.wallet + amount
    broadcast('balance_changed', { guildId, userId, wallet, delta: amount, reason: 'daily' })
    return { ok: true, amount, streak, wallet }
  }

  // ---- Work ---------------------------------------------------------------

  async work(
    guildId: string,
    userId: string,
  ): Promise<
    { ok: true; amount: number; wallet: number } | { ok: false; retryInMs: number }
  > {
    const acct = await this.account(guildId, userId)
    const now = Date.now()
    const last = acct.lastWorkAt ?? 0
    const sinceLast = now - last

    if (last !== 0 && sinceLast < ECONOMY_DEFAULTS.workCooldownMs) {
      return { ok: false, retryInMs: ECONOMY_DEFAULTS.workCooldownMs - sinceLast }
    }

    const amount = clampInt(
      ECONOMY_DEFAULTS.workMin +
        Math.random() * (ECONOMY_DEFAULTS.workMax - ECONOMY_DEFAULTS.workMin),
      ECONOMY_DEFAULTS.workMin,
      ECONOMY_DEFAULTS.workMax,
    )

    await this.db
      .update(economy)
      .set({ wallet: sql`${economy.wallet} + ${amount}`, lastWorkAt: now })
      .where(and(eq(economy.guildId, guildId), eq(economy.userId, userId)))
    await this.logTx(guildId, userId, amount, 'work')

    const wallet = acct.wallet + amount
    broadcast('balance_changed', { guildId, userId, wallet, delta: amount, reason: 'work' })
    return { ok: true, amount, wallet }
  }

  // ---- Crime --------------------------------------------------------------

  /**
   * Risk/reward. On success the user gains a clamped reward. On failure they pay
   * a fine, but the fine is clamped so it never exceeds what they actually hold
   * (you can never lose more than your wallet).
   */
  async crime(
    guildId: string,
    userId: string,
  ): Promise<
    | { ok: true; success: boolean; amount: number; wallet: number }
    | { ok: false; retryInMs: number }
  > {
    const acct = await this.account(guildId, userId)
    const now = Date.now()
    const last = acct.lastCrimeAt ?? 0
    const sinceLast = now - last

    if (last !== 0 && sinceLast < ECONOMY_DEFAULTS.crimeCooldownMs) {
      return { ok: false, retryInMs: ECONOMY_DEFAULTS.crimeCooldownMs - sinceLast }
    }

    const success = Math.random() < ECONOMY_DEFAULTS.crimeSuccessChance
    let delta: number
    if (success) {
      delta = clampInt(
        ECONOMY_DEFAULTS.crimeMin +
          Math.random() * (ECONOMY_DEFAULTS.crimeMax - ECONOMY_DEFAULTS.crimeMin),
        ECONOMY_DEFAULTS.crimeMin,
        ECONOMY_DEFAULTS.crimeMax,
      )
    } else {
      const fine = clampInt(
        ECONOMY_DEFAULTS.crimeFineMin +
          Math.random() * (ECONOMY_DEFAULTS.crimeFineMax - ECONOMY_DEFAULTS.crimeFineMin),
        ECONOMY_DEFAULTS.crimeFineMin,
        ECONOMY_DEFAULTS.crimeFineMax,
      )
      // Never take more than the wallet currently holds.
      delta = -Math.min(fine, acct.wallet)
    }

    await this.db
      .update(economy)
      .set({ wallet: sql`${economy.wallet} + ${delta}`, lastCrimeAt: now })
      .where(and(eq(economy.guildId, guildId), eq(economy.userId, userId)))
    await this.logTx(guildId, userId, delta, success ? 'crime_success' : 'crime_fail')

    const wallet = acct.wallet + delta
    broadcast('balance_changed', { guildId, userId, wallet, delta, reason: 'crime' })
    return { ok: true, success, amount: Math.abs(delta), wallet }
  }

  // ---- Transfers ----------------------------------------------------------

  /** Move funds from one wallet to another. Validates the sender can afford it. */
  async pay(
    guildId: string,
    fromUserId: string,
    toUserId: string,
    amount: number,
  ): Promise<{ ok: true; fromWallet: number } | { ok: false; shortBy: number }> {
    const sender = await this.account(guildId, fromUserId)
    if (sender.wallet < amount) {
      return { ok: false, shortBy: amount - sender.wallet }
    }
    await this.account(guildId, toUserId)

    await this.adjustWallet(guildId, fromUserId, -amount, `pay to ${toUserId}`)
    await this.adjustWallet(guildId, toUserId, amount, `pay from ${fromUserId}`)

    const fromWallet = sender.wallet - amount
    broadcast('balance_changed', { guildId, userId: fromUserId, wallet: fromWallet, delta: -amount, reason: 'pay' })
    broadcast('balance_changed', { guildId, userId: toUserId, delta: amount, reason: 'pay' })
    return { ok: true, fromWallet }
  }

  /** Move funds wallet -> bank atomically. `amount === null` means deposit all. */
  async deposit(
    guildId: string,
    userId: string,
    amount: number | null,
  ): Promise<{ ok: true; moved: number; wallet: number; bank: number } | { ok: false }> {
    const acct = await this.account(guildId, userId)
    const moved = amount === null ? acct.wallet : amount
    if (moved <= 0 || moved > acct.wallet) return { ok: false }

    await this.db
      .update(economy)
      .set({ wallet: sql`${economy.wallet} - ${moved}`, bank: sql`${economy.bank} + ${moved}` })
      .where(and(eq(economy.guildId, guildId), eq(economy.userId, userId)))
    await this.logTx(guildId, userId, 0, `deposit ${moved}`)

    const wallet = acct.wallet - moved
    const bank = acct.bank + moved
    broadcast('balance_changed', { guildId, userId, wallet, bank, delta: 0, reason: 'deposit' })
    return { ok: true, moved, wallet, bank }
  }

  /** Move funds bank -> wallet atomically. `amount === null` means withdraw all. */
  async withdraw(
    guildId: string,
    userId: string,
    amount: number | null,
  ): Promise<{ ok: true; moved: number; wallet: number; bank: number } | { ok: false }> {
    const acct = await this.account(guildId, userId)
    const moved = amount === null ? acct.bank : amount
    if (moved <= 0 || moved > acct.bank) return { ok: false }

    await this.db
      .update(economy)
      .set({ wallet: sql`${economy.wallet} + ${moved}`, bank: sql`${economy.bank} - ${moved}` })
      .where(and(eq(economy.guildId, guildId), eq(economy.userId, userId)))
    await this.logTx(guildId, userId, 0, `withdraw ${moved}`)

    const wallet = acct.wallet + moved
    const bank = acct.bank - moved
    broadcast('balance_changed', { guildId, userId, wallet, bank, delta: 0, reason: 'withdraw' })
    return { ok: true, moved, wallet, bank }
  }

  // ---- Leaderboard --------------------------------------------------------

  /** Top accounts by total net worth (wallet + bank). */
  async leaderboard(
    guildId: string,
    limit: number = ECONOMY_DEFAULTS.leaderboardSize,
  ): Promise<Array<{ userId: string; wallet: number; bank: number; total: number }>> {
    const total = sql<number>`${economy.wallet} + ${economy.bank}`
    const rows = await this.db
      .select({ userId: economy.userId, wallet: economy.wallet, bank: economy.bank, total })
      .from(economy)
      .where(and(eq(economy.guildId, guildId), gt(total, 0)))
      .orderBy(desc(total))
      .limit(limit)
    return rows.map((r) => ({ userId: r.userId, wallet: r.wallet, bank: r.bank, total: Number(r.total) }))
  }

  // ---- Shop + inventory ---------------------------------------------------

  /** All enabled shop items for a guild, cheapest first. */
  async listShop(guildId: string): Promise<ShopItem[]> {
    const rows = await this.db
      .select()
      .from(shopItems)
      .where(and(eq(shopItems.guildId, guildId), eq(shopItems.enabled, true)))
      .orderBy(shopItems.price)
    return rows as ShopItem[]
  }

  /** Find a single enabled shop item by its key (case-insensitive on the key). */
  async findItem(guildId: string, key: string): Promise<ShopItem | null> {
    const rows = await this.db
      .select()
      .from(shopItems)
      .where(
        and(
          eq(shopItems.guildId, guildId),
          eq(shopItems.key, key),
          eq(shopItems.enabled, true),
        ),
      )
      .limit(1)
    return (rows[0] as ShopItem | undefined) ?? null
  }

  async inventory(guildId: string, userId: string): Promise<InventoryEntry[]> {
    const rows = await this.db
      .select({ itemKey: inventory.itemKey, qty: inventory.qty })
      .from(inventory)
      .where(and(eq(inventory.guildId, guildId), eq(inventory.userId, userId), gt(inventory.qty, 0)))
    return rows
  }

  private async inventoryQty(guildId: string, userId: string, itemKey: string): Promise<number> {
    const rows = await this.db
      .select({ qty: inventory.qty })
      .from(inventory)
      .where(
        and(
          eq(inventory.guildId, guildId),
          eq(inventory.userId, userId),
          eq(inventory.itemKey, itemKey),
        ),
      )
      .limit(1)
    return rows[0]?.qty ?? 0
  }

  /**
   * Buy `qty` of an item. Validates funds and stock, charges the wallet, grants
   * inventory, and decrements stock when the item is limited. All steps are
   * sequenced so a failed precheck never mutates state.
   */
  async buy(
    guildId: string,
    userId: string,
    item: ShopItem,
    qty: number,
  ): Promise<
    | { ok: true; spent: number; wallet: number }
    | { ok: false; reason: 'funds' | 'stock'; shortBy?: number }
  > {
    const count = Math.max(1, Math.floor(qty))
    const cost = item.price * count

    const acct = await this.account(guildId, userId)
    if (acct.wallet < cost) {
      return { ok: false, reason: 'funds', shortBy: cost - acct.wallet }
    }
    if (item.stock !== null && item.stock < count) {
      return { ok: false, reason: 'stock' }
    }

    await this.adjustWallet(guildId, userId, -cost, `buy ${count}x ${item.key}`)

    await this.db
      .insert(inventory)
      .values({ guildId, userId, itemKey: item.key, qty: count })
      .onConflictDoUpdate({
        target: [inventory.guildId, inventory.userId, inventory.itemKey],
        set: { qty: sql`${inventory.qty} + ${count}` },
      })

    if (item.stock !== null) {
      await this.db
        .update(shopItems)
        .set({ stock: sql`${shopItems.stock} - ${count}` })
        .where(eq(shopItems.id, item.id))
    }

    const wallet = acct.wallet - cost
    broadcast('shop_purchase', { guildId, userId, itemKey: item.key, qty: count, spent: cost, wallet })
    return { ok: true, spent: cost, wallet }
  }

  /**
   * Sell `qty` of an owned item back for a fraction of its shop price. Validates
   * the user owns enough, refunds the wallet, decrements inventory, and returns
   * any limited stock to the shop.
   */
  async sell(
    guildId: string,
    userId: string,
    item: ShopItem,
    qty: number,
  ): Promise<
    | { ok: true; refund: number; wallet: number }
    | { ok: false; reason: 'owned'; owned: number }
  > {
    const count = Math.max(1, Math.floor(qty))
    const owned = await this.inventoryQty(guildId, userId, item.key)
    if (owned < count) {
      return { ok: false, reason: 'owned', owned }
    }

    const refund = Math.max(0, Math.floor(item.price * count * ECONOMY_DEFAULTS.sellRefundPct))

    await this.db
      .update(inventory)
      .set({ qty: sql`${inventory.qty} - ${count}` })
      .where(
        and(
          eq(inventory.guildId, guildId),
          eq(inventory.userId, userId),
          eq(inventory.itemKey, item.key),
        ),
      )

    await this.adjustWallet(guildId, userId, refund, `sell ${count}x ${item.key}`)

    if (item.stock !== null) {
      await this.db
        .update(shopItems)
        .set({ stock: sql`${shopItems.stock} + ${count}` })
        .where(eq(shopItems.id, item.id))
    }

    const acct = await this.account(guildId, userId)
    broadcast('shop_sale', { guildId, userId, itemKey: item.key, qty: count, refund, wallet: acct.wallet })
    return { ok: true, refund, wallet: acct.wallet }
  }

  // ---- Admin / API helpers ------------------------------------------------

  /** Direct signed adjustment used by dashboard tooling. Logs a tx as `admin`. */
  async adminAdjust(
    guildId: string,
    userId: string,
    delta: number,
    reason = 'admin',
  ): Promise<MutationResult> {
    await this.adjustWallet(guildId, userId, delta, reason)
    const acct = await this.account(guildId, userId)
    broadcast('balance_changed', { guildId, userId, wallet: acct.wallet, delta, reason: 'admin' })
    return { wallet: acct.wallet, bank: acct.bank }
  }

  /** Recent transactions for a user, newest first. */
  async transactions(
    guildId: string,
    userId: string,
    limit = 25,
  ): Promise<Array<{ id: number; amount: number; reason: string; createdAt: number }>> {
    const rows = await this.db
      .select({
        id: economyTx.id,
        amount: economyTx.amount,
        reason: economyTx.reason,
        createdAt: economyTx.createdAt,
      })
      .from(economyTx)
      .where(and(eq(economyTx.guildId, guildId), eq(economyTx.userId, userId)))
      .orderBy(desc(economyTx.createdAt))
      .limit(limit)
    return rows
  }
}
