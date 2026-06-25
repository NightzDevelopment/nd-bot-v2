/**
 * Levels: applying configured level roles to a guild member.
 *
 * Shared by the XP listener (on level up) and the admin commands (setlevel /
 * givexp) so role grants behave identically everywhere. Best effort: missing
 * roles, deleted roles, and hierarchy or permission failures are swallowed and
 * logged by the caller, never thrown into command flow.
 */
import type { GuildMember, Role } from 'discord.js'
import { container } from '@sapphire/framework'
import type { LevelingService, LevelRoleRow } from './leveling.ts'

export interface RoleSyncResult {
  /** Roles newly added to the member during this sync. */
  added: Role[]
}

/**
 * Ensure a member holds exactly the level roles they have earned at `level`.
 *
 * `stack` controls whether lower tier roles are kept (true) or stripped so only
 * the highest earned role remains (false). Returns the roles that were added so
 * the caller can announce them.
 */
export async function syncLevelRoles(
  service: LevelingService,
  member: GuildMember,
  level: number,
  stack: boolean,
): Promise<RoleSyncResult> {
  const earned = await service.earnedRoles(member.guild.id, level)
  if (earned.length === 0) return { added: [] }

  const all = await service.listRoles(member.guild.id)
  const targetIds = resolveTargetRoleIds(earned, all, stack)
  const managedIds = new Set(all.map((r) => r.roleId))

  const added: Role[] = []

  // Add the roles the member should have but does not.
  for (const roleId of targetIds) {
    if (member.roles.cache.has(roleId)) continue
    const role = member.guild.roles.cache.get(roleId)
    if (!role || !isAssignable(member, role)) continue
    try {
      await member.roles.add(role, 'Level role reward')
      added.push(role)
    } catch (err) {
      container.logger.warn({ err, roleId, userId: member.id }, 'failed to add level role')
    }
  }

  // When not stacking, remove other managed level roles the member should no
  // longer hold.
  if (!stack) {
    for (const roleId of managedIds) {
      if (targetIds.has(roleId)) continue
      if (!member.roles.cache.has(roleId)) continue
      const role = member.guild.roles.cache.get(roleId)
      if (!role || !isAssignable(member, role)) continue
      try {
        await member.roles.remove(role, 'Level role no longer earned')
      } catch (err) {
        container.logger.warn({ err, roleId, userId: member.id }, 'failed to remove level role')
      }
    }
  }

  return { added }
}

/** The role ids the member should end up holding for a given level. */
function resolveTargetRoleIds(
  earned: LevelRoleRow[],
  _all: LevelRoleRow[],
  stack: boolean,
): Set<string> {
  if (stack) return new Set(earned.map((r) => r.roleId))
  const highest = earned[earned.length - 1]
  return new Set(highest ? [highest.roleId] : [])
}

/** Whether the bot can assign `role`: not managed, and below the bot's top role. */
function isAssignable(member: GuildMember, role: Role): boolean {
  const me = member.guild.members.me
  if (!me) return false
  if (role.managed) return false
  if (role.id === member.guild.roles.everyone.id) return false
  return me.roles.highest.comparePositionTo(role) > 0
}
