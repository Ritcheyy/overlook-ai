import { forwardRef, type SelectHTMLAttributes } from 'react'
import { ChevronDown } from 'lucide-react'
import { cn } from '@/lib/cn'

export interface SelectOption {
  value: string
  label: string
  disabled?: boolean
}

export interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'size'> {
  size?: 'sm' | 'md'
  options?: SelectOption[]
  wrapperClassName?: string
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { size = 'md', options, className, wrapperClassName, children, ...rest },
  ref
) {
  return (
    <span className={cn('relative inline-flex', wrapperClassName)}>
      <select
        ref={ref}
        className={cn(
          'w-full cursor-pointer appearance-none rounded-md border border-line bg-raised pl-2 pr-7 text-ink transition-colors hover:border-faint/70 focus:border-accent/60 focus:outline-none disabled:opacity-40',
          size === 'sm' ? 'h-6 text-[12px]' : 'h-7 text-[13px]',
          className
        )}
        {...rest}
      >
        {options?.map((o) => (
          <option key={o.value} value={o.value} disabled={o.disabled}>
            {o.label}
          </option>
        ))}
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute right-1.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-faint" aria-hidden />
    </span>
  )
})
