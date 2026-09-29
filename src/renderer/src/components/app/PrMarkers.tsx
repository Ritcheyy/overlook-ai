import { Github, MessageSquareReply } from 'lucide-react'
import type { Mission, PullRequest, ReviewDecision, Verdict } from '@core/domain'
import { cn } from '@/lib/cn'
import { hasReply, verdictRound, VERDICT_META } from '@/lib/review'
import { Chip, DOT_TONE } from '../ui/Chip'

/** The reviewer's verdict as a plain label, so it never reads as a button. */
export function VerdictLabel({ verdict, title, className }: { verdict: Verdict; title?: string; className?: string }) {
  const meta = VERDICT_META[verdict]
  return (
    <span className={cn('inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap text-[12px] text-muted', className)} title={title} data-verdict={verdict}>
      <span className={cn('h-1.5 w-1.5 rounded-full', DOT_TONE[meta.tone])} aria-hidden />
      {meta.label}
    </span>
  )
}

const DECISION_META: Partial<Record<ReviewDecision, { label: string; tone: 'lime' | 'rose' }>> = {
  approved: { label: 'Approved', tone: 'lime' },
  changes_requested: { label: 'Changes requested', tone: 'rose' }
}

/** GitHub's own review decision, when a reviewer there approved or asked for changes. */
export function GitHubDecision({ decision }: { decision?: ReviewDecision }) {
  const meta = decision && DECISION_META[decision]
  if (!meta) return null
  return (
    <Chip tone={meta.tone} icon={<Github className="h-3 w-3" aria-hidden />} title={`${meta.label} on GitHub`} className="font-normal" data-github-decision={decision}>
      {meta.label}
    </Chip>
  )
}

/** The amber tag every surface uses for a push nobody has reviewed yet. */
export function NewPushChip({ className, label = 'new push' }: { className?: string; label?: string }) {
  return (
    <Chip tone="amber" dot pulse className={className} title="The author pushed since the last review">
      {label}
    </Chip>
  )
}

/** The teal tag for an author's reply nobody has reviewed yet. */
export function RepliedChip({ className, label = 'replied' }: { className?: string; label?: string }) {
  return (
    <Chip tone="teal" icon={<MessageSquareReply className="h-3 w-3" aria-hidden />} className={className} title="The author replied to the posted review">
      {label}
    </Chip>
  )
}

export interface PrMarkersProps {
  pr: Pick<PullRequest, 'reviewDecision'>
  mission?: Mission
  /** Leave the verdict out, for places that show it elsewhere. */
  hideVerdict?: boolean
  className?: string
}

/** Verdict, new push, reply and GitHub's decision: what a PR row needs to say at a glance. */
export function PrMarkers({ pr, mission, hideVerdict, className }: PrMarkersProps) {
  const round = mission && !hideVerdict ? verdictRound(mission) : undefined
  const live = mission && mission.state !== 'closed'
  return (
    <span className={cn('inline-flex min-w-0 flex-wrap items-center gap-1.5', className)}>
      {round && <VerdictLabel verdict={round.verdict} title={`Reviewer's verdict on round ${round.index}`} />}
      {live && mission.stale && <NewPushChip />}
      {live && hasReply(mission) && <RepliedChip />}
      <GitHubDecision decision={pr.reviewDecision} />
    </span>
  )
}
