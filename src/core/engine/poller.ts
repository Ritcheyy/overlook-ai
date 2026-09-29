/**
 * Inbox polling. Fetches the PR lists, reconciles them with active missions
 * (merged/closed PRs end their mission; the author's reply plus a push starts
 * a follow-up, a push alone marks the mission stale) and rebuilds the inbox as
 * listed PRs plus PRs that still have a mission.
 */
import type { Mission, MissionState, PrComment, PullRequest, Settings } from '../domain'
import { autoRoundsUsed, commentIdOf, lastPostedRound, latestRound, shortSha } from '../domain'
import type { GitHubPort, PullRequestDetail } from '../ports'
import { trimReplies } from './run-options'
import { errorMessage, type Scheduler } from './scheduler'

/** Missions whose PR detail is fetched every poll: the search index lags pushes and merges. */
const FRESH_STATES: readonly MissionState[] = ['queued', 'preparing', 'reviewing', 'needs_you', 'posting', 'watching']
const DAY_MS = 86_400_000

/** Oldest `updatedAt` the inbox still shows; undefined when the cut-off is off. */
export function updatedSince(settings: Pick<Settings, 'maxPrAgeDays'>, now: Date): Date | undefined {
  const days = settings.maxPrAgeDays
  if (!Number.isFinite(days) || days <= 0) return undefined
  return new Date(now.getTime() - days * DAY_MS)
}

/** Whether a listed PR belongs in the inbox: its repo is active and it was updated recently enough. */
export function inboxWanted(pr: PullRequest, settings: Pick<Settings, 'inactiveRepos' | 'maxPrAgeDays'>, now: Date): boolean {
  if (settings.inactiveRepos.includes(pr.repo.fullName)) return false
  const since = updatedSince(settings, now)
  if (!since) return true
  const updated = new Date(pr.updatedAt).getTime()
  return Number.isNaN(updated) || updated >= since.getTime()
}

/** Drops unwanted PRs from the listing; a PR with a live mission stays so its state keeps being reconciled. */
export function applyInboxFilters(listed: Map<string, PullRequest>, missions: Mission[], settings: Settings, now: Date): void {
  const kept = new Set(missions.filter((m) => m.state !== 'closed').map((m) => m.prId))
  for (const [id, pr] of listed) {
    if (!kept.has(id) && !inboxWanted(pr, settings, now)) listed.delete(id)
  }
}

export function autoFollowUpAllowed(mission: Mission, settings: Settings): boolean {
  return mission.autoFollowUp !== false && autoRoundsUsed(mission) < settings.maxAutoRoundsPerMission
}

/** Why a push did not start a follow-up, for the notification and the timeline. */
export function followUpHeldBecause(mission: Mission, settings: Settings): string {
  if (mission.autoFollowUp === false) return 'Automatic follow-ups are off for this review.'
  if (settings.maxAutoRoundsPerMission === 0) return 'Automatic follow-ups are off in Settings.'
  if (!autoFollowUpAllowed(mission, settings)) return `The automatic follow-up limit (${settings.maxAutoRoundsPerMission}) is reached.`
  return `A follow-up starts when ${mission.pr.author} replies to the review.`
}

function sameLogin(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase()
}

/**
 * The PR author's comments after the last posted round. Replies are matched
 * by comment rather than by login: on a self-review the posted review and the
 * author's reply come from the same account, and only the comment ids the app
 * recorded tell them apart. Other people's comments, bots included, never
 * count, so a deploy bot commenting on every push cannot start rounds.
 */
export function authorRepliesSince(mission: Mission, comments: readonly PrComment[]): PrComment[] {
  const posted = lastPostedRound(mission)
  if (!posted?.postedAt) return []
  const ours = new Set(mission.rounds.flatMap((r) => (r.postedCommentUrl ? [commentIdOf(r.postedCommentUrl)] : [])))
  const own = comments.find((c) => posted.postedCommentUrl && commentIdOf(c.url) === commentIdOf(posted.postedCommentUrl))
  // GitHub's own timestamp for the posted comment beats the local clock, which may drift from it.
  const since = Date.parse(own?.createdAt ?? posted.postedAt)
  return trimReplies(
    comments.filter((c) => sameLogin(c.author, mission.pr.author) && !ours.has(commentIdOf(c.url)) && Date.parse(c.createdAt) > since)
  )
}

/** The detail wins over the listing copy, but only the listing knows which list a PR came from. */
function freshest(listed: PullRequest, detail: PullRequest | undefined): PullRequest {
  if (!detail) return listed
  return { ...detail, reviewRequested: listed.reviewRequested || detail.reviewRequested, mine: listed.mine || detail.mine }
}

/** Comments ride along on mission fetches only; they never reach the inbox or a mission's PR snapshot. */
function withoutComments(pr: PullRequestDetail): PullRequest {
  const { comments: _comments, ...rest } = pr
  return rest
}

export function mergeListings(requested: PullRequest[], mine: PullRequest[]): Map<string, PullRequest> {
  const byId = new Map<string, PullRequest>()
  for (const p of requested) byId.set(p.id, { ...p, reviewRequested: true })
  for (const p of mine) {
    const existing = byId.get(p.id)
    byId.set(p.id, existing ? { ...existing, mine: true } : { ...p, mine: true })
  }
  return byId
}

async function fetchMissionPrs(github: GitHubPort, missions: Mission[], listed: Map<string, PullRequest>): Promise<Map<string, PullRequestDetail>> {
  const fetched = new Map<string, PullRequestDetail>()
  for (const m of missions) {
    if (m.state === 'closed' || fetched.has(m.prId)) continue
    if (!FRESH_STATES.includes(m.state) && listed.has(m.prId)) continue
    try {
      // Watched PRs are the ones a reply can move on, so only they pay for the comments.
      fetched.set(m.prId, await github.getPullRequest(m.pr.repo.fullName, m.pr.number, { comments: m.state === 'watching' }))
    } catch {
      // Unreachable for now; the listing copy or the PR as last seen stands in.
    }
  }
  return fetched
}

export async function pollInbox(sched: Scheduler): Promise<void> {
  const { state } = sched
  const { github } = sched.ports
  let listed: Map<string, PullRequest>
  let fetched: Map<string, PullRequestDetail>
  try {
    if (!state.githubLogin) state.githubLogin = await github.me()
    const requested = await github.listReviewRequested()
    const mine = state.settings.includeMine ? await github.listMine() : []
    listed = mergeListings(requested, mine)
    applyInboxFilters(listed, state.missions, state.settings, sched.ports.clock.now())
    fetched = await fetchMissionPrs(github, state.missions, listed)
  } catch (e) {
    state.pollError = errorMessage(e)
    sched.changed()
    return
  }
  state.pollError = undefined
  state.lastPollAt = sched.now()

  try {
    for (const mission of [...state.missions]) {
      if (mission.state === 'closed') continue
      const listedCopy = listed.get(mission.prId)
      const detail = fetched.get(mission.prId)
      const fresh = listedCopy ? freshest(listedCopy, detail && withoutComments(detail)) : detail && withoutComments(detail)
      if (fresh) await applyPullRequest(sched, mission, fresh, detail?.comments)
    }
    const inbox = [...listed.values()]
      .map((p) => {
        const detail = fetched.get(p.id)
        return freshest(p, detail && withoutComments(detail))
      })
      .filter((p) => p.state === 'open')
    for (const mission of state.missions) {
      if (mission.state === 'closed' || inbox.some((p) => p.id === mission.prId)) continue
      inbox.push(structuredClone(mission.pr))
    }
    state.inbox = inbox
  } catch (e) {
    state.pollError = errorMessage(e)
  }
  sched.changed()
  sched.schedule()
}

/**
 * Applies a freshly polled PR to its mission: closes it, starts a follow-up
 * when the author replied and pushed, or flags a push or a reply for the user.
 * `comments` is undefined when they were not fetched, which keeps the replies
 * the mission already knows.
 */
export async function applyPullRequest(sched: Scheduler, mission: Mission, fresh: PullRequest, comments?: readonly PrComment[]): Promise<void> {
  const previousSha = mission.pr.headSha
  mission.pr = structuredClone(fresh)
  if (fresh.state !== 'open') {
    const what = fresh.state === 'merged' ? 'merged' : 'closed'
    await sched.closeMission(mission.id, `PR ${what}`)
    sched.notify({ title: `PR #${fresh.number} ${what}`, body: fresh.title, missionId: mission.id })
    return
  }
  const { settings } = sched.state
  const pushed = fresh.headSha !== previousSha
  const note = `new push ${shortSha(fresh.headSha)}`

  const known = new Set((mission.authorReplies ?? []).map((r) => commentIdOf(r.url)))
  let newReplies: PrComment[] = []
  if (comments) {
    const baseline = mission.repliesCheckedAt === undefined
    mission.repliesCheckedAt = sched.now()
    const replies = authorRepliesSince(mission, comments)
    newReplies = baseline ? [] : replies.filter((r) => !known.has(commentIdOf(r.url)))
    if (replies.length > 0) mission.authorReplies = replies
    else delete mission.authorReplies
  }

  switch (mission.state) {
    case 'watching': {
      const reviewed = lastPostedRound(mission)?.headSha ?? latestRound(mission)?.headSha
      const moved = reviewed !== undefined && fresh.headSha !== reviewed
      const replied = (mission.authorReplies?.length ?? 0) > 0
      if (moved && replied && autoFollowUpAllowed(mission, settings)) {
        mission.stale = false
        mission.nextTrigger = 'reply'
        sched.transition(mission, 'queued', `${fresh.author} replied; follow-up on ${shortSha(fresh.headSha)}`)
        return
      }
      mission.stale = moved
      // Announced once per head: a push that landed mid-round only shows up here, after the post.
      if (moved && !mission.timeline.some((e) => e.note?.startsWith(note))) {
        const held = followUpHeldBecause(mission, settings)
        sched.annotate(mission, `${note}; ${autoFollowUpAllowed(mission, settings) ? 'waiting for a reply' : 'auto follow-up paused'}`)
        sched.notify({ title: `New push on #${fresh.number}`, body: `${held} Re-run when ready.`, missionId: mission.id })
      }
      if (newReplies.length > 0) {
        sched.annotate(mission, `${fresh.author} replied`)
        if (!moved) {
          sched.notify({ title: `${fresh.author} replied on #${fresh.number}`, body: 'No new commits yet, so no follow-up has started.', missionId: mission.id })
        } else if (!pushed) {
          sched.notify({ title: `${fresh.author} replied on #${fresh.number}`, body: `${followUpHeldBecause(mission, settings)} Re-run when ready.`, missionId: mission.id })
        }
      }
      sched.changed()
      return
    }
    case 'needs_you':
      if (!pushed) break
      mission.stale = true
      // The note also tells the watching branch, after posting, that this head was announced.
      sched.annotate(mission, `${note} while findings wait`)
      sched.notify({
        title: `New push on #${fresh.number} while findings wait`,
        body: `${shortSha(fresh.headSha)} by ${fresh.author}`,
        missionId: mission.id
      })
      return
    case 'preparing':
    case 'reviewing':
    case 'posting':
      if (pushed) mission.stale = true
      break
  }
  sched.changed()
}
