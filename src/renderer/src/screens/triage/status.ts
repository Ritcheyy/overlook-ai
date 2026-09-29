import type { Mission, Settings, Slot } from '@core/domain'
import { lastPostedRound, latestRound, shortSha } from '@core/domain'
import { autoFollowUpAllowed, followUpHeldBecause } from '@core/engine/poller'
import type { Tone } from '@/components/ui/Chip'
import { relativeTime } from '@/lib/format'
import { hasReply } from '@/lib/review'

/** The one thing the status line offers to do next. */
export type StatusAction = 'review' | 'review_delta' | 'review_again' | 'retry' | 'cancel' | 'none'

export type StatusIcon = 'idle' | 'queue' | 'work' | 'decide' | 'push' | 'reply' | 'alert' | 'watch' | 'closed'

export interface ReviewStatus {
  tone: Tone
  icon: StatusIcon
  text: string
  action: StatusAction
}

function firstLine(text: string): string {
  const line = text.split('\n').find((l) => l.trim()) ?? text
  return line.length > 160 ? `${line.slice(0, 157)}…` : line
}

/** What a review is doing, in one line, with the action that moves it on. */
export function statusFor(mission: Mission | undefined, settings: Settings, slots: Slot[] = [], now: number = Date.now()): ReviewStatus {
  if (!mission) return { tone: 'muted', icon: 'idle', text: 'Not reviewed yet.', action: 'review' }
  const reviewer = slots.find((s) => s.id === (mission.slotId ?? mission.preferredSlotId))?.name ?? 'The reviewer'
  const round = latestRound(mission)
  const posted = lastPostedRound(mission)
  const author = mission.pr.author
  const head = shortSha(mission.pr.headSha)
  switch (mission.state) {
    case 'queued':
      return { tone: 'muted', icon: 'queue', text: 'Queued. It starts when a reviewer is free.', action: 'cancel' }
    case 'preparing':
      return { tone: 'accent', icon: 'work', text: `${reviewer} is preparing the worktree.`, action: 'cancel' }
    case 'reviewing':
      return { tone: 'accent', icon: 'work', text: `${reviewer} is reviewing round ${round?.index ?? 1}.`, action: 'cancel' }
    case 'posting':
      return { tone: 'accent', icon: 'work', text: 'Posting the comment to GitHub.', action: 'none' }
    case 'needs_you': {
      if (mission.error) return { tone: 'rose', icon: 'alert', text: firstLine(mission.error), action: 'none' }
      if (mission.stale) return { tone: 'amber', icon: 'push', text: `${author} pushed ${head} after this round, so its findings may be out of date.`, action: 'review_delta' }
      const count = round?.findings.length ?? 0
      return {
        tone: 'amber',
        icon: 'decide',
        text: count === 0 ? 'No findings. Posting sends the summary only.' : count === 1 ? '1 finding waits for your decision.' : `${count} findings wait for your decision.`,
        action: 'none'
      }
    }
    case 'failed':
      return { tone: 'rose', icon: 'alert', text: `The review failed: ${firstLine(mission.error ?? round?.error ?? 'unknown error')}`, action: 'retry' }
    case 'watching': {
      const replied = hasReply(mission)
      const since = posted ? `round ${posted.index}` : 'the last round'
      if (replied && mission.stale) {
        const held = autoFollowUpAllowed(mission, settings) ? 'A follow-up is about to start.' : followUpHeldBecause(mission, settings)
        return { tone: 'teal', icon: 'reply', text: `${author} replied and pushed ${head}. ${held}`, action: 'review_delta' }
      }
      if (replied) return { tone: 'teal', icon: 'reply', text: `${author} replied to ${since} without pushing.`, action: 'review_again' }
      if (mission.stale) return { tone: 'amber', icon: 'push', text: `${author} pushed ${head} after ${since}. ${followUpHeldBecause(mission, settings)}`, action: 'review_delta' }
      const when = posted?.postedAt ? ` Round ${posted.index} was posted ${relativeTime(posted.postedAt, now)}.` : ''
      return { tone: 'teal', icon: 'watch', text: `Watching for ${author}'s reply.${when}`, action: 'review_again' }
    }
    case 'closed': {
      const note = mission.timeline[mission.timeline.length - 1]?.note
      return { tone: 'faint', icon: 'closed', text: `This review is closed${note ? ` (${note})` : ''}. It stays in the Log.`, action: 'none' }
    }
  }
}
