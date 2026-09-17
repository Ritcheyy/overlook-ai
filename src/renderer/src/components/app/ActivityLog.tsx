import { useEffect, useRef } from 'react'
import type { Activity, ActivityKind } from '@core/domain'
import { cn } from '@/lib/cn'
import { formatClock } from '@/lib/format'

const KIND_CLASS: Record<ActivityKind, string> = {
  preparing: 'text-accent',
  reading: 'text-teal',
  thinking: 'text-accent',
  searching: 'text-teal',
  writing: 'text-amber',
  running: 'text-muted',
  done: 'text-lime',
  error: 'text-rose'
}

export interface ActivityLogProps {
  items: Activity[]
  className?: string
  emptyText?: string
  follow?: boolean
}

export function ActivityLog({ items, className, emptyText = 'No activity recorded in this session.', follow = true }: ActivityLogProps) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (follow && ref.current) ref.current.scrollTop = ref.current.scrollHeight
  }, [items.length, follow])
  return (
    <div ref={ref} className={cn('overflow-auto rounded-md border border-line bg-bg p-2 font-mono text-[11.5px] leading-[1.6]', className)} role="log">
      {items.length === 0 && <div className="text-faint">{emptyText}</div>}
      {items.map((a, i) => (
        <div key={`${a.at}-${i}`} className="flex gap-2 whitespace-pre-wrap">
          <span className="shrink-0 text-faint">{formatClock(a.at)}</span>
          <span className={cn('w-[72px] shrink-0 uppercase tracking-wide', KIND_CLASS[a.kind])}>{a.kind}</span>
          <span className="min-w-0 break-words text-muted">{a.text}</span>
        </div>
      ))}
    </div>
  )
}
