/**
 * /avatar: show a user's avatar at full size (defaults to the caller).
 *
 * Prefers the per server avatar when the user is a member, otherwise the global
 * avatar. Provides direct links in several formats. No emojis in output.
 */
import { Command } from '@sapphire/framework'
import { type Message, type User } from 'discord.js'
import { brandEmbed } from '../../lib/embed.ts'

export class AvatarCommand extends Command {
  public constructor(context: Command.LoaderContext, options: Command.Options) {
    super(context, {
      ...options,
      name: 'avatar',
      description: 'Show a user avatar.',
    })
  }

  public override registerApplicationCommands(registry: Command.Registry): void {
    registry.registerChatInputCommand((builder) =>
      builder
        .setName(this.name)
        .setDescription(this.description)
        .addUserOption((o) =>
          o.setName('user').setDescription('The user whose avatar to show. Defaults to you.').setRequired(false),
        ),
    )
  }

  public override async chatInputRun(
    interaction: Command.ChatInputCommandInteraction,
  ): Promise<void> {
    const user = interaction.options.getUser('user') ?? interaction.user
    const member = interaction.guild?.members.cache.get(user.id) ?? null
    const display = member?.displayAvatarURL({ size: 1024 }) ?? user.displayAvatarURL({ size: 1024 })
    await interaction.reply({ embeds: [this.build(user, display)] })
  }

  public override async messageRun(message: Message): Promise<void> {
    const user = message.mentions.users.first() ?? message.author
    const member = message.guild?.members.cache.get(user.id) ?? null
    const display = member?.displayAvatarURL({ size: 1024 }) ?? user.displayAvatarURL({ size: 1024 })
    await message.reply({ embeds: [this.build(user, display)] })
  }

  private build(user: User, displayUrl: string) {
    const png = user.displayAvatarURL({ size: 1024, extension: 'png' })
    const webp = user.displayAvatarURL({ size: 1024, extension: 'webp' })
    const jpg = user.displayAvatarURL({ size: 1024, extension: 'jpg' })

    return brandEmbed({
      tone: 'primary',
      title: `Avatar for ${user.tag}`,
      description: `[PNG](${png}) | [WEBP](${webp}) | [JPG](${jpg})`,
    }).setImage(displayUrl)
  }
}
