CREATE TABLE `ai_memory` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`guild_id` text,
	`user_id` text NOT NULL,
	`role` text NOT NULL,
	`content` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `ai_memory_user_idx` ON `ai_memory` (`user_id`);--> statement-breakpoint
CREATE TABLE `ai_telemetry` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`provider` text NOT NULL,
	`model` text NOT NULL,
	`intent` text,
	`input_tokens` integer,
	`output_tokens` integer,
	`latency_ms` integer,
	`cached` integer DEFAULT false NOT NULL,
	`ok` integer DEFAULT true NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `analytics_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`guild_id` text,
	`type` text NOT NULL,
	`user_id` text,
	`channel_id` text,
	`meta` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `analytics_type_idx` ON `analytics_events` (`type`,`created_at`);--> statement-breakpoint
CREATE TABLE `audit_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`actor_id` text NOT NULL,
	`action` text NOT NULL,
	`target` text,
	`details` text,
	`ip` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `audit_log_time_idx` ON `audit_log` (`created_at`);--> statement-breakpoint
CREATE TABLE `automation_rules` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`guild_id` text NOT NULL,
	`name` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`trigger` text NOT NULL,
	`conditions` text DEFAULT '[]' NOT NULL,
	`actions` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `counters` (
	`guild_id` text NOT NULL,
	`channel_id` text NOT NULL,
	`kind` text NOT NULL,
	`template` text NOT NULL,
	PRIMARY KEY(`guild_id`, `channel_id`)
);
--> statement-breakpoint
CREATE TABLE `economy` (
	`guild_id` text NOT NULL,
	`user_id` text NOT NULL,
	`wallet` integer DEFAULT 0 NOT NULL,
	`bank` integer DEFAULT 0 NOT NULL,
	`last_daily_at` integer,
	`last_work_at` integer,
	`last_crime_at` integer,
	`streak` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`guild_id`, `user_id`)
);
--> statement-breakpoint
CREATE TABLE `economy_tx` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`guild_id` text NOT NULL,
	`user_id` text NOT NULL,
	`amount` integer NOT NULL,
	`reason` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `economy_tx_user_idx` ON `economy_tx` (`guild_id`,`user_id`);--> statement-breakpoint
CREATE TABLE `giveaways` (
	`id` text PRIMARY KEY NOT NULL,
	`guild_id` text NOT NULL,
	`channel_id` text NOT NULL,
	`message_id` text NOT NULL,
	`prize` text NOT NULL,
	`winner_count` integer DEFAULT 1 NOT NULL,
	`host_id` text NOT NULL,
	`ends_at` integer NOT NULL,
	`ended` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE `guild_config` (
	`guild_id` text PRIMARY KEY NOT NULL,
	`locale` text DEFAULT 'en' NOT NULL,
	`settings` text DEFAULT '{}' NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `inventory` (
	`guild_id` text NOT NULL,
	`user_id` text NOT NULL,
	`item_key` text NOT NULL,
	`qty` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`guild_id`, `user_id`, `item_key`)
);
--> statement-breakpoint
CREATE TABLE `knowledge_docs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`source` text NOT NULL,
	`title` text NOT NULL,
	`content` text NOT NULL,
	`embedding` text,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `level_roles` (
	`guild_id` text NOT NULL,
	`level` integer NOT NULL,
	`role_id` text NOT NULL,
	PRIMARY KEY(`guild_id`, `level`)
);
--> statement-breakpoint
CREATE TABLE `levels` (
	`guild_id` text NOT NULL,
	`user_id` text NOT NULL,
	`xp` integer DEFAULT 0 NOT NULL,
	`level` integer DEFAULT 0 NOT NULL,
	`messages` integer DEFAULT 0 NOT NULL,
	`last_message_at` integer,
	PRIMARY KEY(`guild_id`, `user_id`)
);
--> statement-breakpoint
CREATE INDEX `levels_xp_idx` ON `levels` (`guild_id`,`xp`);--> statement-breakpoint
CREATE TABLE `mod_cases` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`guild_id` text NOT NULL,
	`user_id` text NOT NULL,
	`moderator_id` text NOT NULL,
	`action` text NOT NULL,
	`reason` text,
	`duration_ms` integer,
	`active` integer DEFAULT true NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`expires_at` integer
);
--> statement-breakpoint
CREATE INDEX `mod_cases_user_idx` ON `mod_cases` (`guild_id`,`user_id`);--> statement-breakpoint
CREATE TABLE `mod_notes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`guild_id` text NOT NULL,
	`user_id` text NOT NULL,
	`author_id` text NOT NULL,
	`note` text NOT NULL,
	`severity` text DEFAULT 'info' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `polls` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`guild_id` text NOT NULL,
	`channel_id` text NOT NULL,
	`message_id` text NOT NULL,
	`question` text NOT NULL,
	`options` text NOT NULL,
	`ends_at` integer,
	`closed` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE `quests` (
	`guild_id` text NOT NULL,
	`user_id` text NOT NULL,
	`quest_key` text NOT NULL,
	`progress` integer DEFAULT 0 NOT NULL,
	`target` integer NOT NULL,
	`claimed` integer DEFAULT false NOT NULL,
	`reset_at` integer NOT NULL,
	PRIMARY KEY(`guild_id`, `user_id`, `quest_key`)
);
--> statement-breakpoint
CREATE TABLE `reaction_roles` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`guild_id` text NOT NULL,
	`message_id` text NOT NULL,
	`emoji` text NOT NULL,
	`role_id` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `reminders` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`guild_id` text,
	`channel_id` text NOT NULL,
	`user_id` text NOT NULL,
	`content` text NOT NULL,
	`remind_at` integer NOT NULL,
	`repeat_ms` integer
);
--> statement-breakpoint
CREATE TABLE `shop_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`guild_id` text NOT NULL,
	`key` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`price` integer NOT NULL,
	`role_id` text,
	`stock` integer,
	`enabled` integer DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE `suggestions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`guild_id` text NOT NULL,
	`user_id` text NOT NULL,
	`content` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`message_id` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `ticket_messages` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`ticket_id` integer NOT NULL,
	`author_id` text NOT NULL,
	`content` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `tickets` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`guild_id` text NOT NULL,
	`channel_id` text NOT NULL,
	`user_id` text NOT NULL,
	`category` text,
	`status` text DEFAULT 'open' NOT NULL,
	`claimed_by` text,
	`priority` text,
	`subject` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`closed_at` integer,
	`closed_by` text
);
--> statement-breakpoint
CREATE INDEX `tickets_user_idx` ON `tickets` (`guild_id`,`user_id`);