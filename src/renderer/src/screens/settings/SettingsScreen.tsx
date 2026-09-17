import { useRef, useState, type UIEvent } from 'react'
import { Bot, Check, FolderGit2, GitBranch, Layers, Settings2, Users, X, type LucideIcon } from 'lucide-react'
import type { EnvironmentCheck, Settings } from '@core/domain'
import { missionHoldsSlot } from '@core/domain'
import { api } from '@/lib/api'
import { cn } from '@/lib/cn'
import { relativeTime } from '@/lib/format'
import { selectMissions, selectSettings, useAppStore } from '@/state/store'
import { Button } from '@/components/ui/Button'
import { Select, type SelectOption } from '@/components/ui/Select'
import { Toggle } from '@/components/ui/Toggle'
import { useNow } from '@/components/app/useNow'
import { Field, NumberField, SavedHint, Section, TextField, useSettingsSaver, type Save } from './fields'
import { LoadoutsSection } from './LoadoutsSection'
import { RepositoriesSection } from './RepositoriesSection'

const SECTIONS: { id: string; label: string; icon: LucideIcon }[] = [
  { id: 'general', label: 'General', icon: Settings2 },
  { id: 'characters', label: 'Characters', icon: Users },
  { id: 'loadouts', label: 'Loadouts', icon: Layers },
  { id: 'repositories', label: 'Repositories', icon: FolderGit2 },
  { id: 'claude', label: 'Claude', icon: Bot },
  { id: 'worktrees', label: 'Worktrees', icon: GitBranch }
]

const EFFORTS: { value: '' | NonNullable<Settings['claudeEffort']>; label: string }[] = [
  { value: '', label: 'CLI default' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'max', label: 'Max' }
]

/** What `--model` takes by name; the CLI resolves each alias to the newest model of that family. */
const MODEL_ALIASES: SelectOption[] = [
  { value: '', label: 'CLI default' },
  { value: 'fable', label: 'Fable (latest)' },
  { value: 'opus', label: 'Opus (latest)' },
  { value: 'sonnet', label: 'Sonnet (latest)' }
]
const CUSTOM_MODEL = 'custom'
const MODEL_OPTIONS: SelectOption[] = [...MODEL_ALIASES, { value: CUSTOM_MODEL, label: 'Custom model id…' }]
const FALLBACK_OPTIONS: SelectOption[] = [{ value: '', label: 'None' }, ...MODEL_ALIASES.slice(1)]

const isModelAlias = (value: string) => MODEL_ALIASES.some((o) => o.value === value)

/** A hand-edited settings file may hold a full id; listing it keeps the select from showing None over a live fallback. */
function fallbackOptions(value: string | undefined): SelectOption[] {
  return value && !isModelAlias(value) ? [...FALLBACK_OPTIONS, { value, label: value }] : FALLBACK_OPTIONS
}

function ModelField({ value, save }: { value: string; save: Save }) {
  const [custom, setCustom] = useState(false)
  const alias = isModelAlias(value)
  const showCustom = custom || !alias
  const onSelect = (next: string) => {
    if (next === CUSTOM_MODEL) {
      setCustom(true)
      return
    }
    setCustom(false)
    void save({ claudeModel: next })
  }
  const onCustom = (id: string) => {
    // A cleared id means no --model at all, which is the CLI default.
    if (!id) setCustom(false)
    void save({ claudeModel: id })
  }
  return (
    <Field label="Model" hint="Aliases resolve to the latest model of that family on your account." htmlFor="claude-model">
      <Select id="claude-model" value={showCustom ? CUSTOM_MODEL : value} onChange={(e) => onSelect(e.target.value)} options={MODEL_OPTIONS} wrapperClassName="w-[200px]" />
      {showCustom && (
        <TextField mono aria-label="Custom model id" placeholder="e.g. claude-fable-5" value={alias ? '' : value} onSave={(v) => onCustom(v.trim())} wrapperClassName="w-[260px]" />
      )}
    </Field>
  )
}

function RestartButton() {
  const missions = useAppStore(selectMissions)
  const pushToast = useAppStore((s) => s.pushToast)
  const busy = missions.some((m) => missionHoldsSlot(m.state))
  const relaunch = () => api.relaunch().catch((e: Error) => pushToast({ kind: 'error', title: 'Restart failed', body: e.message }))
  return (
    <>
      <Button size="sm" variant="primary" disabled={busy} onClick={() => void relaunch()}>
        Restart now
      </Button>
      {busy && <span className="text-[12px] text-faint">Wait for running reviews to finish</span>}
    </>
  )
}

function GeneralSection({ settings, save, initialDemoMode }: { settings: Settings; save: Save; initialDemoMode: boolean }) {
  return (
    <Section id="general" title="General" description="Polling, notifications, and what the inbox shows.">
      <Field label="Poll interval" hint="How often GitHub is asked for review requests and pushes." htmlFor="poll-interval">
        <NumberField id="poll-interval" min={15} max={3600} step={15} value={settings.pollIntervalSec} onSave={(pollIntervalSec) => void save({ pollIntervalSec })} wrapperClassName="w-[110px]" />
        <span className="text-[12px] text-faint">seconds</span>
      </Field>
      <Field label="Notifications" hint="System notification when a review needs you or fails.">
        <Toggle aria-label="Notifications" checked={settings.notifications} onChange={(notifications) => void save({ notifications })} />
      </Field>
      <Field label="Include my PRs" hint="List pull requests you authored so you can self-review.">
        <Toggle aria-label="Include my pull requests" checked={settings.includeMine} onChange={(includeMine) => void save({ includeMine })} />
      </Field>
      <Field label="Ignore PRs older than" hint="Counted from the last update. 0 shows everything." htmlFor="max-pr-age">
        <NumberField id="max-pr-age" min={0} step={1} integer value={settings.maxPrAgeDays} onSave={(maxPrAgeDays) => void save({ maxPrAgeDays })} wrapperClassName="w-[110px]" />
        <span className="text-[12px] text-faint">days</span>
      </Field>
      <Field
        label="Automatic follow-up rounds"
        hint="How many times a mission re-reviews on its own after pushes before waiting for you."
        htmlFor="auto-rounds"
      >
        <NumberField
          id="auto-rounds"
          min={0}
          step={1}
          integer
          value={settings.maxAutoRoundsPerMission}
          onSave={(maxAutoRoundsPerMission) => void save({ maxAutoRoundsPerMission })}
          wrapperClassName="w-[110px]"
        />
      </Field>
      <Field label="Demo mode" hint="Fake GitHub and a scripted reviewer. Nothing leaves the machine and no tokens are spent.">
        <Toggle aria-label="Demo mode" checked={settings.demoMode} onChange={(demoMode) => void save({ demoMode })} />
        {settings.demoMode !== initialDemoMode && (
          <>
            <span className="text-[12px] text-amber">Restart the app to apply</span>
            <RestartButton />
          </>
        )}
      </Field>
      <Field
        label="Comment signature"
        hint="Trailing line of every posted comment. Placeholders: {loadout}, {character}, {login}, {approval}, {round}, {sha}. Leave empty for none."
        htmlFor="signature"
      >
        <TextField id="signature" placeholder="e.g. {loadout} · Reviewed by {character} · {approval}" value={settings.signature} onSave={(signature) => void save({ signature })} />
      </Field>
    </Section>
  )
}

function CharactersSection({ settings, save }: { settings: Settings; save: Save }) {
  const update = (id: string, patch: { name?: string; color?: string }) => save({ slots: settings.slots.map((s) => (s.id === id ? { ...s, ...patch } : s)) })
  return (
    <Section id="characters" title="Characters" description="The two reviewers on the floor. Each holds one mission at a time.">
      {settings.slots.map((slot, i) => (
        <Field key={slot.id} label={`Desk ${i + 1}`} hint={slot.id} htmlFor={`slot-name-${slot.id}`}>
          <label className="relative inline-flex h-7 w-7 cursor-pointer items-center justify-center overflow-hidden rounded-md border border-line" title="Character color">
            <span className="absolute inset-1 rounded" style={{ background: slot.color }} aria-hidden />
            <input
              type="color"
              aria-label={`${slot.name} color`}
              className="absolute inset-0 cursor-pointer opacity-0"
              value={slot.color}
              onChange={(e) => void update(slot.id, { color: e.target.value })}
            />
          </label>
          <TextField id={`slot-name-${slot.id}`} value={slot.name} onSave={(name) => void update(slot.id, { name: name.trim() || slot.name })} wrapperClassName="w-[200px]" />
          <TextField mono aria-label={`${slot.name} color hex`} value={slot.color} onSave={(color) => /^#[0-9a-f]{6}$/i.test(color) && void update(slot.id, { color })} wrapperClassName="w-[110px]" />
        </Field>
      ))}
    </Section>
  )
}

function EnvironmentField() {
  const pushToast = useAppStore((s) => s.pushToast)
  const cached = useAppStore((s) => s.snapshot?.environment)
  const [result, setResult] = useState<EnvironmentCheck | undefined>()
  const [checking, setChecking] = useState(false)
  const now = useNow()
  // The engine caches the result on the snapshot; until that push lands, show what the call returned.
  const env = result && (!cached || result.checkedAt >= cached.checkedAt) ? result : cached
  const check = async () => {
    setChecking(true)
    try {
      setResult(await api.checkEnvironment())
    } catch (e) {
      pushToast({ kind: 'error', title: 'Environment check failed', body: (e as Error).message })
    } finally {
      setChecking(false)
    }
  }
  return (
    <Field label="Environment" hint="gh login, the claude binary, git, and a writable worktree root.">
      <div className="flex w-full flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="secondary" loading={checking} onClick={() => void check()}>
            Check environment
          </Button>
          {env && (
            <span className="text-[11.5px] text-faint" title={env.checkedAt}>
              Checked {relativeTime(env.checkedAt, now)}
            </span>
          )}
        </div>
        {env && (
          <ul className="flex flex-col gap-1" aria-label="Environment checks">
            {env.items.map((item) => (
              <li key={item.id} className="flex items-start gap-2 text-[12.5px]">
                {item.ok ? (
                  <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-lime" role="img" aria-label="ok" />
                ) : (
                  <X className="mt-0.5 h-3.5 w-3.5 shrink-0 text-rose" role="img" aria-label="failed" />
                )}
                <span className="w-[120px] shrink-0 text-ink">{item.label}</span>
                <span className="min-w-0 break-words font-mono text-[11.5px] text-muted">{item.detail}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Field>
  )
}

function ClaudeSection({ settings, save }: { settings: Settings; save: Save }) {
  return (
    <Section id="claude" title="Claude" description="How the Claude Code CLI is invoked for real reviews. Unused in demo mode.">
      <Field label="CLI path" hint="Executable name or absolute path." htmlFor="claude-path">
        <TextField id="claude-path" mono value={settings.claudePath} onSave={(claudePath) => void save({ claudePath: claudePath.trim() || 'claude' })} wrapperClassName="w-[320px]" />
      </Field>
      <ModelField value={settings.claudeModel ?? ''} save={save} />
      <Field label="Fallback model" hint="Used automatically when the main model is overloaded or at its usage limit." htmlFor="claude-fallback-model">
        <Select
          id="claude-fallback-model"
          value={settings.claudeFallbackModel ?? ''}
          onChange={(e) => void save({ claudeFallbackModel: e.target.value || undefined })}
          options={fallbackOptions(settings.claudeFallbackModel)}
          wrapperClassName="w-[200px]"
        />
      </Field>
      <Field label="Effort" htmlFor="claude-effort">
        <Select
          id="claude-effort"
          value={settings.claudeEffort ?? ''}
          onChange={(e) => void save({ claudeEffort: (e.target.value || undefined) as Settings['claudeEffort'] })}
          options={EFFORTS}
          wrapperClassName="w-[160px]"
        />
      </Field>
      <Field label="Max budget per review" hint="The CLI stops when a review would cost more than this." htmlFor="claude-budget">
        <span className="text-[12px] text-faint">$</span>
        <NumberField id="claude-budget" min={0} step={0.5} value={settings.maxBudgetUsdPerReview} onSave={(maxBudgetUsdPerReview) => void save({ maxBudgetUsdPerReview })} wrapperClassName="w-[110px]" />
      </Field>
      <EnvironmentField />
    </Section>
  )
}

function WorktreesSection({ settings, save }: { settings: Settings; save: Save }) {
  return (
    <Section id="worktrees" title="Worktrees" description="Each mission checks the PR out into its own git worktree so your main checkout is never touched.">
      <Field
        label="Worktree root"
        hint={
          <>
            Layout: <span className="font-mono">{'<root>/<owner>/<name>/pr-<number>'}</span>
          </>
        }
        htmlFor="worktree-root"
      >
        <TextField id="worktree-root" mono value={settings.worktreeRoot} onSave={(worktreeRoot) => void save({ worktreeRoot: worktreeRoot.trim() || settings.worktreeRoot })} wrapperClassName="w-[360px]" />
      </Field>
    </Section>
  )
}

export function SettingsScreen() {
  const settings = useAppStore(selectSettings)
  const { save, savedAt } = useSettingsSaver()
  const [active, setActive] = useState(SECTIONS[0].id)
  const scrollRef = useRef<HTMLDivElement>(null)
  const initialDemoMode = useRef(settings?.demoMode)

  const onScroll = (e: UIEvent<HTMLDivElement>) => {
    const container = e.currentTarget
    const threshold = container.scrollTop + 80
    let current = SECTIONS[0].id
    for (const s of SECTIONS) {
      const el = container.querySelector<HTMLElement>(`#${s.id}`)
      if (el && el.offsetTop <= threshold) current = s.id
    }
    setActive(current)
  }
  const jump = (id: string) => {
    setActive(id)
    scrollRef.current?.querySelector<HTMLElement>(`#${id}`)?.scrollIntoView({ block: 'start', behavior: 'smooth' })
  }

  if (!settings) return null

  return (
    <div className="flex h-full min-h-0">
      <aside className="flex w-[200px] shrink-0 flex-col border-r border-line bg-surface/40">
        <div className="flex h-[52px] shrink-0 items-center border-b border-line px-4">
          <h1 className="text-[14px] font-semibold tracking-tight">Settings</h1>
        </div>
        <nav className="sticky top-0 flex flex-col gap-0.5 p-2" aria-label="Settings sections">
          {SECTIONS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              aria-current={active === id ? 'true' : undefined}
              onClick={() => jump(id)}
              className={cn(
                'flex h-7 items-center gap-2 rounded-md px-2 text-[12.5px] transition-colors',
                active === id ? 'bg-raised text-ink' : 'text-muted hover:bg-raised/60 hover:text-ink'
              )}
            >
              <Icon className={cn('h-3.5 w-3.5', active === id ? 'text-accent' : 'text-faint')} aria-hidden />
              {label}
            </button>
          ))}
        </nav>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-[52px] shrink-0 items-center justify-end border-b border-line px-5">
          <SavedHint savedAt={savedAt} />
        </div>
        <div ref={scrollRef} onScroll={onScroll} className="relative min-h-0 flex-1 overflow-auto">
          <div className="mx-auto flex max-w-[860px] flex-col gap-8 px-5 py-5 pb-24">
            <GeneralSection settings={settings} save={save} initialDemoMode={initialDemoMode.current ?? settings.demoMode} />
            <CharactersSection settings={settings} save={save} />
            <LoadoutsSection settings={settings} save={save} />
            <RepositoriesSection settings={settings} save={save} />
            <ClaudeSection settings={settings} save={save} />
            <WorktreesSection settings={settings} save={save} />
          </div>
        </div>
      </div>
    </div>
  )
}
