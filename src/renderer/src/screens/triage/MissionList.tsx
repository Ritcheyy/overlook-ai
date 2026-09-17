import { useEffect, useState } from 'react'
import { ChevronRight } from 'lucide-react'
import type { Mission, Slot } from '@core/domain'
import { latestRound } from '@core/domain'
import { cn } from '@/lib/cn'
import { plural, relativeTime } from '@/lib/format'
import { Chip } from '@/components/ui/Chip'
import { StateChip } from '@/components/app/StateChip'
import { slotFor } from './shared'

interface ItemProps {
  mission: Mission
  slots: Slot[]
  selected: boolean
  now: number
  onSelect: () => void
}

function MissionListItem({ mission, slots, selected, now, onSelect }: ItemProps) {
  const slot = slotFor(mission, slots)
  const round = latestRound(mission)
  const showState = mission.state !== 'needs_you' && mission.state !== 'failed'
  return (
    <li>
      <button
        type="button"
        aria-current={selected ? 'true' : undefined}
        onClick={onSelect}
        className={cn(
          'flex w-full flex-col gap-1 border-b border-line/60 px-3 py-2 text-left transition-colors',
          selected ? 'bg-raised shadow-[inset_2px_0_0_rgb(var(--accent))]' : 'hover:bg-surface'
        )}
      >
        <div className="flex w-full items-center gap-1.5">
          <span className="shrink-0 font-mono text-[11px] text-faint">#{mission.pr.number}</span>
          <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink">{mission.pr.title}</span>
          {mission.stale && <Chip tone="amber">new push</Chip>}
          {showState && <StateChip state={mission.state} />}
        </div>
        <div className="flex w-full items-center gap-2 text-[11px] text-faint">
          <span className="min-w-0 truncate">{mission.pr.repo.fullName}</span>
          {slot && (
            <span className="inline-flex shrink-0 items-center gap-1">
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: slot.color }} aria-hidden />
              {slot.name}
            </span>
          )}
          {round && (
            <span className="shrink-0">
              R{round.index} · {plural(round.findings.length, 'finding')}
            </span>
          )}
          <span className="ml-auto shrink-0" title={mission.updatedAt}>
            {relativeTime(mission.updatedAt, now)}
          </span>
        </div>
      </button>
    </li>
  )
}

function GroupHeader({ label, count, tone }: { label: string; count: number; tone?: string }) {
  return (
    <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-line bg-bg/95 px-3 py-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-faint backdrop-blur">
      {tone && <span className={cn('h-1.5 w-1.5 rounded-full', tone)} aria-hidden />}
      <span>{label}</span>
      <span className="font-normal tabular-nums text-faint/70">{count}</span>
    </div>
  )
}

export interface MissionListProps {
  needsYou: Mission[]
  failed: Mission[]
  recent: Mission[]
  slots: Slot[]
  selectedId?: string
  now: number
  onSelect: (id: string) => void
}

export function MissionList({ needsYou, failed, recent, slots, selectedId, now, onSelect }: MissionListProps) {
  const [recentOpen, setRecentOpen] = useState(false)
  const selectedInRecent = recent.some((m) => m.id === selectedId)
  // Reveal a selection that lands in Recent, but let the user collapse the group afterwards.
  useEffect(() => {
    if (selectedInRecent) setRecentOpen(true)
  }, [selectedId, selectedInRecent])
  const item = (m: Mission) => <MissionListItem key={m.id} mission={m} slots={slots} selected={m.id === selectedId} now={now} onSelect={() => onSelect(m.id)} />
  return (
    <nav className="min-h-0 flex-1 overflow-auto" aria-label="Missions">
      {needsYou.length > 0 && (
        <section aria-label="Needs you">
          <GroupHeader label="Needs you" count={needsYou.length} tone="bg-amber" />
          <ul>{needsYou.map(item)}</ul>
        </section>
      )}
      {failed.length > 0 && (
        <section aria-label="Failed">
          <GroupHeader label="Failed" count={failed.length} tone="bg-rose" />
          <ul>{failed.map(item)}</ul>
        </section>
      )}
      {recent.length > 0 && (
        <section aria-label="Recent">
          <button
            type="button"
            aria-expanded={recentOpen}
            onClick={() => setRecentOpen((o) => !o)}
            className="sticky top-0 z-10 flex w-full items-center gap-1.5 border-b border-line bg-bg/95 px-3 py-1.5 text-left text-[10.5px] font-semibold uppercase tracking-wider text-faint backdrop-blur hover:text-muted"
          >
            <ChevronRight className={cn('h-3 w-3 transition-transform', recentOpen && 'rotate-90')} aria-hidden />
            <span>Recent</span>
            <span className="font-normal tabular-nums text-faint/70">{recent.length}</span>
          </button>
          {recentOpen && <ul>{recent.map(item)}</ul>}
        </section>
      )}
    </nav>
  )
}
