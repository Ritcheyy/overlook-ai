/**
 * What a follow-up round reads. A delta round only sees the pushed commits,
 * so once a follow-up comes back clean the whole change is read again before
 * anything approves, and the round after a clean one reads it all as well.
 */
import type { Mission, ReviewRound, Settings, Verdict } from '../domain'
import { lastPostedRound } from '../domain'

/** Clean means at most one finding above nit; nits and praise never count. */
export function isCleanRound(round: Pick<ReviewRound, 'findings'>): boolean {
  return round.findings.filter((f) => f.severity !== 'nit' && f.severity !== 'praise').length <= 1
}

/** True once a full pass completed at this head, so a clean delta there never starts another. */
export function wholePassDone(mission: Pick<Mission, 'rounds'>, headSha: string): boolean {
  return mission.rounds.some((r) => r.headSha === headSha && (r.scope === 'whole' || r.scope === 'delta+whole') && !r.error)
}

/**
 * The delta by default; the whole PR when asked, when nothing was pushed
 * since the last posted round (there is no delta to read), or, with full
 * passes on, when that round was a clean follow-up. Clean is judged on what
 * the author actually saw: the posted findings.
 */
export function nextScope(mission: Mission, headSha: string, settings: Pick<Settings, 'fullPassBeforeApproval'>, forced?: 'delta' | 'whole'): 'delta' | 'whole' {
  if (forced) return forced
  const posted = lastPostedRound(mission)
  if (!posted) return 'delta'
  if (headSha === posted.headSha) return 'whole'
  if (settings.fullPassBeforeApproval && posted.previousHeadSha && isCleanRound({ findings: posted.findings.filter((f) => f.decision === 'approved') })) return 'whole'
  return 'delta'
}

const VERDICT_RANK: Record<Verdict, number> = { approve: 0, comment: 1, request_changes: 2 }

/** The stricter of two verdicts, for a round made of two passes. */
export function worseVerdict(a: Verdict, b: Verdict): Verdict {
  return VERDICT_RANK[b] > VERDICT_RANK[a] ? b : a
}
