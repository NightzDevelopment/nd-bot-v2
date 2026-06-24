# nd-bot-v2 Build Plan

Ground-up rebuild of the Nightz Development Discord bot. Replaces v1 (reuses v1's
bot token, takes over `bot.nightz.dev`). Fresh data, no migration.

## Stack

- Runtime: **Bun** (>= 1.1). Language: strict **TypeScript**.
- Bot: **discord.js v14** + **@sapphire/framework** (commands, listeners, preconditions, args).
- DB: **SQLite** via **Drizzle ORM** (`packages/db`), migrations checked in.
- AI: **Gemini + Claude** multi-provider with routing, fallback, cache, telemetry (`packages/ai`);
  agentic loop with tools + per-user memory + RAG.
- Dashboard: **React + Vite + Tailwind + shadcn/ui** SPA (`apps/web`), real-time via WebSocket.
- i18n: **EN / ES / FR** (`packages/i18n`).
- Deploy: VPS, `screen` + **NGINX**, `bot.nightz.dev`.

## Monorepo layout (Bun workspaces)

```
apps/
  bot/    Sapphire bot. Also hosts the HTTP + WebSocket API for the dashboard.
  web/    React SPA dashboard.
packages/
  core/   env/config (zod-validated), logger (pino), constants, Result helpers.
  db/     Drizzle schema (all feature tables) + client + migrations. CENTRAL CONTRACT.
  ai/     provider clients, router, cache, telemetry, agent loop, tools, RAG.
  i18n/   locale catalogs (en/es/fr) + t() helper.
```

## Brand: "Sentinel" design system (dashboard)

Use exactly. Intentional technical/HUD aesthetic, not generic.

- Background `#0D1117`. Panel `#111827`. Hover `#1C2E45`. Border `#1E2A3A` (radius **4px**, sharp).
- Primary accent `#3178C6` (ND blue). Secondary accent `#00FF88` (neon green = active/online ONLY).
- Text `#FFFFFF` / secondary `#A0ADB8`. Alert `#FF4444`. Caution `#FFA500`.
- Font **Share Tech Mono** (monospace throughout). **No gradients.** Minimal padding.

## Feature modules (bot)

1. moderation: warn/mute/kick/ban/timeout, mod-notes, case log, audit log channel.
2. automod: word/link/invite/spam filters, raid detection, name/avatar quarantine scanning.
3. tickets: open/claim/close, transcripts, categories, AI triage + suggested replies.
4. ai-support: agentic assistant (tools + memory + RAG), FAQ, knowledge base.
5. economy: balance/wallet/bank, shop, gambling/casino, daily, work/crime, quests.
6. levels: XP, level-up, level roles, leaderboards.
7. community: polls, giveaways (with restart-safe resume), suggestions, counters.
8. utility: reminders, reaction roles, welcome/goodbye, serverinfo/userinfo, scheduler.
9. automation: trigger -> condition -> action rules, auto-responders, scheduled jobs.

## Dashboard sections (web)

Overview, Moderation, Tickets, AI/Knowledge, Economy, Levels, Community, Automation,
Analytics, Members, Config, Audit log. Real-time via WS. Discord OAuth login + role gating.

## Agentic AI

Multi-provider (Gemini default, Claude for hard tasks), fallback + cache + telemetry.
Agent tools: lookup member (warnings/tickets/economy/level), search knowledge base,
take mod action (gated), open ticket. RAG corpus: server rules + FAQ + policies,
FiveM/Lua scripting, store/product catalog. Per-user conversation memory.

## Build phases

0. Scaffold: monorepo, tooling, package skeletons, db schema (the contract). [foundation]
1. Shared packages: core, db (schema + client + migrations), ai layer, i18n. [parallel]
2. Bot core: Sapphire bootstrap, client, config wiring, base listeners + health.
3. Feature modules: one or more agents per module, building against db + core + ai. [parallel, large fan-out]
4. Dashboard: Vite/Tailwind/shadcn shell + Sentinel theme, then one agent per section. [parallel]
5. API + WebSocket: REST endpoints + WS events bridging bot/db <-> dashboard.
6. Deploy + integrate: NGINX conf, screen run/update scripts, end-to-end verify.

## Conventions

- No emojis or dashes in user-facing output (Discord + dashboard). Functional reaction
  emojis are defined as `\u` escapes and are allowed where required.
- Every package exports through `src/index.ts`. Imports use the workspace name
  (`@nd/core`, `@nd/db`, `@nd/ai`, `@nd/i18n`).
- All DB access goes through `packages/db`. No raw SQL strings with interpolated identifiers.
- Secrets only via env. `.env*` is gitignored.
