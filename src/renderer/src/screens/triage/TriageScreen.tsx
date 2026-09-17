import { useEffect, useMemo } from 'react'
import { ListChecks } from 'lucide-react'
import type { Mission } from '@core/domain'
import { latestRound } from '@core/domain'
import { selectMissions, selectSettings, selectSlots, useAppStore } from '@/state/store'
import { EmptyState } from '@/components/ui/EmptyState'
import { Button } from '@/components/ui/Button'
import { useNow } from '@/components/app/useNow'
import { MissionList } from './MissionList'
import { ReviewPane } from './ReviewPane'
import { ClosedPane, FailedPane, ProgressPane, WatchingPane } from './panes'
import { byUpdatedDesc, loadoutFor, slotFor } from './shared'

function MissionPane({ mission }: { mission: Mission }) {
  const slots = useAppStore(selectSlots)
  const settings = useAppStore(selectSettings)
  const slot = slotFor(mission, slots)
  const loadout = loadoutFor(mission, settings)
  const round = latestRound(mission)
  switch (mission.state) {
    case 'needs_you':
    case 'posting':
      if (round) return <ReviewPane key={`${mission.id}-${round.id}`} mission={mission} round={round} slot={slot} loadout={loadout} readOnly={mission.state === 'posting'} />
      return <ProgressPane mission={mission} slot={slot} loadout={loadout} />
    case 'failed':
      return <FailedPane mission={mission} slot={slot} loadout={loadout} />
    case 'watching':
      return <WatchingPane mission={mission} slot={slot} loadout={loadout} />
    case 'closed':
      return <ClosedPane mission={mission} slot={slot} loadout={loadout} />
    default:
      return <ProgressPane mission={mission} slot={slot} loadout={loadout} />
  }
}

export function TriageScreen() {
  const missions = useAppStore(selectMissions)
  const slots = useAppStore(selectSlots)
  const selectedId = useAppStore((s) => s.selectedMissionId)
  const selectMission = useAppStore((s) => s.selectMission)
  const navigate = useAppStore((s) => s.navigate)
  const now = useNow()

  const groups = useMemo(() => {
    const needsYou = missions.filter((m) => m.state === 'needs_you').sort(byUpdatedDesc)
    const failed = missions.filter((m) => m.state === 'failed').sort(byUpdatedDesc)
    const recent = missions.filter((m) => m.state !== 'needs_you' && m.state !== 'failed').sort(byUpdatedDesc)
    return { needsYou, failed, recent }
  }, [missions])

  const selected = selectedId ? missions.find((m) => m.id === selectedId) : undefined

  useEffect(() => {
    if (selected) return
    const first = groups.needsYou[0] ?? groups.failed[0] ?? groups.recent[0]
    if (first) selectMission(first.id)
  }, [selected, groups, selectMission])

  return (
    <div className="flex h-full min-h-0">
      <aside className="flex w-[280px] shrink-0 flex-col border-r border-line bg-surface/40">
        <div className="flex h-[52px] shrink-0 items-center gap-2 border-b border-line px-4">
          <h1 className="text-[14px] font-semibold tracking-tight">Triage</h1>
          <span className="text-[12px] tabular-nums text-faint">{groups.needsYou.length} waiting</span>
        </div>
        {missions.length === 0 ? (
          <EmptyState
            compact
            title="Nothing to triage"
            description="Send a pull request to the floor from the inbox and its findings will land here."
            action={
              <Button size="sm" variant="secondary" onClick={() => navigate('inbox')}>
                Open inbox
              </Button>
            }
          />
        ) : (
          <MissionList {...groups} slots={slots} selectedId={selected?.id} now={now} onSelect={selectMission} />
        )}
      </aside>
      <section className="flex min-w-0 flex-1 flex-col">
        {selected ? (
          <MissionPane mission={selected} />
        ) : (
          <EmptyState
            icon={<ListChecks />}
            title="Select a mission"
            description="Reviews that finished and need your decisions appear on the left, newest first."
            className="h-full"
          />
        )}
      </section>
    </div>
  )
}
