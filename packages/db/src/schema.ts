/**
 * @nd/db schema: the central data contract for nd-bot-v2 (SQLite + Drizzle).
 * All feature modules read/write through these tables. Timestamps are unix ms
 * (integer). Snowflake ids are text. Feature agents may ADD columns/tables here
 * but must not break existing ones.
 */
import { sql } from 'drizzle-orm'
import { index, integer, primaryKey, real, sqliteTable, text } from 'drizzle-orm/sqlite-core'

const now = () => sql`(unixepoch() * 1000)`

// ---- Guild config ---------------------------------------------------------

export const guildConfig = sqliteTable('guild_config', {
  guildId: text('guild_id').primaryKey(),
  locale: text('locale').notNull().default('en'),
  // JSON blob of feature toggles + channel ids + thresholds, validated in core.
  settings: text('settings', { mode: 'json' }).notNull().default('{}'),
  updatedAt: integer('updated_at').notNull().default(now()),
})

// ---- Moderation -----------------------------------------------------------

export const modCases = sqliteTable(
  'mod_cases',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    guildId: text('guild_id').notNull(),
    userId: text('user_id').notNull(),
    moderatorId: text('moderator_id').notNull(),
    action: text('action').notNull(), // warn | mute | kick | ban | timeout | unban | note
    reason: text('reason'),
    durationMs: integer('duration_ms'),
    active: integer('active', { mode: 'boolean' }).notNull().default(true),
    createdAt: integer('created_at').notNull().default(now()),
    expiresAt: integer('expires_at'),
  },
  (t) => ({ byUser: index('mod_cases_user_idx').on(t.guildId, t.userId) }),
)

export const modNotes = sqliteTable('mod_notes', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  guildId: text('guild_id').notNull(),
  userId: text('user_id').notNull(),
  authorId: text('author_id').notNull(),
  note: text('note').notNull(),
  severity: text('severity').notNull().default('info'), // info | warn | high
  createdAt: integer('created_at').notNull().default(now()),
})

// ---- Economy --------------------------------------------------------------

export const economy = sqliteTable('economy', {
  guildId: text('guild_id').notNull(),
  userId: text('user_id').notNull(),
  wallet: integer('wallet').notNull().default(0),
  bank: integer('bank').notNull().default(0),
  lastDailyAt: integer('last_daily_at'),
  lastWorkAt: integer('last_work_at'),
  lastCrimeAt: integer('last_crime_at'),
  streak: integer('streak').notNull().default(0),
}, (t) => ({ pk: primaryKey({ columns: [t.guildId, t.userId] }) }))

export const economyTx = sqliteTable(
  'economy_tx',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    guildId: text('guild_id').notNull(),
    userId: text('user_id').notNull(),
    amount: integer('amount').notNull(), // signed
    reason: text('reason').notNull(),
    createdAt: integer('created_at').notNull().default(now()),
  },
  (t) => ({ byUser: index('economy_tx_user_idx').on(t.guildId, t.userId) }),
)

export const shopItems = sqliteTable('shop_items', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  guildId: text('guild_id').notNull(),
  key: text('key').notNull(),
  name: text('name').notNull(),
  description: text('description'),
  price: integer('price').notNull(),
  roleId: text('role_id'), // optional role granted on purchase
  stock: integer('stock'), // null = unlimited
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
})

export const inventory = sqliteTable(
  'inventory',
  {
    guildId: text('guild_id').notNull(),
    userId: text('user_id').notNull(),
    itemKey: text('item_key').notNull(),
    qty: integer('qty').notNull().default(0),
  },
  (t) => ({ pk: primaryKey({ columns: [t.guildId, t.userId, t.itemKey] }) }),
)

export const quests = sqliteTable(
  'quests',
  {
    guildId: text('guild_id').notNull(),
    userId: text('user_id').notNull(),
    questKey: text('quest_key').notNull(),
    progress: integer('progress').notNull().default(0),
    target: integer('target').notNull(),
    claimed: integer('claimed', { mode: 'boolean' }).notNull().default(false),
    resetAt: integer('reset_at').notNull(),
  },
  (t) => ({ pk: primaryKey({ columns: [t.guildId, t.userId, t.questKey] }) }),
)

// ---- Levels ---------------------------------------------------------------

export const levels = sqliteTable(
  'levels',
  {
    guildId: text('guild_id').notNull(),
    userId: text('user_id').notNull(),
    xp: integer('xp').notNull().default(0),
    level: integer('level').notNull().default(0),
    messages: integer('messages').notNull().default(0),
    lastMessageAt: integer('last_message_at'),
  },
  (t) => ({ pk: primaryKey({ columns: [t.guildId, t.userId] }), byXp: index('levels_xp_idx').on(t.guildId, t.xp) }),
)

export const levelRoles = sqliteTable(
  'level_roles',
  {
    guildId: text('guild_id').notNull(),
    level: integer('level').notNull(),
    roleId: text('role_id').notNull(),
  },
  (t) => ({ pk: primaryKey({ columns: [t.guildId, t.level] }) }),
)

// ---- Tickets --------------------------------------------------------------

export const tickets = sqliteTable(
  'tickets',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    guildId: text('guild_id').notNull(),
    channelId: text('channel_id').notNull(),
    userId: text('user_id').notNull(),
    category: text('category'),
    status: text('status').notNull().default('open'), // open | claimed | closed
    claimedBy: text('claimed_by'),
    priority: text('priority'),
    subject: text('subject'),
    createdAt: integer('created_at').notNull().default(now()),
    closedAt: integer('closed_at'),
    closedBy: text('closed_by'),
  },
  (t) => ({ byUser: index('tickets_user_idx').on(t.guildId, t.userId) }),
)

export const ticketMessages = sqliteTable('ticket_messages', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  ticketId: integer('ticket_id').notNull(),
  authorId: text('author_id').notNull(),
  content: text('content').notNull(),
  createdAt: integer('created_at').notNull().default(now()),
})

// ---- Community ------------------------------------------------------------

export const polls = sqliteTable('polls', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  guildId: text('guild_id').notNull(),
  channelId: text('channel_id').notNull(),
  messageId: text('message_id').notNull(),
  question: text('question').notNull(),
  options: text('options', { mode: 'json' }).notNull(), // string[]
  endsAt: integer('ends_at'),
  closed: integer('closed', { mode: 'boolean' }).notNull().default(false),
})

export const giveaways = sqliteTable('giveaways', {
  id: text('id').primaryKey(),
  guildId: text('guild_id').notNull(),
  channelId: text('channel_id').notNull(),
  messageId: text('message_id').notNull(),
  prize: text('prize').notNull(),
  winnerCount: integer('winner_count').notNull().default(1),
  hostId: text('host_id').notNull(),
  endsAt: integer('ends_at').notNull(),
  ended: integer('ended', { mode: 'boolean' }).notNull().default(false),
})

export const suggestions = sqliteTable('suggestions', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  guildId: text('guild_id').notNull(),
  userId: text('user_id').notNull(),
  content: text('content').notNull(),
  status: text('status').notNull().default('open'), // open | approved | denied
  messageId: text('message_id'),
  createdAt: integer('created_at').notNull().default(now()),
})

export const counters = sqliteTable(
  'counters',
  {
    guildId: text('guild_id').notNull(),
    channelId: text('channel_id').notNull(),
    kind: text('kind').notNull(), // members | online | boosters | custom
    template: text('template').notNull(),
  },
  (t) => ({ pk: primaryKey({ columns: [t.guildId, t.channelId] }) }),
)

// ---- Utility --------------------------------------------------------------

export const reminders = sqliteTable('reminders', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  guildId: text('guild_id'),
  channelId: text('channel_id').notNull(),
  userId: text('user_id').notNull(),
  content: text('content').notNull(),
  remindAt: integer('remind_at').notNull(),
  repeatMs: integer('repeat_ms'),
})

export const reactionRoles = sqliteTable('reaction_roles', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  guildId: text('guild_id').notNull(),
  messageId: text('message_id').notNull(),
  emoji: text('emoji').notNull(),
  roleId: text('role_id').notNull(),
})

// ---- Automation -----------------------------------------------------------

export const automationRules = sqliteTable('automation_rules', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  guildId: text('guild_id').notNull(),
  name: text('name').notNull(),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  trigger: text('trigger', { mode: 'json' }).notNull(), // { type, params }
  conditions: text('conditions', { mode: 'json' }).notNull().default('[]'),
  actions: text('actions', { mode: 'json' }).notNull(), // [{ type, params }]
  createdAt: integer('created_at').notNull().default(now()),
})

// ---- AI -------------------------------------------------------------------

export const aiMemory = sqliteTable(
  'ai_memory',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    guildId: text('guild_id'),
    userId: text('user_id').notNull(),
    role: text('role').notNull(), // user | model
    content: text('content').notNull(),
    createdAt: integer('created_at').notNull().default(now()),
  },
  (t) => ({ byUser: index('ai_memory_user_idx').on(t.userId) }),
)

export const aiTelemetry = sqliteTable('ai_telemetry', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  provider: text('provider').notNull(),
  model: text('model').notNull(),
  intent: text('intent'),
  inputTokens: integer('input_tokens'),
  outputTokens: integer('output_tokens'),
  latencyMs: integer('latency_ms'),
  cached: integer('cached', { mode: 'boolean' }).notNull().default(false),
  ok: integer('ok', { mode: 'boolean' }).notNull().default(true),
  createdAt: integer('created_at').notNull().default(now()),
})

export const knowledgeDocs = sqliteTable('knowledge_docs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  source: text('source').notNull(), // rules | faq | fivem | store | custom
  title: text('title').notNull(),
  content: text('content').notNull(),
  embedding: text('embedding', { mode: 'json' }), // number[] | null
  updatedAt: integer('updated_at').notNull().default(now()),
})

// ---- Dashboard / audit ----------------------------------------------------

export const auditLog = sqliteTable(
  'audit_log',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    actorId: text('actor_id').notNull(), // dashboard user / discord id
    action: text('action').notNull(),
    target: text('target'),
    details: text('details', { mode: 'json' }),
    ip: text('ip'),
    createdAt: integer('created_at').notNull().default(now()),
  },
  (t) => ({ byTime: index('audit_log_time_idx').on(t.createdAt) }),
)

export const analyticsEvents = sqliteTable(
  'analytics_events',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    guildId: text('guild_id'),
    type: text('type').notNull(), // message | command | join | leave | ai | mod
    userId: text('user_id'),
    channelId: text('channel_id'),
    meta: text('meta', { mode: 'json' }),
    createdAt: integer('created_at').notNull().default(now()),
  },
  (t) => ({ byType: index('analytics_type_idx').on(t.type, t.createdAt) }),
)
