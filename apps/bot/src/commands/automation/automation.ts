/**
 * `/automation` admin command: create, list, enable, disable, delete rules.
 *
 * Two ways to author a rule with `create`:
 *   - guided options (trigger + keyword/emoji + action + role/message), good for
 *     the common single-action cases, or
 *   - a `json` option carrying a full RuleDefinition, for anything richer
 *     (multiple conditions/actions). The JSON is validated with the same zod
 *     schema the engine uses, so a bad rule is rejected at creation time.
 *
 * Guild + admin gated. Replies through branded embeds, no emojis.
 */
import { Command } from '@sapphire/framework'
import {
  type ChatInputCommandInteraction,
  type Message,
  MessageFlags,
  PermissionFlagsBits,
} from 'discord.js'
import { and, eq } from 'drizzle-orm'
import { automationRules, getDb } from '@nd/db'
import { brandEmbed, errorEmbed, successEmbed } from '../../lib/embed.ts'
import {
  type Action,
  type Condition,
  type RuleDefinition,
  ruleDefinitionSchema,
} from '../../features/automation/types.ts'

export class AutomationCommand extends Command {
  public constructor(context: Command.LoaderContext, options: Command.Options) {
    super(context, {
      ...options,
      name: 'automation',
      description: 'Create and manage automation rules.',
      requiredUserPermissions: [PermissionFlagsBits.ManageGuild],
      preconditions: ['GuildOnly'],
    })
  }

  public override registerApplicationCommands(registry: Command.Registry): void {
    registry.registerChatInputCommand((builder) =>
      builder
        .setName(this.name)
        .setDescription(this.description)
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild.toString())
        .setDMPermission(false)
        .addSubcommand((sub) =>
          sub
            .setName('create')
            .setDescription('Create a rule from options or a JSON definition.')
            .addStringOption((o) =>
              o.setName('name').setDescription('A name for the rule.').setRequired(true),
            )
            .addStringOption((o) =>
              o
                .setName('trigger')
                .setDescription('What fires the rule.')
                .addChoices(
                  { name: 'message keyword', value: 'messageKeyword' },
                  { name: 'member join', value: 'memberJoin' },
                  { name: 'reaction', value: 'reaction' },
                  { name: 'scheduled', value: 'scheduled' },
                ),
            )
            .addStringOption((o) =>
              o
                .setName('action')
                .setDescription('What the rule does.')
                .addChoices(
                  { name: 'send message', value: 'sendMessage' },
                  { name: 'add role', value: 'addRole' },
                  { name: 'remove role', value: 'removeRole' },
                  { name: 'warn', value: 'warn' },
                  { name: 'delete message', value: 'delete' },
                ),
            )
            .addStringOption((o) =>
              o
                .setName('keyword')
                .setDescription('Keyword or emoji to match (for message/reaction triggers).'),
            )
            .addRoleOption((o) =>
              o.setName('role').setDescription('Role for add/remove role actions.'),
            )
            .addChannelOption((o) =>
              o.setName('channel').setDescription('Channel to scope the trigger or send to.'),
            )
            .addStringOption((o) =>
              o.setName('message').setDescription('Message content for the send action.'),
            )
            .addIntegerOption((o) =>
              o
                .setName('interval')
                .setDescription('Minutes between runs (scheduled trigger).')
                .setMinValue(1),
            )
            .addStringOption((o) =>
              o
                .setName('json')
                .setDescription('Full rule definition as JSON (overrides the options above).'),
            ),
        )
        .addSubcommand((sub) =>
          sub.setName('list').setDescription('List this server\'s automation rules.'),
        )
        .addSubcommand((sub) =>
          sub
            .setName('enable')
            .setDescription('Enable a rule by id.')
            .addIntegerOption((o) =>
              o.setName('id').setDescription('The rule id.').setRequired(true),
            ),
        )
        .addSubcommand((sub) =>
          sub
            .setName('disable')
            .setDescription('Disable a rule by id.')
            .addIntegerOption((o) =>
              o.setName('id').setDescription('The rule id.').setRequired(true),
            ),
        )
        .addSubcommand((sub) =>
          sub
            .setName('delete')
            .setDescription('Delete a rule by id.')
            .addIntegerOption((o) =>
              o.setName('id').setDescription('The rule id.').setRequired(true),
            ),
        ),
    )
  }

  public override async chatInputRun(interaction: ChatInputCommandInteraction): Promise<void> {
    if (!interaction.inGuild()) {
      await interaction.reply({ embeds: [errorEmbed('Server only', 'Use this in a server.')], flags: MessageFlags.Ephemeral })
      return
    }
    const sub = interaction.options.getSubcommand(true)
    switch (sub) {
      case 'create':
        return this.create(interaction)
      case 'list':
        return this.list(interaction)
      case 'enable':
        return this.toggle(interaction, true)
      case 'disable':
        return this.toggle(interaction, false)
      case 'delete':
        return this.remove(interaction)
      default:
        await interaction.reply({ embeds: [errorEmbed('Unknown subcommand')], flags: MessageFlags.Ephemeral })
    }
  }

  public override async messageRun(message: Message): Promise<void> {
    await message.reply({
      embeds: [
        brandEmbed({
          tone: 'neutral',
          title: 'Automation',
          description: 'Use the slash command: /automation create, list, enable, disable, delete.',
        }),
      ],
    })
  }

  // ---- create -------------------------------------------------------------

  private async create(interaction: ChatInputCommandInteraction): Promise<void> {
    const guildId = interaction.guildId as string
    const name = interaction.options.getString('name', true)

    const built = this.buildDefinition(interaction)
    if ('error' in built) {
      await interaction.reply({ embeds: [errorEmbed('Could not create rule', built.error)], flags: MessageFlags.Ephemeral })
      return
    }

    const def = built.definition
    const db = getDb()
    const inserted = await db
      .insert(automationRules)
      .values({
        guildId,
        name,
        enabled: true,
        trigger: def.trigger,
        conditions: def.conditions,
        actions: def.actions,
      })
      .returning({ id: automationRules.id })

    const id = inserted[0]?.id ?? 0
    this.container.automation?.invalidate(guildId)
    this.container.api?.hub.broadcast('automation', 'rule_created', {
      guildId,
      id,
      name,
      trigger: def.trigger.type,
    })

    await interaction.reply({
      embeds: [
        successEmbed(
          'Rule created',
          `Rule ${id} "${name}" is active. Trigger: ${def.trigger.type}, ${def.actions.length} action(s).`,
        ),
      ],
      flags: MessageFlags.Ephemeral,
    })
  }

  /** Build a validated RuleDefinition from the json option or the guided options. */
  private buildDefinition(
    interaction: ChatInputCommandInteraction,
  ): { definition: RuleDefinition } | { error: string } {
    const json = interaction.options.getString('json')
    if (json) {
      let parsed: unknown
      try {
        parsed = JSON.parse(json)
      } catch {
        return { error: 'The JSON is not valid JSON.' }
      }
      const result = ruleDefinitionSchema.safeParse(parsed)
      if (!result.success) {
        return { error: `The rule definition is invalid: ${result.error.issues[0]?.message ?? 'unknown error'}.` }
      }
      return { definition: result.data }
    }

    const triggerType = interaction.options.getString('trigger')
    const actionType = interaction.options.getString('action')
    if (!triggerType || !actionType) {
      return { error: 'Provide a trigger and an action, or a full json definition.' }
    }

    const keyword = interaction.options.getString('keyword') ?? ''
    const role = interaction.options.getRole('role')
    const channel = interaction.options.getChannel('channel')
    const messageContent = interaction.options.getString('message')
    const intervalMin = interaction.options.getInteger('interval')

    const trigger = this.buildTrigger(triggerType, { keyword, channelId: channel?.id ?? null, intervalMin })
    if ('error' in trigger) return { error: trigger.error }

    const action = this.buildAction(actionType, {
      roleId: role?.id ?? null,
      channelId: channel?.id ?? null,
      messageContent,
    })
    if ('error' in action) return { error: action.error }

    const definition = ruleDefinitionSchema.safeParse({
      trigger: trigger.value,
      conditions: [] as Condition[],
      actions: [action.value],
    })
    if (!definition.success) {
      return { error: `Could not assemble the rule: ${definition.error.issues[0]?.message ?? 'unknown error'}.` }
    }
    return { definition: definition.data }
  }

  private buildTrigger(
    type: string,
    opts: { keyword: string; channelId: string | null; intervalMin: number | null },
  ): { value: unknown } | { error: string } {
    switch (type) {
      case 'messageKeyword':
        return { value: { type, keyword: opts.keyword, regex: false, channelId: opts.channelId } }
      case 'memberJoin':
        return { value: { type } }
      case 'reaction':
        return { value: { type, emoji: opts.keyword, messageId: null } }
      case 'scheduled':
        return { value: { type, intervalMs: Math.max(1, opts.intervalMin ?? 60) * 60_000 } }
      default:
        return { error: 'Unknown trigger type.' }
    }
  }

  private buildAction(
    type: string,
    opts: { roleId: string | null; channelId: string | null; messageContent: string | null },
  ): { value: Action } | { error: string } {
    switch (type) {
      case 'sendMessage':
        if (!opts.messageContent) return { error: 'A send message action needs the message option.' }
        return { value: { type, content: opts.messageContent, channelId: opts.channelId } }
      case 'addRole':
        if (!opts.roleId) return { error: 'An add role action needs the role option.' }
        return { value: { type, roleId: opts.roleId } }
      case 'removeRole':
        if (!opts.roleId) return { error: 'A remove role action needs the role option.' }
        return { value: { type, roleId: opts.roleId } }
      case 'warn':
        return { value: { type, reason: 'Automated warning' } }
      case 'delete':
        return { value: { type } }
      default:
        return { error: 'Unknown action type.' }
    }
  }

  // ---- list ---------------------------------------------------------------

  private async list(interaction: ChatInputCommandInteraction): Promise<void> {
    const guildId = interaction.guildId as string
    const db = getDb()
    const rows = await db.select().from(automationRules).where(eq(automationRules.guildId, guildId))

    if (rows.length === 0) {
      await interaction.reply({
        embeds: [brandEmbed({ tone: 'neutral', title: 'Automation rules', description: 'No rules yet. Create one with /automation create.' })],
        flags: MessageFlags.Ephemeral,
      })
      return
    }

    const lines = rows.map((r) => {
      const trig = isRecord(r.trigger) && typeof r.trigger.type === 'string' ? r.trigger.type : 'unknown'
      const actionCount = Array.isArray(r.actions) ? r.actions.length : 0
      const state = r.enabled ? 'enabled' : 'disabled'
      return `[${r.id}] ${r.name} (${state}) trigger: ${trig}, ${actionCount} action(s)`
    })

    await interaction.reply({
      embeds: [
        brandEmbed({ tone: 'primary', title: `Automation rules (${rows.length})`, description: lines.join('\n').slice(0, 4000) }),
      ],
      flags: MessageFlags.Ephemeral,
    })
  }

  // ---- enable / disable ---------------------------------------------------

  private async toggle(interaction: ChatInputCommandInteraction, enabled: boolean): Promise<void> {
    const guildId = interaction.guildId as string
    const id = interaction.options.getInteger('id', true)
    const db = getDb()
    const updated = await db
      .update(automationRules)
      .set({ enabled })
      .where(and(eq(automationRules.id, id), eq(automationRules.guildId, guildId)))
      .returning({ id: automationRules.id, name: automationRules.name })

    const row = updated[0]
    if (!row) {
      await interaction.reply({ embeds: [errorEmbed('Not found', `No rule with id ${id} on this server.`)], flags: MessageFlags.Ephemeral })
      return
    }

    this.container.automation?.invalidate(guildId)
    this.container.api?.hub.broadcast('automation', enabled ? 'rule_enabled' : 'rule_disabled', { guildId, id })

    await interaction.reply({
      embeds: [successEmbed(enabled ? 'Rule enabled' : 'Rule disabled', `Rule ${row.id} "${row.name}" is now ${enabled ? 'enabled' : 'disabled'}.`)],
      flags: MessageFlags.Ephemeral,
    })
  }

  // ---- delete -------------------------------------------------------------

  private async remove(interaction: ChatInputCommandInteraction): Promise<void> {
    const guildId = interaction.guildId as string
    const id = interaction.options.getInteger('id', true)
    const db = getDb()
    const deleted = await db
      .delete(automationRules)
      .where(and(eq(automationRules.id, id), eq(automationRules.guildId, guildId)))
      .returning({ id: automationRules.id })

    if (!deleted[0]) {
      await interaction.reply({ embeds: [errorEmbed('Not found', `No rule with id ${id} on this server.`)], flags: MessageFlags.Ephemeral })
      return
    }

    this.container.automation?.invalidate(guildId)
    this.container.api?.hub.broadcast('automation', 'rule_deleted', { guildId, id })

    await interaction.reply({ embeds: [successEmbed('Rule deleted', `Rule ${id} was removed.`)], flags: MessageFlags.Ephemeral })
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
