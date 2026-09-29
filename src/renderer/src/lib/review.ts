import type { Mission, ReviewRound, Verdict } from '@core/domain'
import type { Tone } from '@/components/ui/Chip'

export const VERDICT_META: Record<Verdict, { label: string; tone: Tone }> = {
  approve: { label: 'Looks good', tone: 'lime' },
  request_changes: { label: 'Changes requested', tone: 'rose' },
  comment: { label: 'Comments', tone: 'accent' }
}

/** The newest round that produced a review; a failed or running round has no verdict to show. */
export function verdictRound(mission: Pick<Mission, 'rounds'>): ReviewRound | undefined {
  for (let i = mission.rounds.length - 1; i >= 0; i--) {
    const r = mission.rounds[i]
    if (r.finishedAt && !r.error) return r
  }
  return undefined
}

export function hasReply(mission: Pick<Mission, 'authorReplies'>): boolean {
  return (mission.authorReplies?.length ?? 0) > 0
}

/** Something happened on the PR since the last review: a push, a reply, or both. */
export function hasUpdates(mission: Pick<Mission, 'stale' | 'authorReplies' | 'state'>): boolean {
  if (mission.state === 'closed') return false
  return mission.stale || hasReply(mission)
}

/** "checkout-api" from "acme/checkout-api". */
export function repoShortName(fullName: string): string {
  return fullName.slice(fullName.indexOf('/') + 1)
}
