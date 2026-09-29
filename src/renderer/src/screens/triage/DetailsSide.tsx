import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { Folder } from 'lucide-react'
import type { Mission, PullRequest, ReviewRound, Settings, Slot } from '@core/domain'
import { autoRoundsUsed } from '@core/domain'
import { applyRunOptions } from '@core/engine/run-options'
import { api } from '@/lib/api'
import { cn } from '@/lib/cn'
import { formatUsd } from '@/lib/format'
import { Card } from '@/components/ui/Card'
import { Markdown } from '@/components/ui/Markdown'
import { Toggle } from '@/components/ui/Toggle'
import { History } from './History'
import { SectionLabel } from './RoundView'
import { missionCost, slotFor } from './shared'
import { useMissionActions } from './useMissionActions'

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[88px_minmax(0,1fr)] items-baseline gap-2 py-1 text-[12px]">
      <span className="text-faint">{label}</span>
      <span className="min-w-0 text-ink/90">{children}</span>
    </div>
  )
}

/** The model behind the round on screen; before the first round, what the run will ask the CLI for. */
function ModelFact({ mission, round, settings }: { mission: Mission; round?: ReviewRound; settings: Settings }) {
  let model = round?.model
  let effort = round?.effort
  if (!round) {
    const next = applyRunOptions(settings, mission.runOptions)
    model = next.claudeModel || 'default'
    effort = next.claudeEffort ?? 'default'
  }
  if (!model) return null
  const older = !!round && round.id !== mission.rounds[mission.rounds.length - 1]?.id
  return (
    <Fact label="Model">
      <span className="break-words">{model}</span>
      {effort && (
        <>
          {' '}
          <span className="whitespace-nowrap text-faint">· effort {effort}</span>
        </>
      )}
      {older && (
        <>
          {' '}
          <span className="whitespace-nowrap text-faint">· round {round.index}</span>
        </>
      )}
    </Fact>
  )
}

function ReviewFacts({ mission, round, settings, slots }: { mission: Mission; round?: ReviewRound; settings: Settings; slots: Slot[] }) {
  const actions = useMissionActions()
  const slot = slotFor(mission, slots)
  const loadout = settings.loadouts.find((l) => l.id === mission.loadoutId)
  const cost = missionCost(mission)
  const workspace = [...mission.rounds].reverse().find((r) => r.workspaceName)?.workspaceName
  const max = settings.maxAutoRoundsPerMission
  const used = autoRoundsUsed(mission)
  return (
    <Card aria-label="Review">
      <SectionLabel>Review</SectionLabel>
      <div className="mt-1.5">
        <Fact label="Reviewer">
          {slot ? (
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full" style={{ background: slot.color }} aria-hidden />
              {slot.name}
            </span>
          ) : (
            <span className="text-faint">Not assigned yet</span>
          )}
        </Fact>
        <Fact label="Review type">{loadout?.name ?? mission.loadoutId}</Fact>
        <ModelFact mission={mission} round={round} settings={settings} />
        <Fact label="Rounds">
          {mission.rounds.length}
          {cost !== undefined && <span className="text-faint"> · {formatUsd(cost)} in total</span>}
        </Fact>
        {workspace && <Fact label="Workspace">{workspace}</Fact>}
        <Fact label="Posting">{mission.autoPost ? 'Posts without triage' : 'Stops for your decisions'}</Fact>
        {mission.worktreePath && (
          <Fact label="Worktree">
            <button type="button" className="inline-flex max-w-full items-center gap-1 truncate font-mono text-[11.5px] text-muted hover:text-accent" title={mission.worktreePath} onClick={() => void api.openPath(mission.worktreePath!)}>
              <Folder className="h-3 w-3 shrink-0" aria-hidden />
              <span className="truncate">{mission.worktreePath.split('/').slice(-3).join('/')}</span>
            </button>
          </Fact>
        )}
      </div>
      {mission.state !== 'closed' && (
        <div className="mt-2 border-t border-line pt-2">
          {max > 0 ? (
            <div className="flex items-start gap-2.5">
              <Toggle
                size="sm"
                aria-label="Automatic follow-ups for this review"
                checked={mission.autoFollowUp !== false}
                onChange={(enabled) => void actions.setAutoFollowUp(mission.id, enabled)}
                className="mt-0.5"
              />
              <div className="min-w-0 text-[12px]">
                <div className="text-ink/90">Automatic follow-ups</div>
                <div className="text-faint">
                  {used} of {max} used. Each needs the author's reply and a push.
                </div>
              </div>
            </div>
          ) : (
            <p className="text-[11.5px] leading-snug text-faint">Automatic follow-ups are off in Settings. Review the delta yourself when the author replies.</p>
          )}
        </div>
      )}
    </Card>
  )
}

function Description({ pr }: { pr: PullRequest }) {
  const [more, setMore] = useState(false)
  const [cut, setCut] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const body = pr.body?.trim()
  useLayoutEffect(() => {
    const el = box.current
    if (el && !more) setCut(el.scrollHeight > el.clientHeight + 1)
  }, [body, more])
  return (
    <Card aria-label="Description">
      <SectionLabel>Description</SectionLabel>
      {body ? (
        <>
          <div ref={box} className={cn('relative mt-1.5 overflow-hidden', !more && 'max-h-[180px]')}>
            <Markdown className="text-[12px] text-muted">{body}</Markdown>
            {!more && cut && <div className="pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-surface" aria-hidden />}
          </div>
          {(cut || more) && (
            <button type="button" className="mt-1 text-[11.5px] text-accent hover:underline" onClick={() => setMore((m) => !m)}>
              {more ? 'Show less' : 'Show more'}
            </button>
          )}
        </>
      ) : (
        <p className="mt-1.5 text-[12px] text-faint">No description.</p>
      )}
    </Card>
  )
}

export interface DetailsSideProps {
  pr: PullRequest
  mission?: Mission
  /** The round the tabs show. */
  round?: ReviewRound
  settings: Settings
  slots: Slot[]
  now: number
}

/** Facts about the review, the PR's own description and the history, beside the round. */
export function DetailsSide({ pr, mission, round, settings, slots, now }: DetailsSideProps) {
  return (
    <aside className="flex min-w-0 flex-col gap-3" aria-label="Details">
      {mission && <ReviewFacts mission={mission} round={round} settings={settings} slots={slots} />}
      <Description pr={pr} />
      {mission && mission.timeline.length > 0 && (
        <Card aria-label="History">
          <SectionLabel>History</SectionLabel>
          <div className="mt-1.5">
            <History mission={mission} now={now} />
          </div>
        </Card>
      )}
    </aside>
  )
}
