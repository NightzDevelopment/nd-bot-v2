/**
 * Welcome/goodbye template helpers.
 *
 * Settings do not yet carry per guild welcome/goodbye templates or a goodbye
 * channel, so the listeners fall back to these locale aware defaults and the
 * configured welcome channel. The template syntax supports {user}, {guild}, and
 * {memberCount}. When config gains those fields the listeners can read them and
 * pass the stored template straight into `renderGreeting`.
 */

/** Placeholders a greeting template may use. */
export interface GreetingVars {
  user: string
  guild: string
  memberCount: number
}

/** Interpolate {user}, {guild}, {memberCount} into a template string. */
export function renderGreeting(template: string, vars: GreetingVars): string {
  return template
    .replaceAll('{user}', vars.user)
    .replaceAll('{guild}', vars.guild)
    .replaceAll('{memberCount}', String(vars.memberCount))
}
