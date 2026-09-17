import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { LoaderCircle } from 'lucide-react'
import { cn } from '@/lib/cn'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'
export type ButtonSize = 'sm' | 'md' | 'lg'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  icon?: ReactNode
  loading?: boolean
}

export const BUTTON_BASE =
  'inline-flex select-none items-center justify-center gap-1.5 whitespace-nowrap rounded-md font-medium transition-colors duration-100 disabled:pointer-events-none disabled:opacity-40'

export const BUTTON_VARIANT: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.14)] hover:bg-accent/90 active:bg-accent/80',
  secondary: 'border border-line bg-raised text-ink hover:border-faint/70 hover:bg-raised/70 active:bg-surface',
  ghost: 'text-muted hover:bg-raised hover:text-ink active:bg-raised/70',
  danger: 'border border-rose/25 bg-rose/10 text-rose hover:bg-rose/20 active:bg-rose/25'
}

export const BUTTON_SIZE: Record<ButtonSize, string> = {
  sm: 'h-6 px-2 text-[12px]',
  md: 'h-7 px-2.5 text-[13px]',
  lg: 'h-8 px-3 text-[13px]'
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', icon, loading, className, children, disabled, type = 'button', ...rest },
  ref
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      className={cn(BUTTON_BASE, BUTTON_VARIANT[variant], BUTTON_SIZE[size], className)}
      {...rest}
    >
      {loading ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden /> : icon}
      {children}
    </button>
  )
})
