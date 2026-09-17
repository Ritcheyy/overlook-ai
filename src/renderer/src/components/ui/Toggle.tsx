import { cn } from '@/lib/cn'

export interface ToggleProps {
  checked: boolean
  onChange: (next: boolean) => void
  disabled?: boolean
  size?: 'sm' | 'md'
  className?: string
  'aria-label'?: string
  'aria-labelledby'?: string
}

export function Toggle({ checked, onChange, disabled, size = 'md', className, ...rest }: ToggleProps) {
  const w = size === 'sm' ? 'h-4 w-7' : 'h-5 w-9'
  const knob = size === 'sm' ? 'h-3 w-3' : 'h-4 w-4'
  const shift = size === 'sm' ? 'translate-x-3' : 'translate-x-4'
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex shrink-0 items-center rounded-full border transition-colors duration-150 disabled:opacity-40',
        w,
        checked ? 'border-accent/60 bg-accent' : 'border-line bg-raised hover:border-faint/70',
        className
      )}
      {...rest}
    >
      <span
        className={cn(
          'absolute left-0.5 rounded-full bg-white shadow transition-transform duration-150',
          knob,
          checked ? shift : 'translate-x-0',
          !checked && 'bg-muted'
        )}
      />
    </button>
  )
}
