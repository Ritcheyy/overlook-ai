import { useCallback, useRef, useState, type ReactNode } from 'react'
import { ChevronDown, LoaderCircle } from 'lucide-react'
import type { RunOptions, Settings } from '@core/domain'
import { cn } from '@/lib/cn'
import { selectSettings, useAppStore } from '@/state/store'
import { Button } from '../ui/Button'
import { Dropdown, MenuLabel } from '../ui/Dropdown'
import { Input } from '../ui/Input'
import { Select, type SelectOption } from '../ui/Select'

/** The value that keeps a field on its Settings default, so only real changes become run options. */
const DEFAULT = '__settings__'
const CUSTOM = '__custom__'
const MODEL_ALIASES: SelectOption[] = [
  { value: '', label: 'CLI default' },
  { value: 'fable', label: 'Fable (latest)' },
  { value: 'opus', label: 'Opus (latest)' },
  { value: 'sonnet', label: 'Sonnet (latest)' }
]
const EFFORTS: SelectOption[] = [
  { value: '', label: 'CLI default' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'max', label: 'Max' }
]

function modelLabel(value: string | undefined): string {
  const alias = MODEL_ALIASES.find((o) => o.value === (value ?? ''))
  return alias ? alias.label.replace(' (latest)', '') : (value ?? 'CLI default')
}

function effortLabel(value: string | undefined): string {
  return EFFORTS.find((o) => o.value === (value ?? ''))?.label ?? 'CLI default'
}

export interface ReviewStart {
  loadoutId: string
  options?: RunOptions
}

export interface ReviewSplitButtonProps {
  label: ReactNode
  /** Review type the quick click and the form start from. */
  loadoutId: string
  /** What "Post without triage" starts at: the review's or the repo's current setting. */
  autoPost: boolean
  /** `fromForm` is true when the options form started it, false for the quick click. */
  onStart: (start: ReviewStart, fromForm: boolean) => Promise<void> | void
  variant?: 'primary' | 'secondary'
  disabled?: boolean
  title?: string
  icon?: ReactNode
  className?: string
}

/**
 * A review button whose chevron opens the options for this one run: review
 * type, model, effort, budget and auto-post. Anything left on its default
 * keeps following Settings.
 */
export function ReviewSplitButton({ label, loadoutId, autoPost, onStart, variant = 'secondary', disabled, title, icon, className }: ReviewSplitButtonProps) {
  const settings = useAppStore(selectSettings)
  const anchor = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const close = useCallback(() => setOpen(false), [])

  const start = async (s: ReviewStart, fromForm: boolean) => {
    setOpen(false)
    setBusy(true)
    try {
      await onStart(s, fromForm)
    } finally {
      setBusy(false)
    }
  }

  const primary = variant === 'primary'
  return (
    <>
      <div
        ref={anchor}
        className={cn(
          'inline-flex h-7 shrink-0 items-stretch overflow-hidden rounded-md text-[12px] font-medium transition-colors',
          primary ? 'bg-accent text-white' : 'border border-line bg-raised text-ink hover:border-faint/70',
          (busy || disabled) && 'opacity-60',
          className
        )}
      >
        <button
          type="button"
          disabled={busy || disabled}
          onClick={() => void start({ loadoutId }, false)}
          title={title}
          className={cn('inline-flex items-center gap-1.5 px-2.5 transition-colors disabled:pointer-events-none', primary ? 'hover:bg-white/10' : 'hover:bg-surface')}
        >
          {busy ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden /> : icon}
          {label}
        </button>
        <button
          type="button"
          aria-label="Review options"
          aria-haspopup="dialog"
          aria-expanded={open}
          disabled={busy || disabled}
          onClick={() => setOpen((o) => !o)}
          className={cn(
            'inline-flex items-center border-l px-1.5 transition-colors disabled:pointer-events-none',
            primary ? 'border-white/20 hover:bg-white/10' : 'border-line text-muted hover:bg-surface hover:text-ink'
          )}
        >
          <ChevronDown className="h-3.5 w-3.5" aria-hidden />
        </button>
      </div>
      <Dropdown open={open} onClose={close} anchorRef={anchor} align="end" width={340}>
        {settings && <RunOptionsForm settings={settings} loadoutId={loadoutId} autoPost={autoPost} onSubmit={(s) => void start(s, true)} />}
      </Dropdown>
    </>
  )
}

function RunOptionsForm({ settings, loadoutId: initialLoadout, autoPost: initialAutoPost, onSubmit }: { settings: Settings; loadoutId: string; autoPost: boolean; onSubmit: (s: ReviewStart) => void }) {
  const [loadoutId, setLoadoutId] = useState(initialLoadout)
  const [model, setModel] = useState(DEFAULT)
  const [customModel, setCustomModel] = useState('')
  const [effort, setEffort] = useState(DEFAULT)
  const [budget, setBudget] = useState('')
  const [autoPost, setAutoPost] = useState(initialAutoPost)

  const loadouts: SelectOption[] = settings.loadouts.map((l) => ({ value: l.id, label: l.name }))
  if (!loadouts.some((o) => o.value === loadoutId)) loadouts.unshift({ value: loadoutId, label: loadoutId })
  const modelOptions: SelectOption[] = [{ value: DEFAULT, label: `As in Settings: ${modelLabel(settings.claudeModel)}` }, ...MODEL_ALIASES, { value: CUSTOM, label: 'Custom model id…' }]
  const effortOptions: SelectOption[] = [{ value: DEFAULT, label: `As in Settings: ${effortLabel(settings.claudeEffort)}` }, ...EFFORTS]

  const submit = () => {
    const options: RunOptions = {}
    if (model === CUSTOM) {
      if (customModel.trim()) options.model = customModel.trim()
    } else if (model !== DEFAULT) options.model = model
    if (effort !== DEFAULT) options.effort = effort as RunOptions['effort']
    const n = Number(budget)
    if (budget.trim() !== '' && Number.isFinite(n) && n >= 0) options.maxBudgetUsd = n
    if (autoPost !== initialAutoPost) options.autoPost = autoPost
    onSubmit({ loadoutId, options: Object.keys(options).length > 0 ? options : undefined })
  }

  const row = 'grid grid-cols-[84px_minmax(0,1fr)] items-center gap-2 px-2 py-1'
  return (
    <form
      role="dialog"
      aria-label="Review options"
      onSubmit={(e) => {
        e.preventDefault()
        submit()
      }}
      className="flex flex-col"
    >
      <MenuLabel>This run only</MenuLabel>
      <label className={row}>
        <span className="text-[12px] text-muted">Review type</span>
        <Select size="sm" aria-label="Review type" value={loadoutId} onChange={(e) => setLoadoutId(e.target.value)} options={loadouts} />
      </label>
      <label className={row}>
        <span className="text-[12px] text-muted">Model</span>
        <Select size="sm" aria-label="Model" value={model} onChange={(e) => setModel(e.target.value)} options={modelOptions} />
      </label>
      {model === CUSTOM && (
        <label className={row}>
          <span className="text-[12px] text-muted">Model id</span>
          <Input size="sm" aria-label="Custom model id" placeholder="e.g. claude-fable-5" value={customModel} onChange={(e) => setCustomModel(e.target.value)} className="font-mono" />
        </label>
      )}
      <label className={row}>
        <span className="text-[12px] text-muted">Effort</span>
        <Select size="sm" aria-label="Effort" value={effort} onChange={(e) => setEffort(e.target.value)} options={effortOptions} />
      </label>
      <label className={row}>
        <span className="text-[12px] text-muted">Budget</span>
        <Input
          size="sm"
          type="number"
          min={0}
          step={0.5}
          aria-label="Budget in dollars"
          placeholder={`$${settings.maxBudgetUsdPerReview} from Settings`}
          value={budget}
          onChange={(e) => setBudget(e.target.value)}
        />
      </label>
      <label className="flex cursor-pointer items-center gap-2 px-2 py-1.5 text-[12px] text-muted">
        <input type="checkbox" className="h-3.5 w-3.5 accent-accent" checked={autoPost} onChange={(e) => setAutoPost(e.target.checked)} />
        <span>Post without triage</span>
      </label>
      <div className="flex justify-end border-t border-line px-2 pb-1 pt-2">
        <Button type="submit" size="sm" variant="primary">
          Start review
        </Button>
      </div>
    </form>
  )
}
