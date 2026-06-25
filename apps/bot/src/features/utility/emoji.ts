/**
 * Emoji normalization shared by the reaction role command and listeners.
 *
 * Reaction roles must match a stored key against a live reaction. Discord's
 * `MessageReaction` exposes a custom emoji by its snowflake id and a unicode
 * emoji by its raw character(s). We normalize both inputs to the same key:
 *   - custom emoji `<:name:1234>` or `<a:name:1234>` -> the id `1234`
 *   - a bare snowflake `1234` -> `1234`
 *   - unicode emoji -> the emoji character(s) unchanged
 */
import type { GuildEmoji, ReactionEmoji, ApplicationEmoji } from 'discord.js'

const CUSTOM = /^<a?:[a-zA-Z0-9_]+:(\d+)>$/
const SNOWFLAKE = /^\d{15,21}$/
// Match at least one emoji-presentation or pictographic code point.
const UNICODE_EMOJI = /\p{Extended_Pictographic}/u

/**
 * Normalize a user supplied emoji string to its stored key, or null when the
 * input is neither a custom emoji tag, a snowflake, nor a unicode emoji.
 */
export function resolveEmojiKey(input: string): string | null {
  const trimmed = input.trim()
  if (trimmed.length === 0) return null

  const custom = CUSTOM.exec(trimmed)
  if (custom?.[1]) return custom[1]
  if (SNOWFLAKE.test(trimmed)) return trimmed
  if (UNICODE_EMOJI.test(trimmed)) return trimmed

  return null
}

/** Derive the stored key from a live reaction emoji (custom id or unicode name). */
export function reactionEmojiKey(emoji: GuildEmoji | ReactionEmoji | ApplicationEmoji): string {
  return emoji.id ?? emoji.name ?? ''
}
