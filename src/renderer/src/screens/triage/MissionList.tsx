import type { Mission, MissionState } from '@core/domain'
import { cn } from '@/lib/cn'
import { relativeTime } from '@/lib/format'
import { hasUpdates, repoShortName } from '@/lib/review'
import type { TriageFilter } from '@/state/store'
import { PrMarkers } from '@/components/app/PrMarkers'
import { StateChip } from '@/components/app/StateChip'

const IN_PROGRESS: readonly MissionState[] = ['queued', 'preparing', 'reviewing', 'posting']

function matches(m: Mission, q: string): boolean {
  if (!q) return true
  const hay = [`#${m.pr.number}`, m.pr.title, m.pr.author, m.pr.repo.fullName, m.pr.headRef].join(' ').toLowerCase()
  return q
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((term) => hay.includes(term))
}

const byUpdatedDesc = (a: Mission, b: Mission) => b.updatedAt.localeCompare(a.updatedAt)

export interface ReviewGroups {
  needsYou: Mission[]
  failed: Mission[]
  inProgress: Mission[]
  watching: Mission[]
}

/** Live reviews by what they need; closed ones live in the Log. Watched reviews with a push or reply come first. */
export function groupReviews(missions: readonly Mission[], filter: TriageFilter, query: string): ReviewGroups {
  const q = query.trim()
  const live = missions.filter((m) => m.state !== 'closed' && matches(m, q))
  const shown = filter === 'updates' ? live.filter(hasUpdates) : filter === 'needs_you' ? live.filter((m) => m.state === 'needs_you') : live
  return {
    needsYou: shown.filter((m) => m.state === 'needs_you').sort(byUpdatedDesc),
    failed: shown.filter((m) => m.state === 'failed').sort(byUpdatedDesc),
    inProgress: shown.filter((m) => IN_PROGRESS.includes(m.state)).sort(byUpdatedDesc),
    watching: shown
      .filter((m) => m.state === 'watching')
      .sort((a, b) => Number(hasUpdates(b)) - Number(hasUpdates(a)) || byUpdatedDesc(a, b))
  }
}

function Row({ mission, selected, now, onSelect, showState }: { mission: Mission; selected: boolean; now: number; onSelect: () => void; showState: boolean }) {
  const { pr } = mission
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
        <div className="flex w-full items-start gap-1.5">
          <span className="mt-px shrink-0 font-mono text-[11px] text-faint">#{pr.number}</span>
          <span className="line-clamp-2 min-w-0 flex-1 text-[12.5px] leading-snug text-ink">{pr.title}</span>
          {showState && <StateChip state={mission.state} />}
        </div>
        <div className="flex w-full items-center gap-1.5 text-[11px] text-faint">
          <span className="min-w-0 truncate">
            <span className="text-muted">{repoShortName(pr.repo.fullName)}</span> · {pr.author}
          </span>
          <span className="ml-auto shrink-0" title={mission.updatedAt}>
            {relativeTime(mission.updatedAt, now)}
          </span>
        </div>
        <PrMarkers pr={pr} mission={mission} className="text-[11px]" />
      </button>
    </li>
  )
}

function Group({ label, tone, missions, selectedId, now, onSelect, showState }: { label: string; tone: string; missions: Mission[]; selectedId?: string; now: number; onSelect: (id: string) => void; showState?: boolean }) {
  if (missions.length === 0) return null
  return (
    <section aria-label={label}>
      <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-line bg-bg/95 px-3 py-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-faint backdrop-blur">
        <span className={cn('h-1.5 w-1.5 rounded-full', tone)} aria-hidden />
        <span>{label}</span>
        <span className="font-normal tabular-nums text-faint/70">{missions.length}</span>
      </div>
      <ul>
        {missions.map((m) => (
          <Row key={m.id} mission={m} selected={m.id === selectedId} now={now} onSelect={() => onSelect(m.id)} showState={!!showState} />
        ))}
      </ul>
    </section>
  )
}

export interface MissionListProps {
  groups: ReviewGroups
  selectedId?: string
  now: number
  onSelect: (id: string) => void
}

export function MissionList({ groups, selectedId, now, onSelect }: MissionListProps) {
  const common = { selectedId, now, onSelect }
  return (
    <nav className="min-h-0 flex-1 overflow-auto" aria-label="Reviews">
      <Group label="Needs you" tone="bg-amber" missions={groups.needsYou} {...common} />
      <Group label="Failed" tone="bg-rose" missions={groups.failed} {...common} />
      <Group label="In progress" tone="bg-accent" missions={groups.inProgress} showState {...common} />
      <Group label="Watching" tone="bg-teal" missions={groups.watching} {...common} />
    </nav>
  )
}
