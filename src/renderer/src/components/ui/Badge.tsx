import { cn } from '@/lib/cn'
import type { Tone } from './Chip'

const BADGE_TONE: Record<Tone, string> = {
  neutral: 'bg-raised text-ink',
  muted: 'bg-raised text-muted',
  faint: 'bg-raised text-faint',
  accent: 'bg-accent text-white',
  amber: 'bg-amber text-bg',
  teal: 'bg-teal text-bg',
  rose: 'bg-rose text-bg',
  lime: 'bg-lime text-bg'
}

export interface BadgeProps {
  count: number
  tone?: Tone
  className?: string
  'aria-label'?: string
}

export function Badge({ count, tone = 'accent', className, ...rest }: BadgeProps) {
  if (count <= 0) return null
  return (
    <span
      className={cn(
        'inline-flex h-[17px] min-w-[17px] items-center justify-center rounded-full px-1.5 text-[10px] font-semibold tabular-nums leading-none',
        BADGE_TONE[tone],
        className
      )}
      {...rest}
    >
      {count > 99 ? '99+' : count}
    </span>
  )
}
