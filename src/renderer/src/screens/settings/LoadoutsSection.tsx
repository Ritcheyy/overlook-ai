import { useEffect, useState } from 'react'
import { Plus, RotateCcw, Trash2 } from 'lucide-react'
import { nanoid } from 'nanoid'
import type { Loadout, Settings } from '@core/domain'
import { BUILT_IN_LOADOUTS, SKILL_MESSAGE_EXAMPLE } from '@core/loadouts'
import { cn } from '@/lib/cn'
import { Button } from '@/components/ui/Button'
import { Chip } from '@/components/ui/Chip'
import { IconButton } from '@/components/ui/IconButton'
import { Textarea } from '@/components/ui/Textarea'
import { Section, TextField, type Save } from './fields'

function LoadoutEditor({
  loadout,
  isDefault,
  canDelete,
  onChange,
  onMakeDefault,
  onReset,
  onDelete
}: {
  loadout: Loadout
  isDefault: boolean
  canDelete: boolean
  onChange: (patch: Partial<Loadout>) => void
  onMakeDefault: () => void
  onReset?: () => void
  onDelete: () => void
}) {
  const [prompt, setPrompt] = useState(loadout.prompt)
  useEffect(() => setPrompt(loadout.prompt), [loadout.prompt])
  const builtIn = BUILT_IN_LOADOUTS.find((b) => b.id === loadout.id)
  const modified =
    !!builtIn &&
    (builtIn.name !== loadout.name ||
      builtIn.tagline !== loadout.tagline ||
      builtIn.prompt !== loadout.prompt ||
      (builtIn.slashCommand ?? '') !== (loadout.slashCommand ?? ''))
  return (
    <div className={cn('flex flex-col gap-2 border-b border-line/60 py-3 last:border-0')}>
      <div className="flex flex-wrap items-center gap-2">
        <TextField
          aria-label="Loadout name"
          value={loadout.name}
          onSave={(name) => onChange({ name: name.trim() || loadout.name })}
          wrapperClassName="w-[220px]"
          className="font-medium"
        />
        {loadout.builtIn ? <Chip tone="faint">built-in</Chip> : <Chip tone="accent">custom</Chip>}
        {modified && <Chip tone="amber">modified</Chip>}
        <div className="flex-1" />
        <label className="inline-flex cursor-pointer items-center gap-1.5 text-[12px] text-muted">
          <input type="radio" name="default-loadout" className="accent-accent" checked={isDefault} onChange={onMakeDefault} />
          Default
        </label>
        {onReset && (
          <Button size="sm" variant="ghost" icon={<RotateCcw className="h-3.5 w-3.5" />} disabled={!modified} onClick={onReset} title="Restore the built-in text">
            Reset
          </Button>
        )}
        <IconButton size="sm" tone="danger" aria-label={`Delete ${loadout.name}`} disabled={!canDelete} onClick={onDelete}>
          <Trash2 />
        </IconButton>
      </div>
      <TextField
        aria-label="Loadout tagline"
        placeholder="One line on what this loadout looks for"
        value={loadout.tagline}
        onSave={(tagline) => onChange({ tagline })}
      />
      <div className="flex flex-col gap-0.5">
        <TextField
          aria-label="Message (optional)"
          mono
          placeholder="Message (optional); leave empty to send the generated prompt"
          value={loadout.slashCommand ?? ''}
          onSave={(v) => onChange({ slashCommand: v.trim() || undefined })}
          wrapperClassName="w-[360px]"
        />
        <div className="text-[11.5px] leading-snug text-faint">
          Sent as the user message instead of the generated prompt, which then becomes the appended system prompt. Use it to invoke a skill by name, for
          example: <span className="font-mono text-muted">{SKILL_MESSAGE_EXAMPLE}</span> A bare /code-review slash command runs outside the conversation
          and returns nothing usable.
        </div>
      </div>
      <Textarea
        aria-label="Loadout prompt"
        mono
        className="min-h-[140px]"
        placeholder="Instructions appended to the review prompt"
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        onBlur={() => {
          if (prompt !== loadout.prompt) onChange({ prompt })
        }}
      />
    </div>
  )
}

export function LoadoutsSection({ settings, save }: { settings: Settings; save: Save }) {
  const update = (id: string, patch: Partial<Loadout>) => save({ loadouts: settings.loadouts.map((l) => (l.id === id ? { ...l, ...patch } : l)) })
  const add = () => {
    const l: Loadout = { id: `custom-${nanoid(6)}`, name: 'Custom loadout', tagline: '', prompt: '', builtIn: false }
    void save({ loadouts: [...settings.loadouts, l] })
  }
  const remove = (id: string) => {
    const loadouts = settings.loadouts.filter((l) => l.id !== id)
    const patch: Partial<Settings> = { loadouts }
    if (settings.defaultLoadoutId === id && loadouts[0]) patch.defaultLoadoutId = loadouts[0].id
    void save(patch)
  }
  const reset = (id: string) => {
    const builtIn = BUILT_IN_LOADOUTS.find((b) => b.id === id)
    if (builtIn) void update(id, { name: builtIn.name, tagline: builtIn.tagline, prompt: builtIn.prompt, slashCommand: builtIn.slashCommand })
  }
  return (
    <Section
      id="loadouts"
      title="Loadouts"
      description="A loadout is the review style a character takes to a pull request. The prompt is appended to the base review instructions."
      actions={
        <Button size="sm" variant="secondary" icon={<Plus className="h-3.5 w-3.5" />} onClick={add}>
          Add custom
        </Button>
      }
    >
      {settings.loadouts.map((l) => (
        <LoadoutEditor
          key={l.id}
          loadout={l}
          isDefault={settings.defaultLoadoutId === l.id}
          canDelete={settings.loadouts.length > 1}
          onChange={(patch) => void update(l.id, patch)}
          onMakeDefault={() => void save({ defaultLoadoutId: l.id })}
          onReset={BUILT_IN_LOADOUTS.some((b) => b.id === l.id) ? () => reset(l.id) : undefined}
          onDelete={() => remove(l.id)}
        />
      ))}
    </Section>
  )
}
