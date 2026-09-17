import type { ReactNode } from 'react'
import { ExternalLink, GitCommitHorizontal, Play, Radar, RotateCcw, Square, TriangleAlert } from 'lucide-react'
import type { Loadout, Mission, ReviewRound, Slot } from '@core/domain'
import { latestRound } from '@core/domain'
import { api } from '@/lib/api'
import { formatUsd, plural, relativeTime, shortSha } from '@/lib/format'
import { selectLastActivityFor, selectSettings, useAppStore } from '@/state/store'
import { useActivityFor } from '@/components/app/useActivity'
import { ActivityLog } from '@/components/app/ActivityLog'
import { BriefingCard } from '@/components/app/BriefingCard'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { ConfirmButton } from '@/components/ui/ConfirmButton'
import { Markdown } from '@/components/ui/Markdown'
import { RoundDetails } from '@/components/app/RoundDetails'
import { StateChip } from '@/components/app/StateChip'
import { Timeline } from '@/components/app/Timeline'
import { Toggle } from '@/components/ui/Toggle'
import { useNow } from '@/components/app/useNow'
import { MissionHeader } from './MissionHeader'
import { RerunControl } from './RerunControl'
import { VerdictChip } from './ReviewPane'
import { missionCost } from './shared'
import { useMissionActions } from './useMissionActions'

interface PaneProps {
  mission: Mission
  slot?: Slot
  loadout?: Loadout
}

function SectionLabel({ children }: { children: string }) {
  return <div className="text-[10.5px] font-semibold uppercase tracking-wider text-faint">{children}</div>
}

function Body({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <div className="mx-auto flex max-w-[920px] flex-col gap-4 px-5 py-4">{children}</div>
    </div>
  )
}

export function FailedPane({ mission, slot, loadout }: PaneProps) {
  const actions = useMissionActions()
  const round = latestRound(mission)
  const activity = useActivityFor(mission.id, round?.activity)
  const error = mission.error ?? round?.error ?? 'Unknown error'
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <MissionHeader
        mission={mission}
        round={round}
        slot={slot}
        loadout={loadout}
        actions={
          <>
            <ConfirmButton size="sm" variant="ghost" confirmLabel="Close and remove worktree?" onConfirm={() => void actions.close(mission.id)}>
              Close
            </ConfirmButton>
            <RerunControl mission={mission} />
            <Button
              size="sm"
              variant="primary"
              icon={<RotateCcw className="h-3.5 w-3.5" />}
              title="Queue again with the same loadout"
              onClick={() => void actions.retry(mission.id)}
            >
              Retry
            </Button>
          </>
        }
      />
      <Body>
        <div className="flex items-start gap-3 rounded-lg border border-rose/30 bg-rose/10 px-3.5 py-3" role="alert">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-rose" aria-hidden />
          <div className="min-w-0">
            <div className="text-[12.5px] font-medium text-rose">The mission failed</div>
            <pre className="mt-1 whitespace-pre-wrap break-words font-mono text-[12px] leading-relaxed text-ink/85">{error}</pre>
          </div>
        </div>
        <BriefingCard round={round} />
        {round && <RoundDetails round={round} />}
        <div className="flex flex-col gap-2">
          <SectionLabel>Activity</SectionLabel>
          <ActivityLog items={activity} className="max-h-[320px]" follow={false} />
        </div>
        <div className="flex flex-col gap-2">
          <SectionLabel>Timeline</SectionLabel>
          <Card>
            <Timeline events={mission.timeline} />
          </Card>
        </div>
      </Body>
    </div>
  )
}

function PostedComment({ round, now }: { round: ReviewRound; now: number }) {
  const approved = round.findings.filter((f) => f.decision === 'approved').length
  return (
    <Card padded={false}>
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-3.5 py-2 text-[12px] text-muted">
        <span className="text-[10.5px] font-semibold uppercase tracking-wider text-faint">Posted comment</span>
        <span>Round {round.index}</span>
        <span aria-hidden>·</span>
        <span>{plural(approved, 'finding')}</span>
        {round.postedAt && (
          <>
            <span aria-hidden>·</span>
            <span title={round.postedAt}>{relativeTime(round.postedAt, now)}</span>
          </>
        )}
        <div className="flex-1" />
        <VerdictChip verdict={round.verdict} />
        {round.postedCommentUrl && (
          <Button size="sm" variant="ghost" icon={<ExternalLink className="h-3.5 w-3.5" />} onClick={() => void api.openExternal(round.postedCommentUrl!)}>
            View on GitHub
          </Button>
        )}
      </div>
      <div className="px-3.5 py-3">
        {round.postedBody ? (
          <Markdown>{round.postedBody}</Markdown>
        ) : (
          <p className="text-[12.5px] text-muted">{round.summary}</p>
        )}
      </div>
    </Card>
  )
}

export function WatchingPane({ mission, slot, loadout }: PaneProps) {
  const actions = useMissionActions()
  const settings = useAppStore(selectSettings)
  const now = useNow()
  const round = latestRound(mission)
  const posted = [...mission.rounds].reverse().filter((r) => r.postedAt || r.postedBody)
  const autoRoundsUsed = Math.max(0, mission.rounds.length - 1)
  const cost = missionCost(mission)
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <MissionHeader
        mission={mission}
        round={round}
        slot={slot}
        loadout={loadout}
        actions={
          <>
            <ConfirmButton size="sm" variant="ghost" confirmLabel="Close and remove worktree?" onConfirm={() => void actions.close(mission.id)}>
              Close mission
            </ConfirmButton>
            <RerunControl mission={mission} variant="secondary" />
          </>
        }
      />
      <Body>
        <div className="flex items-center gap-3 rounded-lg border border-teal/30 bg-teal/10 px-3.5 py-2.5 text-[12.5px] text-teal" role="status">
          <Radar className="h-4 w-4 shrink-0 animate-pulse-soft" aria-hidden />
          <span>
            Watching for pushes. When the author pushes, this mission re-queues for a follow-up round on the delta; the worktree stays warm until the PR
            is merged or closed.
          </span>
        </div>
        {mission.stale && (
          <div className="flex items-center gap-3 rounded-lg border border-amber/30 bg-amber/10 px-3.5 py-2.5 text-[12.5px] text-amber" role="status">
            <GitCommitHorizontal className="h-4 w-4 shrink-0" aria-hidden />
            <span className="flex-1">
              The author pushed <span className="font-mono">{shortSha(mission.pr.headSha)}</span> and automatic follow-up is paused. Re-run to review the delta.
            </span>
            <Button size="sm" variant="secondary" icon={<RotateCcw className="h-3.5 w-3.5" />} onClick={() => void actions.rerun(mission.id)}>
              Re-run
            </Button>
          </div>
        )}
        <Card className="flex items-start gap-3">
          <Toggle
            aria-label="Re-review automatically when the author pushes"
            checked={mission.autoFollowUp !== false}
            onChange={(enabled) => void actions.setAutoFollowUp(mission.id, enabled)}
            className="mt-0.5"
          />
          <div className="min-w-0 flex-1">
            <div className="text-[13px] text-ink">Re-review automatically when the author pushes</div>
            <div className="mt-0.5 text-[11.5px] tabular-nums text-faint">
              {autoRoundsUsed} of {settings?.maxAutoRoundsPerMission ?? 0} automatic rounds used
              {cost !== undefined && ` · ${formatUsd(cost)} spent across ${plural(mission.rounds.length, 'round')}`}
            </div>
          </div>
        </Card>
        <BriefingCard round={round} />
        {posted.length === 0 && round ? (
          <Card>
            <div className="flex items-center gap-2">
              <SectionLabel>Latest round</SectionLabel>
              <div className="flex-1" />
              <VerdictChip verdict={round.verdict} />
            </div>
            <p className="mt-2 text-[13px] leading-relaxed text-ink/90">{round.summary}</p>
          </Card>
        ) : (
          posted.map((r) => <PostedComment key={r.id} round={r} now={now} />)
        )}
      </Body>
    </div>
  )
}

export function ProgressPane({ mission, slot, loadout }: PaneProps) {
  const actions = useMissionActions()
  const activity = useActivityFor(mission.id)
  const last = useAppStore(selectLastActivityFor(mission.id))
  const round = latestRound(mission)
  const cancellable = mission.state !== 'posting'
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <MissionHeader
        mission={mission}
        round={round}
        slot={slot}
        loadout={loadout}
        actions={
          cancellable ? (
            <ConfirmButton size="sm" variant="ghost" confirmLabel="Abort the mission?" icon={<Square className="h-3 w-3" />} onConfirm={() => void actions.cancel(mission.id)}>
              Cancel
            </ConfirmButton>
          ) : undefined
        }
      />
      <Body>
        <Card className="flex items-center gap-3">
          <StateChip state={mission.state} size="sm" />
          <span className="min-w-0 flex-1 truncate text-[12.5px] text-muted">
            {mission.state === 'queued'
              ? 'Waiting on the shelf for a free character.'
              : (last?.text ?? (mission.state === 'posting' ? 'Sending the comment to GitHub.' : 'Working…'))}
          </span>
          {mission.state !== 'queued' && <Play className="h-3.5 w-3.5 text-accent animate-pulse-soft" aria-hidden />}
        </Card>
        <div className="flex flex-col gap-2">
          <SectionLabel>Activity</SectionLabel>
          <ActivityLog items={activity} className="max-h-[420px]" emptyText="Waiting for the first activity line…" />
        </div>
      </Body>
    </div>
  )
}

export function ClosedPane({ mission, slot, loadout }: PaneProps) {
  const round = latestRound(mission)
  const lastEvent = mission.timeline[mission.timeline.length - 1]
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <MissionHeader mission={mission} round={round} slot={slot} loadout={loadout} />
      <Body>
        <Card className="text-[12.5px] text-muted">
          Mission closed{lastEvent?.note ? ` (${lastEvent.note}).` : '.'}{' '}
          {mission.error ? (
            <span className="text-rose">{mission.error}</span>
          ) : mission.worktreePath ? (
            <>
              The worktree is still at <span className="font-mono">{mission.worktreePath}</span>.
            </>
          ) : (
            'The worktree has been removed.'
          )}
        </Card>
        {round && (
          <Card>
            <div className="flex items-center gap-2">
              <SectionLabel>Last round</SectionLabel>
              <div className="flex-1" />
              <VerdictChip verdict={round.verdict} />
            </div>
            <p className="mt-2 text-[13px] leading-relaxed text-ink/90">{round.summary}</p>
          </Card>
        )}
        <div className="flex flex-col gap-2">
          <SectionLabel>Timeline</SectionLabel>
          <Card>
            <Timeline events={mission.timeline} />
          </Card>
        </div>
      </Body>
    </div>
  )
}
