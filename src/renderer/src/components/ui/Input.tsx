import { forwardRef, type InputHTMLAttributes, type ReactNode } from 'react'
import { cn } from '@/lib/cn'

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  size?: 'sm' | 'md'
  mono?: boolean
  leading?: ReactNode
  trailing?: ReactNode
  wrapperClassName?: string
}

export const INPUT_CLASS =
  'w-full rounded-md border border-line bg-raised text-ink placeholder:text-faint transition-colors hover:border-faint/70 focus:border-accent/60 focus:outline-none disabled:opacity-40'

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { size = 'md', mono, leading, trailing, className, wrapperClassName, ...rest },
  ref
) {
  return (
    <span className={cn('relative inline-flex w-full items-center', wrapperClassName)}>
      {leading && <span className="pointer-events-none absolute left-2 inline-flex text-faint [&>svg]:h-3.5 [&>svg]:w-3.5">{leading}</span>}
      <input
        ref={ref}
        className={cn(
          INPUT_CLASS,
          size === 'sm' ? 'h-6 px-2 text-[12px]' : 'h-7 px-2.5 text-[13px]',
          leading && 'pl-7',
          trailing && 'pr-7',
          mono && 'font-mono text-[12px]',
          className
        )}
        {...rest}
      />
      {trailing && <span className="absolute right-1.5 inline-flex text-faint">{trailing}</span>}
    </span>
  )
})
