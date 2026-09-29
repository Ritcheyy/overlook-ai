import { CircleAlert, CircleCheck, Clock, GitCommitHorizontal, ListChecks, LoaderCircle, MessageSquareReply, Radar, RotateCcw, Square, type LucideIcon } from 'lucide-react'
import type { Mission, PullRequest, Settings, Slot } from '@core/domain'
import { cn } from '@/lib/cn'
import { Button } from '@/components/ui/Button'
import { CHIP_TONE } from '@/components/ui/Chip'
import { ConfirmButton } from '@/components/ui/ConfirmButton'
import { ReviewSplitButton } from '@/components/app/ReviewSplitButton'
import { statusFor, type StatusIcon } from './status'
import { useMissionActions } from './useMissionActions'

const ICONS: Record<StatusIcon, LucideIcon> = {
  idle: CircleCheck,
  queue: Clock,
  work: LoaderCircle,
  decide: ListChecks,
  push: GitCommitHorizontal,
  reply: MessageSquareReply,
  alert: CircleAlert,
  watch: Radar,
  closed: CircleCheck
}

export interface StatusLineProps {
  pr: PullRequest
  mission?: Mission
  settings: Settings
  slots: Slot[]
  now: number
}

/** One line saying where the review stands, and the one thing to do about it. */
export function StatusLine({ pr, mission, settings, slots, now }: StatusLineProps) {
  const actions = useMissionActions()
  const status = statusFor(mission, settings, slots, now)
  const Icon = ICONS[status.icon]
  const repoAutoPost = settings.autoPostRepos.includes(pr.repo.fullName)

  let action = null
  switch (status.action) {
    case 'review':
      action = (
        <ReviewSplitButton
          label="Review"
          variant="primary"
          loadoutId={settings.defaultLoadoutId}
          autoPost={repoAutoPost}
          onStart={({ loadoutId, options }) => actions.dispatch(pr.id, loadoutId, options)}
        />
      )
      break
    case 'review_delta':
    case 'review_again':
      if (mission)
        action = (
          <ReviewSplitButton
            label={status.action === 'review_delta' ? 'Review the delta' : 'Review again'}
            variant={status.action === 'review_delta' ? 'primary' : 'secondary'}
            icon={<RotateCcw className="h-3.5 w-3.5" aria-hidden />}
            loadoutId={mission.loadoutId}
            autoPost={mission.autoPost}
            title="Start a new round on the current head"
            onStart={({ loadoutId, options }) => actions.rerun(mission.id, loadoutId, options)}
          />
        )
      break
    case 'retry':
      // Retry repeats the failed run, options included; the arrow starts over with other ones.
      if (mission)
        action = (
          <ReviewSplitButton
            label="Retry"
            variant="primary"
            icon={<RotateCcw className="h-3.5 w-3.5" aria-hidden />}
            loadoutId={mission.loadoutId}
            autoPost={mission.runOptions?.autoPost ?? mission.autoPost}
            title="Run the failed review again as it was"
            onStart={({ loadoutId, options }, custom) => (custom ? actions.rerun(mission.id, loadoutId, options) : actions.retry(mission.id))}
          />
        )
      break
    case 'cancel':
      if (mission)
        action = (
          <ConfirmButton size="md" variant="ghost" confirmLabel="Stop this review?" icon={<Square className="h-3 w-3" />} onConfirm={() => void actions.cancel(mission.id)}>
            Cancel
          </ConfirmButton>
        )
      break
  }

  return (
    <div className={cn('flex shrink-0 items-center gap-3 border-b px-5 py-2', CHIP_TONE[status.tone], 'rounded-none border-x-0 border-t-0')} role="status" data-status={status.icon}>
      <Icon className={cn('h-4 w-4 shrink-0', status.icon === 'work' && 'animate-spin')} aria-hidden />
      <span className="min-w-0 flex-1 text-[12.5px] leading-snug">{status.text}</span>
      {action}
    </div>
  )
}
