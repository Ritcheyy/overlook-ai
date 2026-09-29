import { useEffect, useMemo, useState } from 'react'
import { ListChecks, Search } from 'lucide-react'
import { hasUpdates } from '@/lib/review'
import { selectInbox, selectMissions, useAppStore, type TriageFilter } from '@/state/store'
import { EmptyState } from '@/components/ui/EmptyState'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Segmented } from '@/components/ui/Segmented'
import { useNow } from '@/components/app/useNow'
import { DetailsPane } from './DetailsPane'
import { MissionList, groupReviews } from './MissionList'

export function TriageScreen() {
  const missions = useAppStore(selectMissions)
  const inbox = useAppStore(selectInbox)
  const selectedMissionId = useAppStore((s) => s.selectedMissionId)
  const selectedPrId = useAppStore((s) => s.selectedPrId)
  const filter = useAppStore((s) => s.triageFilter)
  const setFilter = useAppStore((s) => s.setTriageFilter)
  const selectMission = useAppStore((s) => s.selectMission)
  const navigate = useAppStore((s) => s.navigate)
  const [query, setQuery] = useState('')
  const now = useNow()

  const groups = useMemo(() => groupReviews(missions, filter, query), [missions, filter, query])
  const live = useMemo(() => missions.filter((m) => m.state !== 'closed'), [missions])
  const counts = useMemo(() => ({ needsYou: live.filter((m) => m.state === 'needs_you').length, updates: live.filter(hasUpdates).length }), [live])

  const byId = selectedMissionId ? missions.find((m) => m.id === selectedMissionId) : undefined
  const forPr = selectedPrId ? live.find((m) => m.prId === selectedPrId) : undefined
  const mission = forPr ?? byId
  const pr = mission?.pr ?? (selectedPrId ? inbox.find((p) => p.id === selectedPrId) : undefined)

  useEffect(() => {
    if (pr) return
    const first = groups.needsYou[0] ?? groups.failed[0] ?? groups.inProgress[0] ?? groups.watching[0]
    if (first) selectMission(first.id)
  }, [pr, groups, selectMission])

  return (
    <div className="flex h-full min-h-0">
      <aside className="flex w-[300px] shrink-0 flex-col border-r border-line bg-surface/40">
        <div className="flex h-[52px] shrink-0 items-center gap-2 border-b border-line px-4">
          <h1 className="text-[14px] font-semibold tracking-tight">Triage</h1>
          <span className="text-[12px] tabular-nums text-faint">{counts.needsYou} waiting</span>
        </div>
        <div className="flex shrink-0 flex-col gap-2 border-b border-line p-2.5">
          <Input leading={<Search />} size="sm" placeholder="Search reviews" aria-label="Search reviews" value={query} onChange={(e) => setQuery(e.target.value)} />
          <Segmented<TriageFilter>
            aria-label="Filter reviews"
            size="sm"
            value={filter}
            onChange={setFilter}
            options={[
              { value: 'all', label: 'All', count: live.length },
              { value: 'updates', label: 'Updates', count: counts.updates },
              { value: 'needs_you', label: 'Needs you', count: counts.needsYou }
            ]}
          />
        </div>
        {live.length === 0 ? (
          <EmptyState
            compact
            title="No reviews yet"
            description="Start a review from the Inbox and its findings land here."
            action={
              <Button size="sm" variant="secondary" onClick={() => navigate('inbox')}>
                Open inbox
              </Button>
            }
          />
        ) : groups.needsYou.length + groups.failed.length + groups.inProgress.length + groups.watching.length === 0 ? (
          <EmptyState
            compact
            title="Nothing matches"
            action={
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setQuery('')
                  setFilter('all')
                }}
              >
                Clear filters
              </Button>
            }
          />
        ) : (
          <MissionList groups={groups} selectedId={mission?.id} now={now} onSelect={selectMission} />
        )}
      </aside>
      <section className="flex min-w-0 flex-1 flex-col">
        {pr ? (
          <DetailsPane key={pr.id} pr={pr} mission={mission} />
        ) : (
          <EmptyState icon={<ListChecks />} title="Select a review" description="Reviews waiting for your decisions come first, then failures, running reviews and the ones being watched." className="h-full" />
        )}
      </section>
    </div>
  )
}
