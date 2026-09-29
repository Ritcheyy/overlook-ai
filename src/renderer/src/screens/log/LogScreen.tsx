import { useMemo, useState, type KeyboardEvent } from 'react'
import { ExternalLink, GitBranch, Github, ScrollText, X } from 'lucide-react'
import type { Mission, MissionState, ReviewRound } from '@core/domain'
import { latestRound } from '@core/domain'
import { api } from '@/lib/api'
import { cn } from '@/lib/cn'
import { formatDuration, formatUsd, plural, relativeTime, shortSha } from '@/lib/format'
import { verdictRound } from '@/lib/review'
import { selectMissions, selectSettings, selectSlots, useAppStore } from '@/state/store'
import { useActivityFor } from '@/components/app/useActivity'
import { ActivityLog } from '@/components/app/ActivityLog'
import { BriefingCard } from '@/components/app/BriefingCard'
import { Button } from '@/components/ui/Button'
import { Chip } from '@/components/ui/Chip'
import { ConfirmButton } from '@/components/ui/ConfirmButton'
import { EmptyState } from '@/components/ui/EmptyState'
import { IconButton } from '@/components/ui/IconButton'
import { RoundDetails } from '@/components/app/RoundDetails'
import { MISSION_STATES, MISSION_STATE_META, StateChip } from '@/components/app/StateChip'
import { GitHubDecision, VerdictLabel } from '@/components/app/PrMarkers'
import { useNow } from '@/components/app/useNow'
import { History } from '../triage/History'
import { loadoutFor, missionCost, slotFor } from '../triage/shared'

type Filter = MissionState | 'all'

function lastPostedRound(m: Mission): ReviewRound | undefined {
  return [...m.rounds].reverse().find((r) => r.postedAt || r.postedCommentUrl)
}

const TH = 'px-3 py-2 text-left text-[10.5px] font-semibold uppercase tracking-wider text-faint whitespace-nowrap'
const TD = 'px-3 py-2 align-middle whitespace-nowrap'

function LogRow({ mission, selected, now, onOpen, onClose }: { mission: Mission; selected: boolean; now: number; onOpen: () => void; onClose: () => void }) {
  const slots = useAppStore(selectSlots)
  const settings = useAppStore(selectSettings)
  const slot = slotFor(mission, slots)
  const loadout = loadoutFor(mission, settings)
  const round = latestRound(mission)
  const posted = lastPostedRound(mission)
  const cost = missionCost(mission)
  const approved = round?.findings.filter((f) => f.decision === 'approved').length ?? 0
  const dropped = round?.findings.filter((f) => f.decision === 'dropped').length ?? 0
  const verdict = verdictRound(mission)
  const onKey = (e: KeyboardEvent<HTMLTableRowElement>) => {
    // Enter on a button inside the row must activate that button, not the row.
    if (e.target !== e.currentTarget) return
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      onOpen()
    }
  }
  return (
    <tr
      tabIndex={0}
      aria-selected={selected}
      onClick={onOpen}
      onKeyDown={onKey}
      className={cn('cursor-pointer border-b border-line/60 outline-none transition-colors hover:bg-surface/70 focus-visible:bg-surface/70', selected && 'bg-raised')}
    >
      <td className={cn(TD, 'max-w-[380px] !whitespace-normal')}>
        <div className="flex min-w-0 items-center gap-2">
          <span className="shrink-0 font-mono text-[11.5px] text-faint">#{mission.pr.number}</span>
          <span className="min-w-0 truncate text-[12.5px] text-ink" title={mission.pr.title}>
            {mission.pr.title}
          </span>
        </div>
        <div className="mt-0.5 text-[11px] text-faint">{mission.pr.repo.fullName}</div>
      </td>
      <td className={TD}>
        {slot ? (
          <span className="inline-flex items-center gap-1.5 text-[12px] text-muted">
            <span className="h-2 w-2 rounded-full" style={{ background: slot.color }} aria-hidden />
            {slot.name}
          </span>
        ) : (
          <span className="text-faint">—</span>
        )}
      </td>
      <td className={cn(TD, 'text-[12px] text-muted')}>{loadout?.name ?? mission.loadoutId}</td>
      <td className={TD}>
        <StateChip state={mission.state} />
      </td>
      <td className={TD}>{verdict ? <VerdictLabel verdict={verdict.verdict} title={`Round ${verdict.index}`} /> : <span className="text-faint">—</span>}</td>
      <td className={cn(TD, 'text-[12px] tabular-nums text-muted')}>{mission.rounds.length}</td>
      <td className={cn(TD, 'text-[12px] tabular-nums')} title={round ? `${approved} approved, ${dropped} dropped, ${round.findings.length} total` : undefined}>
        {round ? (
          <>
            <span className={approved > 0 ? 'text-lime' : 'text-faint'}>{approved}</span>
            <span className="text-faint"> / </span>
            <span className={dropped > 0 ? 'text-muted' : 'text-faint'}>{dropped}</span>
          </>
        ) : (
          <span className="text-faint">—</span>
        )}
      </td>
      <td className={cn(TD, 'text-[12px] text-muted')}>
        {posted ? (
          <span className="inline-flex items-center gap-1">
            <span title={posted.postedAt}>{relativeTime(posted.postedAt, now)}</span>
            {posted.postedCommentUrl && (
              <IconButton
                size="sm"
                aria-label="Open posted comment"
                onClick={(e) => {
                  e.stopPropagation()
                  void api.openExternal(posted.postedCommentUrl!)
                }}
              >
                <ExternalLink />
              </IconButton>
            )}
          </span>
        ) : (
          <span className="text-faint">—</span>
        )}
      </td>
      <td className={cn(TD, 'text-[12px] tabular-nums text-muted')}>{cost !== undefined ? formatUsd(cost) : <span className="text-faint">—</span>}</td>
      <td className={cn(TD, 'text-[11.5px] text-muted')}>
        {round?.model ? (
          <span className="block max-w-[160px] truncate font-mono" title={round.effort ? `${round.model} · effort ${round.effort}` : round.model}>
            {round.model}
          </span>
        ) : (
          <span className="text-faint">—</span>
        )}
      </td>
      <td className={cn(TD, 'text-right')} onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
        <span className="inline-flex items-center gap-1">
          <IconButton size="sm" aria-label={`Open #${mission.pr.number} on GitHub`} onClick={() => void api.openExternal(mission.pr.url)}>
            <Github />
          </IconButton>
          {mission.state !== 'closed' && (
            <ConfirmButton size="sm" variant="ghost" confirmLabel="Close?" onConfirm={onClose}>
              Close
            </ConfirmButton>
          )}
        </span>
      </td>
    </tr>
  )
}

function Drawer({ mission, now, onDismiss }: { mission: Mission; now: number; onDismiss: () => void }) {
  const openDetails = useAppStore((s) => s.openDetails)
  const round = latestRound(mission)
  const activity = useActivityFor(mission.id, round?.activity)
  const verdict = verdictRound(mission)
  const { pr } = mission
  return (
    <aside className="flex w-[380px] shrink-0 flex-col border-l border-line bg-surface/40" aria-label="Review details">
      <div className="flex h-[52px] shrink-0 items-center gap-2 border-b border-line px-4">
        <StateChip state={mission.state} />
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium" title={mission.pr.title}>
          #{mission.pr.number} {mission.pr.title}
        </span>
        <IconButton size="sm" aria-label="Close details" onClick={onDismiss}>
          <X />
        </IconButton>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto px-4 py-4">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-muted">
          <span className="text-ink/90">@{pr.author}</span>
          <span aria-hidden>·</span>
          <span className="inline-flex min-w-0 items-center gap-1 font-mono text-[11.5px]">
            <GitBranch className="h-3 w-3 shrink-0 text-faint" aria-hidden />
            <span className="truncate">{pr.headRef}</span>
            <span className="text-faint">→</span>
            <span>{pr.baseRef}</span>
          </span>
          <span aria-hidden>·</span>
          <span className="font-mono tabular-nums">
            <span className="text-lime/80">+{pr.additions ?? 0}</span> <span className="text-rose/80">−{pr.deletions ?? 0}</span>
          </span>
          {verdict && <VerdictLabel verdict={verdict.verdict} />}
          <GitHubDecision decision={pr.reviewDecision} />
        </div>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-muted">
          <span className="font-mono">{mission.pr.repo.fullName}</span>
          <span aria-hidden>·</span>
          <span className="font-mono">{shortSha(round?.headSha ?? mission.pr.headSha)}</span>
          {round && (
            <>
              <span aria-hidden>·</span>
              <span>Round {round.index}</span>
            </>
          )}
          {round?.workspaceName && (
            <>
              <span aria-hidden>·</span>
              <span>Workspace: {round.workspaceName}</span>
            </>
          )}
          {mission.worktreePath && (
            <>
              <span aria-hidden>·</span>
              <button type="button" className="truncate font-mono hover:text-accent" title={mission.worktreePath} onClick={() => void api.openPath(mission.worktreePath!)}>
                worktree
              </button>
            </>
          )}
        </div>
        {mission.error && (
          <div className="rounded-md border border-rose/30 bg-rose/10 px-3 py-2 font-mono text-[11.5px] leading-relaxed text-rose" role="alert">
            {mission.error}
          </div>
        )}
        <div className="flex items-center gap-2">
          {mission.state !== 'closed' && (
            <Button size="sm" variant="secondary" onClick={() => openDetails({ missionId: mission.id })}>
              Open in Triage
            </Button>
          )}
          <Button size="sm" variant="ghost" icon={<Github className="h-3.5 w-3.5" />} onClick={() => void api.openExternal(pr.url)}>
            View on GitHub
          </Button>
        </div>
        <BriefingCard round={round} />
        {round && <RoundDetails round={round} />}
        {mission.rounds.length > 0 && (
          <div className="flex flex-col gap-2">
            <div className="text-[10.5px] font-semibold uppercase tracking-wider text-faint">Rounds</div>
            <ul className="flex flex-col gap-1" aria-label="Rounds">
              {mission.rounds.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center gap-x-1.5 text-[11.5px] text-muted">
                  <span className="text-ink">Round {r.index}</span>
                  <span className="font-mono" title={r.headSha}>
                    {shortSha(r.headSha)}
                  </span>
                  {r.model && (
                    <>
                      <span aria-hidden>·</span>
                      <span className="font-mono">{r.model}</span>
                    </>
                  )}
                  {r.effort && (
                    <>
                      <span aria-hidden>·</span>
                      <span>effort {r.effort}</span>
                    </>
                  )}
                  {r.costUsd !== undefined && (
                    <>
                      <span aria-hidden>·</span>
                      <span className="tabular-nums">{formatUsd(r.costUsd)}</span>
                    </>
                  )}
                  {r.durationMs !== undefined && (
                    <>
                      <span aria-hidden>·</span>
                      <span className="tabular-nums">{formatDuration(r.durationMs)}</span>
                    </>
                  )}
                  {r.postedCommentUrl && (
                    <IconButton size="sm" aria-label={`Open round ${r.index} comment on GitHub`} onClick={() => void api.openExternal(r.postedCommentUrl!)}>
                      <ExternalLink />
                    </IconButton>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="flex flex-col gap-2">
          <div className="text-[10.5px] font-semibold uppercase tracking-wider text-faint">History</div>
          <History mission={mission} now={now} />
        </div>
        <div className="flex flex-col gap-2">
          <div className="text-[10.5px] font-semibold uppercase tracking-wider text-faint">Activity</div>
          <ActivityLog items={activity} className="max-h-[300px]" follow={false} />
        </div>
      </div>
    </aside>
  )
}

export function LogScreen() {
  const missions = useAppStore(selectMissions)
  const selectedId = useAppStore((s) => s.selectedMissionId)
  const selectMission = useAppStore((s) => s.selectMission)
  const pushToast = useAppStore((s) => s.pushToast)
  const [filter, setFilter] = useState<Filter>('all')
  const [drawerId, setDrawerId] = useState<string | undefined>()
  const now = useNow()

  const sorted = useMemo(() => [...missions].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)), [missions])
  const counts = useMemo(() => {
    const c: Partial<Record<MissionState, number>> = {}
    for (const m of missions) c[m.state] = (c[m.state] ?? 0) + 1
    return c
  }, [missions])
  const rows = filter === 'all' ? sorted : sorted.filter((m) => m.state === filter)
  const drawer = drawerId ? missions.find((m) => m.id === drawerId) : undefined

  const open = (m: Mission) => {
    selectMission(m.id)
    setDrawerId(m.id)
  }
  const close = async (m: Mission) => {
    try {
      await api.closeMission(m.id)
    } catch (e) {
      pushToast({ kind: 'error', title: 'Close review failed', body: (e as Error).message })
    }
  }

  return (
    <div className="flex h-full min-h-0">
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-[52px] shrink-0 items-center gap-3 border-b border-line px-5">
          <h1 className="text-[14px] font-semibold tracking-tight">Log</h1>
          <span className="text-[12px] tabular-nums text-faint">{plural(rows.length, 'review')}</span>
          <span className="text-[11.5px] text-faint">newest activity first</span>
          <div className="flex-1" />
          <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Filter by state">
            <Chip tone={filter === 'all' ? 'neutral' : 'faint'} size="sm" aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>
              All <span className="tabular-nums opacity-70">{missions.length}</span>
            </Chip>
            {MISSION_STATES.filter((s) => counts[s]).map((s) => (
              <Chip
                key={s}
                size="sm"
                dot
                tone={filter === s ? MISSION_STATE_META[s].tone : 'faint'}
                aria-pressed={filter === s}
                onClick={() => setFilter(filter === s ? 'all' : s)}
              >
                {MISSION_STATE_META[s].label} <span className="tabular-nums opacity-70">{counts[s]}</span>
              </Chip>
            ))}
          </div>
        </header>
        <div className="min-h-0 flex-1 overflow-auto">
          {missions.length === 0 ? (
            <EmptyState icon={<ScrollText />} title="No reviews yet" description="Every review, its rounds, and what was posted will be listed here." />
          ) : rows.length === 0 ? (
            <EmptyState compact title="No reviews in this state" action={<Button size="sm" variant="ghost" onClick={() => setFilter('all')}>Show all</Button>} />
          ) : (
            <table className="w-full min-w-[860px] border-collapse">
              <thead className="sticky top-0 z-10 bg-bg shadow-[inset_0_-1px_0_rgb(var(--line))]">
                <tr>
                  <th className={TH}>Pull request</th>
                  <th className={TH}>Reviewer</th>
                  <th className={TH}>Review type</th>
                  <th className={TH}>State</th>
                  <th className={TH}>Verdict</th>
                  <th className={TH}>Rounds</th>
                  <th className={TH} title="Findings approved and dropped in the latest round">
                    Approved / dropped
                  </th>
                  <th className={TH}>Last posted</th>
                  <th className={TH}>Cost</th>
                  <th className={TH}>Model</th>
                  <th className={TH}>
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((m) => (
                  <LogRow key={m.id} mission={m} selected={m.id === selectedId} now={now} onOpen={() => open(m)} onClose={() => void close(m)} />
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
      {drawer && <Drawer mission={drawer} now={now} onDismiss={() => setDrawerId(undefined)} />}
    </div>
  )
}
