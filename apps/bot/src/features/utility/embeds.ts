/**
 * Embed builders specific to the utility feature. All go through the shared
 * brand helpers so styling stays consistent. No emojis, no dashes.
 */
import type { EmbedBuilder } from 'discord.js'
import { brandEmbed } from '../../lib/embed.ts'

/** The embed delivered when a reminder fires. */
export function reminderEmbedFor(content: string): EmbedBuilder {
  return brandEmbed({ tone: 'primary', title: 'Reminder', description: content })
}
