import type { HTMLAttributes, ReactNode } from 'react'
import { cn } from '@/lib/cn'

export type Tone = 'neutral' | 'muted' | 'faint' | 'accent' | 'amber' | 'teal' | 'rose' | 'lime'

export const CHIP_TONE: Record<Tone, string> = {
  neutral: 'bg-raised text-ink border-line',
  muted: 'bg-raised text-muted border-line',
  faint: 'bg-transparent text-faint border-line',
  accent: 'bg-accent/10 text-accent border-accent/25',
  amber: 'bg-amber/10 text-amber border-amber/25',
  teal: 'bg-teal/10 text-teal border-teal/25',
  rose: 'bg-rose/10 text-rose border-rose/25',
  lime: 'bg-lime/10 text-lime border-lime/25'
}

export const DOT_TONE: Record<Tone, string> = {
  neutral: 'bg-ink',
  muted: 'bg-muted',
  faint: 'bg-faint',
  accent: 'bg-accent',
  amber: 'bg-amber',
  teal: 'bg-teal',
  rose: 'bg-rose',
  lime: 'bg-lime'
}

export interface ChipProps extends HTMLAttributes<HTMLElement> {
  tone?: Tone
  dot?: boolean
  pulse?: boolean
  size?: 'xs' | 'sm'
  mono?: boolean
  icon?: ReactNode
  children?: ReactNode
}

/** Renders a button when `onClick` is given so state chips stay keyboard reachable. */
export function Chip({ tone = 'neutral', dot, pulse, size = 'xs', mono, icon, className, children, onClick, ...rest }: ChipProps) {
  const classes = cn(
    'inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded border font-medium leading-none',
    size === 'xs' ? 'h-[18px] px-1.5 text-[11px]' : 'h-[22px] px-2 text-[12px]',
    mono && 'font-mono',
    CHIP_TONE[tone],
    onClick && 'cursor-pointer transition-colors hover:brightness-125',
    className
  )
  const body = (
    <>
      {dot && <span className={cn('h-1.5 w-1.5 rounded-full', DOT_TONE[tone], pulse && 'animate-pulse-soft')} />}
      {icon}
      {children}
    </>
  )
  if (onClick) {
    return (
      <button type="button" className={classes} onClick={onClick} {...rest}>
        {body}
      </button>
    )
  }
  return (
    <span className={classes} {...rest}>
      {body}
    </span>
  )
}
