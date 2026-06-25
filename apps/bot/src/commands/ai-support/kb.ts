/**
 * `/kb` command: manage the AI knowledge base (knowledge_docs).
 *
 * Subcommands:
 *   - add <source> <title> <content>: insert a knowledge document.
 *   - list [source]: list stored documents, optionally filtered by source.
 *   - remove <id>: delete a document by id.
 *
 * Knowledge documents power RAG for the support assistant. This command is
 * staff facing; it gates on the configured admin or mod roles. Single chat input
 * command with native subcommands (no subcommands plugin dependency). Also
 * supports a prefixed message form: `kb add|list|remove ...`.
 */
import { type Args, Command, container } from '@sapphire/framework'
import { type GuildMember, type Message, PermissionFlagsBits } from 'discord.js'
import { eq } from 'drizzle-orm'
import { t } from '@nd/i18n'
import { getDb, schema } from '@nd/db'
import { brandEmbed, errorEmbed, successEmbed } from '../../lib/embed.ts'

const KNOWN_SOURCES = ['rules', 'faq', 'fivem', 'store', 'custom'] as const
type KnownSource = (typeof KNOWN_SOURCES)[number]

function normalizeSource(raw: string | null | undefined): KnownSource {
  const value = (raw ?? 'custom').toLowerCase()
  return (KNOWN_SOURCES as readonly string[]).includes(value) ? (value as KnownSource) : 'custom'
}

export class KnowledgeBaseCommand extends Command {
  public constructor(context: Command.LoaderContext, options: Command.Options) {
    super(context, {
      ...options,
      name: 'kb',
      description: 'Manage the AI knowledge base used for support answers.',
    })
  }

  public override registerApplicationCommands(registry: Command.Registry): void {
    registry.registerChatInputCommand((builder) =>
      builder
        .setName(this.name)
        .setDescription(this.description)
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .addSubcommand((sub) =>
          sub
            .setName('add')
            .setDescription('Add a document to the knowledge base.')
            .addStringOption((o) =>
              o
                .setName('source')
                .setDescription('Which corpus this belongs to.')
                .setRequired(true)
                .addChoices(...KNOWN_SOURCES.map((s) => ({ name: s, value: s }))),
            )
            .addStringOption((o) =>
              o.setName('title').setDescription('A short title for the document.').setRequired(true).setMaxLength(200),
            )
            .addStringOption((o) =>
              o.setName('content').setDescription('The document body.').setRequired(true).setMaxLength(4000),
            ),
        )
        .addSubcommand((sub) =>
          sub
            .setName('list')
            .setDescription('List knowledge base documents.')
            .addStringOption((o) =>
              o
                .setName('source')
                .setDescription('Optional source filter.')
                .addChoices(...KNOWN_SOURCES.map((s) => ({ name: s, value: s }))),
            ),
        )
        .addSubcommand((sub) =>
          sub
            .setName('remove')
            .setDescription('Remove a document by id.')
            .addIntegerOption((o) =>
              o.setName('id').setDescription('The document id (see /kb list).').setRequired(true).setMinValue(1),
            ),
        ),
    )
  }

  public override async chatInputRun(interaction: Command.ChatInputCommandInteraction): Promise<void> {
    const guildId = interaction.guildId
    if (!guildId) {
      const locale = await container.config.getLocale('0')
      await interaction.reply({ embeds: [errorEmbed(t(locale, 'common.guild_only'))], ephemeral: true })
      return
    }

    const locale = await container.config.getLocale(guildId)
    if (!(await this.isStaff(guildId, interaction.member as GuildMember | null))) {
      await interaction.reply({ embeds: [errorEmbed(t(locale, 'common.no_permission'))], ephemeral: true })
      return
    }

    const sub = interaction.options.getSubcommand(true)
    await interaction.deferReply({ ephemeral: true })

    try {
      if (sub === 'add') {
        const source = normalizeSource(interaction.options.getString('source', true))
        const title = interaction.options.getString('title', true)
        const content = interaction.options.getString('content', true)
        const embed = await this.add(source, title, content)
        await interaction.editReply({ embeds: [embed] })
      } else if (sub === 'list') {
        const source = interaction.options.getString('source')
        const embed = await this.list(source ? normalizeSource(source) : null)
        await interaction.editReply({ embeds: [embed] })
      } else if (sub === 'remove') {
        const id = interaction.options.getInteger('id', true)
        const embed = await this.remove(id, locale)
        await interaction.editReply({ embeds: [embed] })
      }
    } catch (err) {
      container.logger.error({ err, sub }, 'kb: subcommand failed')
      await interaction.editReply({ embeds: [errorEmbed(t(locale, 'common.error'))] })
    }
  }

  public override async messageRun(message: Message, args: Args): Promise<void> {
    const guildId = message.guildId
    if (!guildId) {
      const locale = await container.config.getLocale('0')
      await message.reply({ embeds: [errorEmbed(t(locale, 'common.guild_only'))] })
      return
    }

    const locale = await container.config.getLocale(guildId)
    if (!(await this.isStaff(guildId, message.member))) {
      await message.reply({ embeds: [errorEmbed(t(locale, 'common.no_permission'))] })
      return
    }

    const sub = (await args.pick('string').catch(() => '')).toLowerCase()

    try {
      if (sub === 'add') {
        const source = normalizeSource(await args.pick('string').catch(() => 'custom'))
        const title = await args.pick('string').catch(() => '')
        const content = await args.rest('string').catch(() => '')
        if (!title || !content) {
          await message.reply({ embeds: [errorEmbed('Usage: kb add <source> <title> <content>')] })
          return
        }
        await message.reply({ embeds: [await this.add(source, title, content)] })
      } else if (sub === 'list') {
        const source = await args.pick('string').catch(() => null)
        await message.reply({ embeds: [await this.list(source ? normalizeSource(source) : null)] })
      } else if (sub === 'remove') {
        const id = await args.pick('integer').catch(() => null)
        if (id === null) {
          await message.reply({ embeds: [errorEmbed(t(locale, 'common.invalid_number'))] })
          return
        }
        await message.reply({ embeds: [await this.remove(id, locale)] })
      } else {
        await message.reply({ embeds: [errorEmbed('Usage: kb add|list|remove ...')] })
      }
    } catch (err) {
      container.logger.error({ err, sub }, 'kb: message subcommand failed')
      await message.reply({ embeds: [errorEmbed(t(locale, 'common.error'))] })
    }
  }

  private async add(source: KnownSource, title: string, content: string) {
    const db = getDb()
    const inserted = await db
      .insert(schema.knowledgeDocs)
      .values({ source, title, content, updatedAt: Date.now() })
      .returning({ id: schema.knowledgeDocs.id })

    const id = inserted[0]?.id
    container.api?.hub.broadcast('ai', 'kb_added', { id, source, title })
    return successEmbed('Knowledge document added', `Stored as document ${id} in the ${source} corpus.`)
  }

  private async list(source: KnownSource | null) {
    const db = getDb()
    const base = db
      .select({
        id: schema.knowledgeDocs.id,
        source: schema.knowledgeDocs.source,
        title: schema.knowledgeDocs.title,
      })
      .from(schema.knowledgeDocs)

    const rows = source
      ? await base.where(eq(schema.knowledgeDocs.source, source)).limit(25)
      : await base.limit(25)

    if (rows.length === 0) {
      return brandEmbed({
        tone: 'neutral',
        title: 'Knowledge base',
        description: source ? `No documents in the ${source} corpus.` : 'The knowledge base is empty.',
      })
    }

    const lines = rows.map((r) => `${r.id}. [${r.source}] ${truncate(r.title, 80)}`)
    return brandEmbed({
      tone: 'primary',
      title: source ? `Knowledge base: ${source}` : 'Knowledge base',
      description: lines.join('\n'),
      footer: `${rows.length} document${rows.length === 1 ? '' : 's'} shown`,
    })
  }

  private async remove(id: number, locale: Parameters<typeof t>[0]) {
    const db = getDb()
    const deleted = await db
      .delete(schema.knowledgeDocs)
      .where(eq(schema.knowledgeDocs.id, id))
      .returning({ id: schema.knowledgeDocs.id })

    if (deleted.length === 0) {
      return errorEmbed(t(locale, 'common.not_found'))
    }
    container.api?.hub.broadcast('ai', 'kb_removed', { id })
    return successEmbed('Knowledge document removed', `Deleted document ${id}.`)
  }

  /** Allow guild managers or members holding a configured admin or mod role. */
  private async isStaff(guildId: string, member: GuildMember | null): Promise<boolean> {
    if (!member) return false
    if (member.permissions.has(PermissionFlagsBits.ManageGuild)) return true
    const settings = await container.config.getSettings(guildId)
    const allowed = new Set([...settings.roles.adminIds, ...settings.roles.modIds])
    return member.roles.cache.some((role) => allowed.has(role.id))
  }
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 3)}...` : value
}
