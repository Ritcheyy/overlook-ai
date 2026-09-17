import type { FindingSeverity } from '@core/domain'
import { cn } from '@/lib/cn'
import type { Tone } from '../ui/Chip'

export interface SeverityMeta {
  label: string
  tone: Tone
  dot: string
  text: string
}

export const SEVERITY_META: Record<FindingSeverity, SeverityMeta> = {
  blocker: { label: 'Blocker', tone: 'rose', dot: 'bg-rose', text: 'text-rose' },
  major: { label: 'Major', tone: 'amber', dot: 'bg-amber', text: 'text-amber' },
  minor: { label: 'Minor', tone: 'accent', dot: 'bg-accent', text: 'text-accent' },
  nit: { label: 'Nit', tone: 'muted', dot: 'bg-muted', text: 'text-muted' },
  praise: { label: 'Praise', tone: 'lime', dot: 'bg-lime', text: 'text-lime' }
}

export interface SeverityDotProps {
  severity: FindingSeverity
  label?: boolean
  className?: string
}

export function SeverityDot({ severity, label, className }: SeverityDotProps) {
  const meta = SEVERITY_META[severity]
  return (
    <span className={cn('inline-flex items-center gap-1.5', className)} title={label ? undefined : meta.label}>
      <span className={cn('h-2 w-2 shrink-0 rounded-full', meta.dot)} aria-hidden />
      {label && <span className={cn('text-[12px] font-semibold', meta.text)}>{meta.label}</span>}
      {!label && <span className="sr-only">{meta.label}</span>}
    </span>
  )
}
