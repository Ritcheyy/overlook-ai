/**
 * Inbox polling. Fetches the PR lists, reconciles them with active missions
 * (merged/closed PRs end their mission, new pushes re-queue or mark stale)
 * and rebuilds the inbox as listed PRs plus PRs that still have a mission.
 */
import type { Mission, MissionState, PullRequest, Settings } from '../domain'
import { shortSha } from '../domain'
import type { GitHubPort } from '../ports'
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
  return mission.autoFollowUp !== false && mission.rounds.length < 1 + settings.maxAutoRoundsPerMission
}

function pausedFollowUpBody(mission: Mission, settings: Settings): string {
  return mission.autoFollowUp === false
    ? 'Auto follow-up is off. Re-run when ready.'
    : `Auto follow-up limit (${settings.maxAutoRoundsPerMission}) reached. Re-run when ready.`
}

/** The detail wins over the listing copy, but only the listing knows which list a PR came from. */
function freshest(listed: PullRequest, detail: PullRequest | undefined): PullRequest {
  if (!detail) return listed
  return { ...detail, reviewRequested: listed.reviewRequested || detail.reviewRequested, mine: listed.mine || detail.mine }
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

async function fetchMissionPrs(github: GitHubPort, missions: Mission[], listed: Map<string, PullRequest>): Promise<Map<string, PullRequest>> {
  const fetched = new Map<string, PullRequest>()
  for (const m of missions) {
    if (m.state === 'closed' || fetched.has(m.prId)) continue
    if (!FRESH_STATES.includes(m.state) && listed.has(m.prId)) continue
    try {
      fetched.set(m.prId, await github.getPullRequest(m.pr.repo.fullName, m.pr.number))
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
  let fetched: Map<string, PullRequest>
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
      const fresh = listedCopy ? freshest(listedCopy, detail) : detail
      if (fresh) await applyPullRequest(sched, mission, fresh)
    }
    const inbox = [...listed.values()].map((p) => freshest(p, fetched.get(p.id))).filter((p) => p.state === 'open')
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

/** Applies a freshly polled PR to its mission: closes it, re-queues it, or flags it stale. */
export async function applyPullRequest(sched: Scheduler, mission: Mission, fresh: PullRequest): Promise<void> {
  const previousSha = mission.pr.headSha
  mission.pr = structuredClone(fresh)
  if (fresh.state !== 'open') {
    const what = fresh.state === 'merged' ? 'merged' : 'closed'
    await sched.closeMission(mission.id, `PR ${what}`)
    sched.notify({ title: `PR #${fresh.number} ${what}`, body: fresh.title, missionId: mission.id })
    return
  }
  const { settings } = sched.state
  // A push that landed mid-round left the mission stale; once that round is
  // posted the watching mission still owes the author a follow-up on it.
  const owesFollowUp = mission.state === 'watching' && mission.stale && autoFollowUpAllowed(mission, settings)
  if (fresh.headSha === previousSha && !owesFollowUp) {
    sched.changed()
    return
  }
  const note = `new push ${shortSha(fresh.headSha)}`
  switch (mission.state) {
    case 'watching':
      if (autoFollowUpAllowed(mission, settings)) {
        mission.stale = false
        sched.transition(mission, 'queued', note)
      } else {
        mission.stale = true
        sched.annotate(mission, `${note}; auto follow-up paused`)
        sched.notify({ title: `New push on #${fresh.number}`, body: pausedFollowUpBody(mission, settings), missionId: mission.id })
      }
      break
    case 'needs_you':
      mission.stale = true
      sched.changed()
      sched.notify({
        title: `New push on #${fresh.number} while findings wait`,
        body: `${shortSha(fresh.headSha)} by ${fresh.author}`,
        missionId: mission.id
      })
      break
    case 'preparing':
    case 'reviewing':
    case 'posting':
      mission.stale = true
      sched.changed()
      break
    default:
      sched.changed()
  }
}
