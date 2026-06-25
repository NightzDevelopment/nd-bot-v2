/**
 * `/automod` command: inspect and manage the automod module in-server.
 *
 * Subcommands:
 *   status  - show effective filters, thresholds, and counts.
 *   scan    - re-run the suspicious name scan on a member on demand.
 *   test    - dry-run the content filters against a sample string.
 *
 * Mutating the persisted settings (word lists, toggles) happens on the dashboard;
 * this command is the in-Discord read/diagnostic surface. Admin-gated.
 */
import { Command } from '@sapphire/framework'
import { type Message, PermissionFlagsBits } from 'discord.js'
import { t } from '@nd/i18n'
import { brandEmbed, errorEmbed, successEmbed } from '../../lib/embed.ts'
import { resolveAutomodSettings } from '../../features/automod/config.ts'
import { extractDomains, runContentFilters } from '../../features/automod/filters.ts'

export class AutomodCommand extends Command {
  public constructor(context: Command.LoaderContext, options: Command.Options) {
    super(context, {
      ...options,
      name: 'automod',
      description: 'Inspect and diagnose the automatic moderation module.',
      requiredUserPermissions: [PermissionFlagsBits.ManageGuild],
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
          sub.setName('status').setDescription('Show the current automod configuration.'),
        )
        .addSubcommand((sub) =>
          sub
            .setName('scan')
            .setDescription('Re-run the suspicious-name scan on a member.')
            .addUserOption((opt) =>
              opt.setName('member').setDescription('The member to scan.').setRequired(true),
            ),
        )
        .addSubcommand((sub) =>
          sub
            .setName('test')
            .setDescription('Dry-run the content filters against a sample message.')
            .addStringOption((opt) =>
              opt.setName('text').setDescription('Sample message text.').setRequired(true),
            ),
        ),
    )
  }

  public override async chatInputRun(interaction: Command.ChatInputCommandInteraction): Promise<void> {
    if (!interaction.inGuild()) {
      const locale = await this.container.config.getLocale('0')
      await interaction.reply({ content: t(locale, 'common.guild_only'), ephemeral: true })
      return
    }

    const sub = interaction.options.getSubcommand()
    if (sub === 'status') return void (await this.runStatus(interaction))
    if (sub === 'scan') return void (await this.runScan(interaction))
    if (sub === 'test') return void (await this.runTest(interaction))
  }

  public override async messageRun(message: Message): Promise<void> {
    if (!message.inGuild()) return
    const settings = await resolveAutomodSettings(message.guildId)
    await message.reply({ embeds: [this.statusEmbed(settings)] })
  }

  private async runStatus(interaction: Command.ChatInputCommandInteraction): Promise<void> {
    if (!interaction.inGuild()) return
    const settings = await resolveAutomodSettings(interaction.guildId)
    await interaction.reply({ embeds: [this.statusEmbed(settings)], ephemeral: true })
  }

  private async runScan(interaction: Command.ChatInputCommandInteraction): Promise<void> {
    if (!interaction.inGuild()) return
    const locale = await this.container.config.getLocale(interaction.guildId)
    const user = interaction.options.getUser('member', true)
    const member = await interaction.guild?.members.fetch(user.id).catch(() => null)
    if (!member) {
      await interaction.reply({
        embeds: [errorEmbed('Automod', t(locale, 'common.member_not_found'))],
        ephemeral: true,
      })
      return
    }
    const settings = await resolveAutomodSettings(interaction.guildId)
    const flagged = await this.container.automod.scanMember(member, settings)
    const embed = flagged
      ? successEmbed('Automod scan', `${member} matched a suspicious pattern. Mods were alerted.`)
      : brandEmbed({ tone: 'neutral', title: 'Automod scan', description: `${member} looks clean.` })
    await interaction.reply({ embeds: [embed], ephemeral: true })
  }

  private async runTest(interaction: Command.ChatInputCommandInteraction): Promise<void> {
    if (!interaction.inGuild()) return
    const text = interaction.options.getString('text', true)
    const settings = await resolveAutomodSettings(interaction.guildId)
    const hit = runContentFilters({ content: text, mentionCount: 0 }, settings)
    const domains = extractDomains(text)
    const description = hit
      ? `Would trip: ${hit.kind}\n${hit.reason}`
      : `No content filter tripped.${domains.length ? `\nLinks found: ${domains.join(', ')}` : ''}`
    const embed = hit
      ? brandEmbed({ tone: 'warning', title: 'Automod test', description })
      : brandEmbed({ tone: 'success', title: 'Automod test', description })
    await interaction.reply({ embeds: [embed], ephemeral: true })
  }

  private statusEmbed(settings: ReturnType<typeof resolveAutomodSettings> extends Promise<infer S> ? S : never) {
    const onOff = (v: boolean): string => (v ? 'on' : 'off')
    const f = settings.filters
    const th = settings.thresholds
    return brandEmbed({
      tone: settings.enabled ? 'success' : 'neutral',
      title: 'Automod status',
      description: settings.enabled ? 'Module is enabled.' : 'Module is disabled.',
    }).addFields(
      {
        name: 'Filters',
        value: [
          `Banned words: ${onOff(f.bannedWords)} (${settings.bannedWords.length} terms)`,
          `Invite links: ${onOff(f.inviteLinks)}`,
          `Mass mention: ${onOff(f.massMention)} (limit ${th.maxMentions})`,
          `Spam flood: ${onOff(f.spamFlood)} (${th.floodCount} in ${Math.round(th.floodWindowMs / 1000)}s)`,
          `Link filter: ${onOff(f.linkFilter)}`,
          `AI scam check: ${onOff(settings.aiScamCheck)}`,
        ].join('\n'),
        inline: false,
      },
      {
        name: 'Escalation',
        value: `Mute after ${th.escalateAfter} strikes in ${Math.round(
          th.escalateWindowMs / 60_000,
        )}m, for ${Math.round(th.muteMs / 60_000)}m.`,
        inline: false,
      },
      {
        name: 'Raid + quarantine',
        value: [
          `Raid alert: ${th.raidJoinCount} joins in ${Math.round(th.raidWindowMs / 1000)}s`,
          `Quarantine role: ${settings.quarantineRoleId ? `<@&${settings.quarantineRoleId}>` : 'none'}`,
          `Name patterns: ${settings.suspiciousNamePatterns.length}`,
          `Alert channel: ${settings.alertChannelId ? `<#${settings.alertChannelId}>` : 'none'}`,
        ].join('\n'),
        inline: false,
      },
    )
  }
}
