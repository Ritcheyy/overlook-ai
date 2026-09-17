import type { KeyboardEvent, ReactNode } from 'react'
import { cn } from '@/lib/cn'

export interface SegmentedOption<T extends string> {
  value: T
  label: ReactNode
  count?: number
  disabled?: boolean
  /** Text color class applied when selected, e.g. `text-lime`. */
  activeClass?: string
}

export interface SegmentedProps<T extends string> {
  options: SegmentedOption<T>[]
  value?: T
  onChange: (value: T) => void
  size?: 'sm' | 'md'
  disabled?: boolean
  className?: string
  'aria-label'?: string
}

export function Segmented<T extends string>({ options, value, onChange, size = 'md', disabled, className, ...rest }: SegmentedProps<T>) {
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
    const enabled = options.filter((o) => !o.disabled)
    if (enabled.length === 0) return
    const idx = enabled.findIndex((o) => o.value === value)
    const next = e.key === 'ArrowRight' ? (idx + 1) % enabled.length : (idx - 1 + enabled.length) % enabled.length
    e.preventDefault()
    onChange(enabled[next].value)
  }
  return (
    <div
      role="group"
      onKeyDown={onKeyDown}
      className={cn('inline-flex shrink-0 items-center rounded-md border border-line bg-surface p-0.5', disabled && 'opacity-50', className)}
      {...rest}
    >
      {options.map((o) => {
        const active = o.value === value
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={active}
            disabled={disabled || o.disabled}
            onClick={() => onChange(o.value)}
            className={cn(
              'inline-flex items-center gap-1.5 rounded font-medium transition-colors duration-100 disabled:pointer-events-none',
              size === 'sm' ? 'h-5 px-2 text-[11px]' : 'h-6 px-2.5 text-[12px]',
              active ? cn('bg-raised text-ink shadow-[0_1px_0_rgba(0,0,0,0.3)]', o.activeClass) : 'text-muted hover:text-ink'
            )}
          >
            {o.label}
            {o.count !== undefined && <span className={cn('tabular-nums', active ? 'text-muted' : 'text-faint')}>{o.count}</span>}
          </button>
        )
      })}
    </div>
  )
}
