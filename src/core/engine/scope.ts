/**
 * What a follow-up round reads. A delta round only sees the pushed commits,
 * so a clean delta is no approval of the whole change: when it follows a
 * round that had real findings, the whole PR is read again inside the same
 * round. A PR that was already clean stays on deltas, and the automatic full
 * passes are capped per PR, so fixing nits never costs a full read.
 */
import type { Mission, ReviewRound, Settings, Verdict } from '../domain'
import { lastPostedRound } from '../domain'

/** Automatic full passes a PR gets; after that only "Read the whole PR" in the Review options starts one. */
export const MAX_AUTO_FULL_PASSES = 2

/** Clean means at most one finding above nit; nits and praise never count. */
export function isCleanRound(round: Pick<ReviewRound, 'findings'>): boolean {
  return round.findings.filter((f) => f.severity !== 'nit' && f.severity !== 'praise').length <= 1
}

/** True once a full pass completed at this head, so a clean delta there never starts another. */
export function wholePassDone(mission: Pick<Mission, 'rounds'>, headSha: string): boolean {
  return mission.rounds.some((r) => r.headSha === headSha && (r.scope === 'whole' || r.scope === 'delta+whole') && !r.error)
}

/** Full passes a clean delta has started on this PR, failed attempts included. */
export function autoFullPassesUsed(mission: Pick<Mission, 'rounds'>): number {
  return mission.rounds.filter((r) => r.scope === 'delta+whole' || r.fullPassError !== undefined).length
}

export type FullPassHold = 'off' | 'previous_clean' | 'done_at_head' | 'used_up'

/**
 * Why a clean delta at this head would not be followed by a full pass, or
 * undefined when it would. The round before is judged on what the author
 * saw: its approved findings.
 */
export function fullPassHold(mission: Mission, headSha: string, settings: Pick<Settings, 'fullPassBeforeApproval'>): FullPassHold | undefined {
  if (!settings.fullPassBeforeApproval) return 'off'
  const posted = lastPostedRound(mission)
  // A round whose full pass failed never established that the PR was clean, whatever its delta found.
  if (posted && posted.fullPassError === undefined && isCleanRound({ findings: posted.findings.filter((f) => f.decision === 'approved') })) return 'previous_clean'
  if (wholePassDone(mission, headSha)) return 'done_at_head'
  if (autoFullPassesUsed(mission) >= MAX_AUTO_FULL_PASSES) return 'used_up'
  return undefined
}

/**
 * The delta by default; the whole PR when asked, or when nothing was pushed
 * since the last posted round (there is no delta to read).
 */
export function nextScope(mission: Mission, headSha: string, forced?: 'delta' | 'whole'): 'delta' | 'whole' {
  if (forced) return forced
  const posted = lastPostedRound(mission)
  if (!posted) return 'delta'
  return headSha === posted.headSha ? 'whole' : 'delta'
}

const VERDICT_RANK: Record<Verdict, number> = { approve: 0, comment: 1, request_changes: 2 }

/** The stricter of two verdicts, for a round made of two passes. */
export function worseVerdict(a: Verdict, b: Verdict): Verdict {
  return VERDICT_RANK[b] > VERDICT_RANK[a] ? b : a
}
