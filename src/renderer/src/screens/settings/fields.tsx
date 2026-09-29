import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { Check } from 'lucide-react'
import type { Settings } from '@core/domain'
import { api } from '@/lib/api'
import { cn } from '@/lib/cn'
import { useAppStore } from '@/state/store'
import { Card } from '@/components/ui/Card'
import { Input, type InputProps } from '@/components/ui/Input'
import { Textarea } from '@/components/ui/Textarea'

export type Save = (patch: Partial<Settings>) => Promise<void>

export function useSettingsSaver(): { save: Save; savedAt: number | null } {
  const pushToast = useAppStore((s) => s.pushToast)
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const save = useCallback<Save>(
    async (patch) => {
      try {
        await api.updateSettings(patch)
        setSavedAt(Date.now())
      } catch (e) {
        pushToast({ kind: 'error', title: 'Could not save settings', body: (e as Error).message })
      }
    },
    [pushToast]
  )
  return { save, savedAt }
}

export function SavedHint({ savedAt }: { savedAt: number | null }) {
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    if (!savedAt) return
    setVisible(true)
    const t = setTimeout(() => setVisible(false), 1800)
    return () => clearTimeout(t)
  }, [savedAt])
  return (
    <span className={cn('inline-flex items-center gap-1 text-[12px] text-lime transition-opacity duration-300', visible ? 'opacity-100' : 'opacity-0')} aria-live="polite">
      <Check className="h-3.5 w-3.5" aria-hidden />
      Saved
    </span>
  )
}

export function Section({ id, title, description, children, actions }: { id: string; title: string; description?: ReactNode; children: ReactNode; actions?: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="scroll-mt-4">
      <div className="mb-2 flex items-end gap-3">
        <div className="min-w-0 flex-1">
          <h2 id={`${id}-title`} className="text-[13px] font-semibold text-ink">
            {title}
          </h2>
          {description && <p className="mt-0.5 text-[12px] leading-snug text-muted">{description}</p>}
        </div>
        {actions}
      </div>
      <Card padded={false} className="px-4">
        {children}
      </Card>
    </section>
  )
}

export function Field({ label, hint, htmlFor, children, stacked }: { label: ReactNode; hint?: ReactNode; htmlFor?: string; children: ReactNode; stacked?: boolean }) {
  return (
    <div className={cn('border-b border-line/60 py-3 last:border-0', stacked ? 'flex flex-col gap-2' : 'grid grid-cols-[minmax(160px,220px)_minmax(0,1fr)] items-start gap-4')}>
      <div className="min-w-0">
        <label htmlFor={htmlFor} className="text-[13px] text-ink">
          {label}
        </label>
        {hint && <div className="mt-0.5 text-[11.5px] leading-snug text-faint">{hint}</div>}
      </div>
      <div className="flex min-w-0 flex-wrap items-center gap-2">{children}</div>
    </div>
  )
}

export interface TextFieldProps extends Omit<InputProps, 'value' | 'onChange' | 'onBlur'> {
  value: string
  onSave: (value: string) => void
}

/** A short-lived note beside a field: that it saved, or what it changed the value to. */
function useFieldNote(): [ReactNode, (note: ReactNode) => void] {
  const [note, setNote] = useState<ReactNode>(null)
  useEffect(() => {
    if (!note) return
    const t = setTimeout(() => setNote(null), 2500)
    return () => clearTimeout(t)
  }, [note])
  return [note, setNote]
}

const SAVED = (
  <span className="inline-flex items-center gap-1 text-[11.5px] text-lime" role="status">
    <Check className="h-3 w-3" aria-hidden />
    Saved
  </span>
)

/** Controlled locally; commits on blur or Enter only when the value changed. */
export function TextField({ value, onSave, onKeyDown, ...rest }: TextFieldProps) {
  const [draft, setDraft] = useState(value)
  const [note, setNote] = useFieldNote()
  useEffect(() => setDraft(value), [value])
  const commit = () => {
    if (draft === value) return
    onSave(draft)
    setNote(SAVED)
  }
  return (
    <>
      <Input
        {...rest}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          onKeyDown?.(e)
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
          if (e.key === 'Escape') setDraft(value)
        }}
      />
      {note}
    </>
  )
}

export interface NumberFieldProps extends Omit<InputProps, 'value' | 'onChange' | 'onBlur' | 'type'> {
  value: number
  onSave: (value: number) => void
  min?: number
  max?: number
  step?: number
  integer?: boolean
}

export function NumberField({ value, onSave, min, max, step, integer, ...rest }: NumberFieldProps) {
  const [draft, setDraft] = useState(String(value))
  const [note, setNote] = useFieldNote()
  useEffect(() => setDraft(String(value)), [value])
  const commit = () => {
    const typed = Number(draft)
    if (draft.trim() === '' || !Number.isFinite(typed)) {
      setDraft(String(value))
      return
    }
    let n = integer ? Math.round(typed) : typed
    if (min !== undefined) n = Math.max(min, n)
    if (max !== undefined) n = Math.min(max, n)
    const adjusted =
      n !== typed ? (
        <span className="text-[11.5px] text-amber" role="status">
          {min !== undefined && typed < min ? `Set to ${n}, the minimum` : max !== undefined && typed > max ? `Set to ${n}, the maximum` : `Set to ${n}`}
        </span>
      ) : undefined
    setDraft(String(n))
    if (n !== value) {
      onSave(n)
      setNote(adjusted ?? SAVED)
    } else if (adjusted) {
      setNote(adjusted)
    }
  }
  return (
    <>
      <Input
        {...rest}
        type="number"
        inputMode={integer ? 'numeric' : 'decimal'}
        min={min}
        max={max}
        step={step}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
          if (e.key === 'Escape') setDraft(String(value))
        }}
      />
      {note}
    </>
  )
}

export interface TextAreaFieldProps {
  id?: string
  value: string
  placeholder?: string
  rows?: number
  onSave: (value: string) => void
}

/** Like TextField, for text too long for one line. */
export function TextAreaField({ id, value, placeholder, rows = 2, onSave }: TextAreaFieldProps) {
  const [draft, setDraft] = useState(value)
  const [note, setNote] = useFieldNote()
  useEffect(() => setDraft(value), [value])
  const commit = () => {
    if (draft === value) return
    onSave(draft)
    setNote(SAVED)
  }
  return (
    <>
      <Textarea
        id={id}
        rows={rows}
        placeholder={placeholder}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Escape') setDraft(value)
        }}
        className="text-[12.5px]"
      />
      {note}
    </>
  )
}

