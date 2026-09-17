import type { MissionEvent } from '@core/domain'
import { cn } from '@/lib/cn'
import { formatClock, relativeTime } from '@/lib/format'
import { DOT_TONE } from '../ui/Chip'
import { MISSION_STATE_META } from './StateChip'

export interface TimelineProps {
  events: MissionEvent[]
  now?: number
  className?: string
}

export function Timeline({ events, now = Date.now(), className }: TimelineProps) {
  if (events.length === 0) return <div className="text-[12px] text-faint">No events yet.</div>
  return (
    <ol className={cn('relative ml-1.5 border-l border-line', className)}>
      {events.map((e, i) => {
        const meta = MISSION_STATE_META[e.to]
        return (
          <li key={`${e.at}-${i}`} className="relative pb-3 pl-4 last:pb-0">
            <span className={cn('absolute -left-[4.5px] top-[5px] h-2 w-2 rounded-full ring-2 ring-bg', DOT_TONE[meta.tone])} aria-hidden />
            <div className="flex items-baseline gap-2 text-[12px]">
              <span className="font-medium text-ink">
                {e.from ? `${MISSION_STATE_META[e.from].label} → ${meta.label}` : meta.label}
              </span>
              <span className="text-faint" title={e.at}>
                {formatClock(e.at)} · {relativeTime(e.at, now)}
              </span>
            </div>
            {e.note && <div className="mt-0.5 text-[12px] leading-snug text-muted">{e.note}</div>}
          </li>
        )
      })}
    </ol>
  )
}
