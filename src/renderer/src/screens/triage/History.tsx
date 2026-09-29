import { ChevronRight } from 'lucide-react'
import type { Mission } from '@core/domain'
import { cn } from '@/lib/cn'
import { formatClock, relativeTime } from '@/lib/format'
import { DOT_TONE } from '@/components/ui/Chip'
import { MISSION_STATE_META } from '@/components/app/StateChip'
import { groupTimeline } from './timeline-groups'

/** The timeline grouped by round, newest first, only the latest open. */
export function History({ mission, now }: { mission: Pick<Mission, 'timeline' | 'rounds'>; now: number }) {
  const groups = groupTimeline(mission).reverse()
  if (groups.length === 0) return <div className="text-[12px] text-faint">No events yet.</div>
  return (
    <div className="flex flex-col gap-1" aria-label="History">
      {groups.map((g, i) => (
        <details key={g.key} className="group" open={i === 0}>
          <summary className="flex cursor-pointer select-none list-none items-center gap-1.5 rounded px-1 py-1 text-[12px] hover:bg-raised/60 [&::-webkit-details-marker]:hidden">
            <ChevronRight className="h-3 w-3 shrink-0 text-faint transition-transform group-open:rotate-90" aria-hidden />
            <span className="font-medium text-ink">{g.label}</span>
            <span className="truncate text-faint" title={g.events[0].at}>
              {relativeTime(g.events[0].at, now)}
            </span>
          </summary>
          <ol className="ml-2.5 border-l border-line pb-1 pl-3">
            {g.events.map((e, j) => {
              const meta = MISSION_STATE_META[e.to]
              return (
                <li key={`${e.at}-${j}`} className="relative py-0.5 text-[11.5px]">
                  <span className={cn('absolute -left-[16.5px] top-[7px] h-1.5 w-1.5 rounded-full ring-2 ring-bg', DOT_TONE[meta.tone])} aria-hidden />
                  <span className="text-faint" title={e.at}>
                    {formatClock(e.at)}
                  </span>{' '}
                  <span className="text-ink/90">{e.from && e.from !== e.to ? meta.label : e.note ? '' : meta.label}</span>
                  {e.note && <span className="text-muted">{e.from && e.from !== e.to ? ` · ${e.note}` : e.note}</span>}
                </li>
              )
            })}
          </ol>
        </details>
      ))}
    </div>
  )
}
