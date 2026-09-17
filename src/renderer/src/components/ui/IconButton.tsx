import { forwardRef, type ButtonHTMLAttributes } from 'react'
import { cn } from '@/lib/cn'

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  'aria-label': string
  size?: 'sm' | 'md'
  variant?: 'ghost' | 'secondary'
  tone?: 'default' | 'danger' | 'accent'
}

const TONE = {
  default: 'text-muted hover:text-ink',
  danger: 'text-muted hover:text-rose',
  accent: 'text-accent hover:text-accent'
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { size = 'md', variant = 'ghost', tone = 'default', className, type = 'button', title, ...rest },
  ref
) {
  return (
    <button
      ref={ref}
      type={type}
      title={title ?? rest['aria-label']}
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-md transition-colors duration-100 disabled:pointer-events-none disabled:opacity-40',
        size === 'sm' ? 'h-6 w-6 [&>svg]:h-3.5 [&>svg]:w-3.5' : 'h-7 w-7 [&>svg]:h-4 [&>svg]:w-4',
        variant === 'secondary' ? 'border border-line bg-raised hover:border-faint/70' : 'hover:bg-raised',
        TONE[tone],
        className
      )}
      {...rest}
    />
  )
})
