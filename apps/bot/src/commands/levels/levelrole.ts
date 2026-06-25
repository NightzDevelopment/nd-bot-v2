/**
 * `/levelrole` add | remove | list: manage the level -> role rewards. Manage Guild.
 *
 * `add`    maps a role to a level (one role per level; remapping replaces it).
 * `remove` clears the mapping for a level.
 * `list`   shows the configured rewards.
 *
 * Message command form: `levelrole add <level> @role`, `levelrole remove <level>`,
 * `levelrole list`.
 */
import { Command, container } from '@sapphire/framework'
import { type Message, PermissionFlagsBits, type Role } from 'discord.js'
import { t } from '@nd/i18n'
import { brandEmbed, errorEmbed, successEmbed } from '../../lib/embed.ts'

export class LevelRoleCommand extends Command {
  public constructor(context: Command.LoaderContext, options: Command.Options) {
    super(context, {
      ...options,
      name: 'levelrole',
      aliases: ['lvlrole', 'levelroles'],
      description: 'Manage role rewards granted at each level.',
      requiredUserPermissions: [PermissionFlagsBits.ManageGuild],
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
            .setDescription('Map a role to a level.')
            .addIntegerOption((o) => o.setName('level').setDescription('Level reached.').setMinValue(1).setRequired(true))
            .addRoleOption((o) => o.setName('role').setDescription('Role to grant.').setRequired(true)),
        )
        .addSubcommand((sub) =>
          sub
            .setName('remove')
            .setDescription('Remove the role reward for a level.')
            .addIntegerOption((o) => o.setName('level').setDescription('Level to clear.').setMinValue(1).setRequired(true)),
        )
        .addSubcommand((sub) => sub.setName('list').setDescription('List configured level role rewards.')),
    )
  }

  public override async chatInputRun(
    interaction: Command.ChatInputCommandInteraction,
  ): Promise<void> {
    if (!interaction.inGuild() || !interaction.guild) {
      await interaction.reply({ content: t('en', 'common.guild_only'), ephemeral: true })
      return
    }
    const guildId = interaction.guildId
    const sub = interaction.options.getSubcommand()

    if (sub === 'add') {
      const level = interaction.options.getInteger('level', true)
      const role = interaction.options.getRole('role', true)
      await interaction.reply({ embeds: [await this.add(guildId, level, role as Role)] })
      return
    }
    if (sub === 'remove') {
      const level = interaction.options.getInteger('level', true)
      await interaction.reply({ embeds: [await this.remove(guildId, level)] })
      return
    }
    await interaction.reply({ embeds: [await this.list(guildId)] })
  }

  public override async messageRun(message: Message): Promise<void> {
    if (!message.inGuild() || !message.guild) return
    const parts = message.content.trim().split(/\s+/).slice(1)
    const sub = (parts[0] ?? 'list').toLowerCase()

    if (sub === 'add') {
      const level = Number.parseInt(parts[1] ?? '', 10)
      const role = message.mentions.roles.first()
      if (Number.isNaN(level) || level < 1 || !role) {
        await message.reply({ embeds: [errorEmbed('Usage', 'levelrole add <level> @role')] })
        return
      }
      await message.reply({ embeds: [await this.add(message.guildId, level, role)] })
      return
    }
    if (sub === 'remove') {
      const level = Number.parseInt(parts[1] ?? '', 10)
      if (Number.isNaN(level) || level < 1) {
        await message.reply({ embeds: [errorEmbed('Usage', 'levelrole remove <level>')] })
        return
      }
      await message.reply({ embeds: [await this.remove(message.guildId, level)] })
      return
    }
    await message.reply({ embeds: [await this.list(message.guildId)] })
  }

  private async add(guildId: string, level: number, role: Role) {
    const locale = await container.config.getLocale(guildId)
    await container.leveling.setRole(guildId, level, role.id)
    container.api?.hub.broadcast('levels', 'level_role_set', { guildId, level, roleId: role.id, ts: Date.now() })
    return successEmbed(t(locale, 'common.success'), `Members reaching level ${level} now get ${role.name}.`)
  }

  private async remove(guildId: string, level: number) {
    const locale = await container.config.getLocale(guildId)
    const removed = await container.leveling.removeRole(guildId, level)
    if (!removed) return errorEmbed(t(locale, 'common.not_found'), `No role reward is set for level ${level}.`)
    container.api?.hub.broadcast('levels', 'level_role_removed', { guildId, level, ts: Date.now() })
    return successEmbed(t(locale, 'common.success'), `Removed the role reward for level ${level}.`)
  }

  private async list(guildId: string) {
    const locale = await container.config.getLocale(guildId)
    const roles = await container.leveling.listRoles(guildId)
    const embed = brandEmbed({ tone: 'primary', title: 'Level role rewards' })
    if (roles.length === 0) {
      embed.setDescription('No level role rewards are configured. Use levelrole add to create one.')
      return embed
    }
    embed.setDescription(roles.map((r) => `Level ${r.level} grants <@&${r.roleId}>`).join('\n'))
    return embed
  }
}
