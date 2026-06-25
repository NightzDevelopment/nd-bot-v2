import { useEffect, useMemo, useState } from 'react'
import { Panel } from '../components/ui/Panel'
import { Button } from '../components/ui/Button'
import { StatusDot } from '../components/ui/StatusDot'
import { api, ApiError } from '../lib/api'
import { useGuild } from '../lib/useGuild'

// ---- Settings shape (mirrors apps/bot/src/lib/config.ts) ------------------

interface ModuleToggle {
  enabled: boolean
  logChannelId: string | null
}

interface GuildSettings {
  channels: {
    auditLogId: string | null
    welcomeId: string | null
    modLogId: string | null
    ticketCategoryId: string | null
  }
  roles: {
    adminIds: string[]
    modIds: string[]
    mutedId: string | null
  }
  modules: Record<ModuleKey, ModuleToggle>
  thresholds: {
    maxWarnings: number
    xpPerMessage: number
    dailyAmount: number
  }
}

interface ConfigResponse {
  locale: string
  settings: GuildSettings
}

type DeepPartial<T> = T extends object ? { [K in keyof T]?: DeepPartial<T[K]> } : T

type SettingsPatch = DeepPartial<GuildSettings>

type ModuleKey =
  | 'moderation'
  | 'automod'
  | 'tickets'
  | 'aiSupport'
  | 'economy'
  | 'levels'
  | 'community'
  | 'utility'
  | 'automation'

const MODULE_KEYS: ModuleKey[] = [
  'moderation',
  'automod',
  'tickets',
  'aiSupport',
  'economy',
  'levels',
  'community',
  'utility',
  'automation',
]

const MODULE_LABELS: Record<ModuleKey, string> = {
  moderation: 'Moderation',
  automod: 'Automod',
  tickets: 'Tickets',
  aiSupport: 'AI Support',
  economy: 'Economy',
  levels: 'Levels',
  community: 'Community',
  utility: 'Utility',
  automation: 'Automation',
}

const CHANNEL_FIELDS: Array<{ key: keyof GuildSettings['channels']; label: string }> = [
  { key: 'auditLogId', label: 'Audit Log Channel' },
  { key: 'welcomeId', label: 'Welcome Channel' },
  { key: 'modLogId', label: 'Mod Log Channel' },
  { key: 'ticketCategoryId', label: 'Ticket Category' },
]

const THRESHOLD_FIELDS: Array<{ key: keyof GuildSettings['thresholds']; label: string }> = [
  { key: 'maxWarnings', label: 'Max Warnings' },
  { key: 'xpPerMessage', label: 'XP Per Message' },
  { key: 'dailyAmount', label: 'Daily Amount' },
]

// ---- Defaults + helpers ---------------------------------------------------

function emptySettings(): GuildSettings {
  return {
    channels: { auditLogId: null, welcomeId: null, modLogId: null, ticketCategoryId: null },
    roles: { adminIds: [], modIds: [], mutedId: null },
    modules: MODULE_KEYS.reduce(
      (acc, key) => {
        acc[key] = { enabled: false, logChannelId: null }
        return acc
      },
      {} as Record<ModuleKey, ModuleToggle>,
    ),
    thresholds: { maxWarnings: 3, xpPerMessage: 15, dailyAmount: 250 },
  }
}

/** Merge a fetched (possibly partial) settings blob over the defaults. */
function normalize(raw: Partial<GuildSettings> | undefined): GuildSettings {
  const base = emptySettings()
  if (!raw) return base
  return {
    channels: { ...base.channels, ...(raw.channels ?? {}) },
    roles: { ...base.roles, ...(raw.roles ?? {}) },
    modules: MODULE_KEYS.reduce(
      (acc, key) => {
        acc[key] = { ...base.modules[key], ...(raw.modules?.[key] ?? {}) }
        return acc
      },
      {} as Record<ModuleKey, ModuleToggle>,
    ),
    thresholds: { ...base.thresholds, ...(raw.thresholds ?? {}) },
  }
}

/** Trim to a nullable id (empty string becomes null). */
function nullableId(value: string): string | null {
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

/** Parse a comma / whitespace separated id list into a deduped array. */
function parseIdList(value: string): string[] {
  const ids = value
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter((s) => s !== '')
  return [...new Set(ids)]
}

function sameStringArray(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false
  return a.every((v, i) => v === b[i])
}

/**
 * Build a minimal patch containing only the fields that differ between the
 * original config and the edited draft. Empty sections are omitted.
 */
function buildPatch(original: GuildSettings, draft: GuildSettings): SettingsPatch {
  const patch: SettingsPatch = {}

  const channels: DeepPartial<GuildSettings['channels']> = {}
  for (const { key } of CHANNEL_FIELDS) {
    if (draft.channels[key] !== original.channels[key]) channels[key] = draft.channels[key]
  }
  if (Object.keys(channels).length > 0) patch.channels = channels

  const roles: DeepPartial<GuildSettings['roles']> = {}
  if (!sameStringArray(draft.roles.adminIds, original.roles.adminIds))
    roles.adminIds = draft.roles.adminIds
  if (!sameStringArray(draft.roles.modIds, original.roles.modIds)) roles.modIds = draft.roles.modIds
  if (draft.roles.mutedId !== original.roles.mutedId) roles.mutedId = draft.roles.mutedId
  if (Object.keys(roles).length > 0) patch.roles = roles

  const modules: DeepPartial<Record<ModuleKey, ModuleToggle>> = {}
  for (const key of MODULE_KEYS) {
    const d = draft.modules[key]
    const o = original.modules[key]
    if (d.enabled !== o.enabled || d.logChannelId !== o.logChannelId) modules[key] = d
  }
  if (Object.keys(modules).length > 0) patch.modules = modules

  const thresholds: DeepPartial<GuildSettings['thresholds']> = {}
  for (const { key } of THRESHOLD_FIELDS) {
    if (draft.thresholds[key] !== original.thresholds[key])
      thresholds[key] = draft.thresholds[key]
  }
  if (Object.keys(thresholds).length > 0) patch.thresholds = thresholds

  return patch
}

const inputClass =
  'w-full rounded border border-sentinel-border bg-sentinel-bg px-2 py-1.5 text-xs text-sentinel-text placeholder:text-sentinel-muted/60 focus:border-sentinel-primary focus:outline-none'

// ---- Page -----------------------------------------------------------------

type SaveState =
  | { kind: 'idle' }
  | { kind: 'saving' }
  | { kind: 'saved' }
  | { kind: 'error'; message: string }

export default function ConfigPage() {
  const { guildId, loading: guildLoading } = useGuild()

  const [original, setOriginal] = useState<GuildSettings | null>(null)
  const [draft, setDraft] = useState<GuildSettings | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [save, setSave] = useState<SaveState>({ kind: 'idle' })

  useEffect(() => {
    if (!guildId) return
    const ctrl = new AbortController()
    setLoading(true)
    setLoadError(null)
    setSave({ kind: 'idle' })

    api
      .get<ConfigResponse>(`/api/guilds/${guildId}/config`, undefined, ctrl.signal)
      .then((res) => {
        const settings = normalize(res.settings)
        setOriginal(settings)
        setDraft(settings)
        setLoading(false)
      })
      .catch((err: unknown) => {
        if (ctrl.signal.aborted) return
        const message =
          err instanceof ApiError ? err.message : 'Failed to load configuration'
        setLoadError(message)
        setLoading(false)
      })

    return () => ctrl.abort()
  }, [guildId])

  const patch = useMemo(() => {
    if (!original || !draft) return {}
    return buildPatch(original, draft)
  }, [original, draft])

  const dirty = Object.keys(patch).length > 0

  function update(mutate: (next: GuildSettings) => void): void {
    setDraft((prev) => {
      if (!prev) return prev
      const next: GuildSettings = {
        channels: { ...prev.channels },
        roles: { ...prev.roles, adminIds: [...prev.roles.adminIds], modIds: [...prev.roles.modIds] },
        modules: MODULE_KEYS.reduce(
          (acc, key) => {
            acc[key] = { ...prev.modules[key] }
            return acc
          },
          {} as Record<ModuleKey, ModuleToggle>,
        ),
        thresholds: { ...prev.thresholds },
      }
      mutate(next)
      return next
    })
    if (save.kind === 'saved' || save.kind === 'error') setSave({ kind: 'idle' })
  }

  async function onSave(): Promise<void> {
    if (!guildId || !dirty) return
    setSave({ kind: 'saving' })
    try {
      const res = await api.patch<ConfigResponse>(`/api/guilds/${guildId}/config`, {
        settings: patch,
      })
      const settings = normalize(res.settings)
      setOriginal(settings)
      setDraft(settings)
      setSave({ kind: 'saved' })
    } catch (err: unknown) {
      const message = err instanceof ApiError ? err.message : 'Failed to save configuration'
      setSave({ kind: 'error', message })
    }
  }

  function onReset(): void {
    if (original) setDraft(original)
    setSave({ kind: 'idle' })
  }

  // ---- Render states ------------------------------------------------------

  if (guildLoading || loading) {
    return (
      <div className="mx-auto max-w-4xl">
        <Panel title="Configuration" tag={<StatusDot status="idle" label="Loading" />}>
          <p className="text-xs text-sentinel-muted">Loading guild configuration...</p>
        </Panel>
      </div>
    )
  }

  if (!guildId) {
    return (
      <div className="mx-auto max-w-4xl">
        <Panel title="Configuration" tag={<StatusDot status="offline" label="No Guild" />}>
          <p className="text-xs text-sentinel-muted">No guild connected.</p>
        </Panel>
      </div>
    )
  }

  if (loadError || !draft) {
    return (
      <div className="mx-auto max-w-4xl">
        <Panel title="Configuration" tag={<StatusDot status="alert" label="Error" />}>
          <p className="text-xs text-sentinel-alert">{loadError ?? 'Configuration unavailable.'}</p>
        </Panel>
      </div>
    )
  }

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4">
      {/* Header / save bar */}
      <Panel
        title="Configuration"
        tag={
          dirty ? (
            <StatusDot status="idle" label="Unsaved" />
          ) : (
            <StatusDot status="online" label="In Sync" />
          )
        }
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-xs text-sentinel-muted">
            <span className="text-sentinel-muted">Guild </span>
            <span className="text-sentinel-text">{guildId}</span>
          </div>
          <div className="flex items-center gap-3">
            <SaveStatus state={save} />
            <Button variant="ghost" onClick={onReset} disabled={!dirty || save.kind === 'saving'}>
              Reset
            </Button>
            <Button
              variant="primary"
              onClick={onSave}
              disabled={!dirty || save.kind === 'saving'}
            >
              {save.kind === 'saving' ? 'Saving...' : 'Save Changes'}
            </Button>
          </div>
        </div>
      </Panel>

      {/* Modules */}
      <Panel title="Modules">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {MODULE_KEYS.map((key) => {
            const mod = draft.modules[key]
            return (
              <div
                key={key}
                className="flex flex-col gap-2 rounded border border-sentinel-border bg-sentinel-bg/40 p-2"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs uppercase tracking-[0.12em] text-sentinel-text">
                    {MODULE_LABELS[key]}
                  </span>
                  <Toggle
                    checked={mod.enabled}
                    onChange={(enabled) =>
                      update((next) => {
                        next.modules[key].enabled = enabled
                      })
                    }
                    label={MODULE_LABELS[key]}
                  />
                </div>
                <label className="flex flex-col gap-1">
                  <span className="text-[10px] uppercase tracking-[0.12em] text-sentinel-muted">
                    Log Channel ID
                  </span>
                  <input
                    className={inputClass}
                    value={mod.logChannelId ?? ''}
                    placeholder="none"
                    inputMode="numeric"
                    onChange={(e) =>
                      update((next) => {
                        next.modules[key].logChannelId = nullableId(e.target.value)
                      })
                    }
                  />
                </label>
              </div>
            )
          })}
        </div>
      </Panel>

      {/* Channels */}
      <Panel title="Channels">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {CHANNEL_FIELDS.map(({ key, label }) => (
            <label key={key} className="flex flex-col gap-1">
              <span className="text-[10px] uppercase tracking-[0.12em] text-sentinel-muted">
                {label}
              </span>
              <input
                className={inputClass}
                value={draft.channels[key] ?? ''}
                placeholder="channel id"
                inputMode="numeric"
                onChange={(e) =>
                  update((next) => {
                    next.channels[key] = nullableId(e.target.value)
                  })
                }
              />
            </label>
          ))}
        </div>
      </Panel>

      {/* Roles */}
      <Panel title="Roles">
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-[0.12em] text-sentinel-muted">
              Admin Role IDs
            </span>
            <input
              className={inputClass}
              value={draft.roles.adminIds.join(', ')}
              placeholder="comma separated role ids"
              onChange={(e) =>
                update((next) => {
                  next.roles.adminIds = parseIdList(e.target.value)
                })
              }
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-[0.12em] text-sentinel-muted">
              Mod Role IDs
            </span>
            <input
              className={inputClass}
              value={draft.roles.modIds.join(', ')}
              placeholder="comma separated role ids"
              onChange={(e) =>
                update((next) => {
                  next.roles.modIds = parseIdList(e.target.value)
                })
              }
            />
          </label>
          <label className="flex flex-col gap-1 sm:max-w-xs">
            <span className="text-[10px] uppercase tracking-[0.12em] text-sentinel-muted">
              Muted Role ID
            </span>
            <input
              className={inputClass}
              value={draft.roles.mutedId ?? ''}
              placeholder="role id"
              inputMode="numeric"
              onChange={(e) =>
                update((next) => {
                  next.roles.mutedId = nullableId(e.target.value)
                })
              }
            />
          </label>
        </div>
      </Panel>

      {/* Thresholds */}
      <Panel title="Thresholds">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {THRESHOLD_FIELDS.map(({ key, label }) => (
            <label key={key} className="flex flex-col gap-1">
              <span className="text-[10px] uppercase tracking-[0.12em] text-sentinel-muted">
                {label}
              </span>
              <input
                className={inputClass}
                type="number"
                min={0}
                value={Number.isFinite(draft.thresholds[key]) ? draft.thresholds[key] : 0}
                onChange={(e) =>
                  update((next) => {
                    const parsed = Number.parseInt(e.target.value, 10)
                    next.thresholds[key] = Number.isFinite(parsed) && parsed >= 0 ? parsed : 0
                  })
                }
              />
            </label>
          ))}
        </div>
      </Panel>
    </div>
  )
}

// ---- Small components -----------------------------------------------------

function SaveStatus({ state }: { state: SaveState }) {
  if (state.kind === 'saved')
    return <StatusDot status="online" label="Saved" />
  if (state.kind === 'error')
    return (
      <span className="max-w-[14rem] truncate text-[11px] text-sentinel-alert" title={state.message}>
        {state.message}
      </span>
    )
  if (state.kind === 'saving') return <StatusDot status="idle" label="Saving" />
  return null
}

interface ToggleProps {
  checked: boolean
  onChange: (next: boolean) => void
  label: string
}

/** Sentinel HUD toggle: sharp track, neon-green active state. */
function Toggle({ checked, onChange, label }: ToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cnToggleTrack(checked)}
    >
      <span
        className={
          checked
            ? 'block h-3 w-3 translate-x-4 bg-sentinel-bg transition-transform'
            : 'block h-3 w-3 translate-x-0 bg-sentinel-muted transition-transform'
        }
      />
    </button>
  )
}

function cnToggleTrack(checked: boolean): string {
  const base =
    'inline-flex h-4 w-9 items-center rounded border px-0.5 transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-sentinel-primary'
  return checked
    ? `${base} border-sentinel-active bg-sentinel-active/20`
    : `${base} border-sentinel-border bg-sentinel-bg`
}
