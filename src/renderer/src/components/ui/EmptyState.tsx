import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'

export interface EmptyStateProps {
  icon?: ReactNode
  title: string
  description?: ReactNode
  action?: ReactNode
  compact?: boolean
  className?: string
}

export function EmptyState({ icon, title, description, action, compact, className }: EmptyStateProps) {
  return (
    <div className={cn('flex flex-col items-center justify-center text-center', compact ? 'gap-1.5 p-6' : 'gap-2 p-12', className)}>
      {icon && (
        <div className="mb-1 flex h-9 w-9 items-center justify-center rounded-lg border border-line bg-surface text-faint [&>svg]:h-4 [&>svg]:w-4">
          {icon}
        </div>
      )}
      <div className="text-[13px] font-medium text-ink">{title}</div>
      {description && <div className="max-w-[360px] text-[12px] leading-relaxed text-muted">{description}</div>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}
