import { afterEach, describe, expect, it } from 'vitest'
import type { AppSnapshot, Mission, PullRequest, Settings, Workspace } from '../domain'
import { latestRound, repoRefFromFullName } from '../domain'
import type { Api, Engine } from '../ipc-contract'
import type { PersistedState, ReviewRequest, ReviewResult, RunnerPort } from '../ports'
import { RETIRED_SLASH_COMMANDS, defaultSettings } from '../loadouts'
import { createEngine } from './api-server'
import { MockGitHub } from '../mocks/github'
import { DEMO_WORKSPACE_NOTES, DEMO_WORKSPACE_ROOT, FakeClock, MockNotifier, MockRepos, defaultDemoRepos } from '../mocks/misc'
import { MockRunner } from '../mocks/runner'
import { MemoryStore } from '../mocks/store'
import { MockWorktree } from '../mocks/worktree'

const PR_412 = 'acme/checkout-api#412'
const PR_1203 = 'acme/storefront-web#1203'
const PR_77 = 'acme/mobile-app#77'
const PR_58 = 'acme/notifications-service#58'

/** MockRunner that can hold reviews open until released, so cancel/stop tests are deterministic. */
class GateRunner implements RunnerPort {
  readonly inner = new MockRunner(0)
  readonly started: ReviewRequest[] = []
  block = false
  /** Thrown in place of the next result, after the scripted activity. */
  failWith?: Error
  private waiters: Array<() => void> = []

  get calls(): ReviewRequest[] {
    return this.inner.calls
  }

  async review(req: ReviewRequest): Promise<ReviewResult> {
    this.started.push(req)
    if (this.block) {
      await new Promise<void>((resolve, reject) => {
        const onAbort = () => reject(new Error('aborted'))
        req.signal?.addEventListener('abort', onAbort, { once: true })
        this.waiters.push(() => {
          req.signal?.removeEventListener('abort', onAbort)
          resolve()
        })
      })
    }
    const result = await this.inner.review(req)
    if (this.failWith) {
      const err = this.failWith
      this.failWith = undefined
      throw err
    }
    return result
  }

  release(): void {
    this.block = false
    for (const w of this.waiters.splice(0)) w()
  }
}

interface Harness {
  engine: Engine
  api: Api
  github: MockGitHub
  worktree: MockWorktree
  runner: GateRunner
  repos: MockRepos
  notifier: MockNotifier
  store: MemoryStore
  clock: FakeClock
}

const live: Harness[] = []

interface HarnessOptions {
  settings?: Partial<Settings>
  store?: MemoryStore
  runner?: GateRunner
  github?: MockGitHub
  worktree?: MockWorktree
  repos?: MockRepos
  poll?: boolean
}

async function makeEngine(opts: HarnessOptions = {}): Promise<Harness> {
  const clock = new FakeClock()
  const github = opts.github ?? new MockGitHub({ clock })
  const worktree = opts.worktree ?? new MockWorktree(0)
  const runner = opts.runner ?? new GateRunner()
  const repos = opts.repos ?? new MockRepos()
  const notifier = new MockNotifier()
  // Follow-up scenarios need a cap above the shipped default of 0.
  const settings = defaultSettings({ pollIntervalSec: 3600, maxAutoRoundsPerMission: 3, ...opts.settings })
  const store = opts.store ?? new MemoryStore({ missions: [], inbox: [], settings })
  const engine = createEngine({
    ports: { github, worktree, runner, repos, store, notifier, clock },
    version: 'test',
    homeDir: '/Users/demo'
  })
  const h: Harness = { engine, api: engine.api, github, worktree, runner, repos, notifier, store, clock }
  live.push(h)
  await engine.start()
  if (repos.repos.length > 0) await waitFor(h, (s) => s.localRepos.length === repos.repos.length)
  if (opts.poll !== false) await engine.api.refreshInbox()
  return h
}

async function waitFor(h: Harness, pred: (s: AppSnapshot) => boolean, timeoutMs = 4000): Promise<AppSnapshot> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const s = await h.api.getSnapshot()
    if (pred(s)) return s
    if (Date.now() > deadline) throw new Error(`waitFor timed out; missions: ${JSON.stringify(s.missions.map((m) => [m.prId, m.state, m.error]))}`)
    await sleep(4)
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

const missionOf = (s: AppSnapshot, id: string): Mission => {
  const m = s.missions.find((x) => x.id === id)
  if (!m) throw new Error(`mission ${id} missing from snapshot`)
  return m
}

const waitForState = (h: Harness, id: string, state: Mission['state']) =>
  waitFor(h, (s) => s.missions.find((m) => m.id === id)?.state === state).then((s) => missionOf(s, id))

/** The PR author answers the posted review a second later, which is what lets a push start a follow-up. */
function authorReplies(h: Harness, prId: string, body?: string) {
  h.clock.advance(1000)
  return h.github.simulateReply(prId, body)
}

afterEach(async () => {
  for (const h of live.splice(0)) await h.engine.stop()
})

describe('engine', () => {
  it('runs the happy path: queued -> needs_you -> posting -> watching with only approved findings posted', async () => {
    const h = await makeEngine()
    const dispatched = await h.api.dispatch({ prId: PR_412 })
    // A free slot picks the mission up synchronously, so it may already be preparing.
    expect(['queued', 'preparing']).toContain(dispatched.state)
    expect(dispatched.timeline[0]).toEqual({ at: h.clock.now().toISOString(), to: 'queued' })
    expect(dispatched.autoPost).toBe(false)

    const mission = await waitForState(h, dispatched.id, 'needs_you')
    expect(mission.slotId).toBe('slot-1')
    expect(mission.worktreePath).toBe('/Users/demo/.overlook/worktrees/acme/checkout-api/pr-412')
    expect(mission.rounds).toHaveLength(1)
    const round = mission.rounds[0]
    expect(round.index).toBe(1)
    expect(round.headSha).toBe(mission.pr.headSha)
    expect(round.findings).toHaveLength(4)
    expect(round.findings.every((f) => f.decision === 'pending')).toBe(true)
    expect(round.finishedAt).toBeDefined()
    expect(mission.timeline.map((e) => e.to)).toEqual(['queued', 'preparing', 'reviewing', 'needs_you'])
    expect(h.worktree.trees.has(mission.worktreePath!)).toBe(true)

    const snap = await h.api.getSnapshot()
    expect(snap.slots.find((s) => s.id === 'slot-1')?.missionId).toBe(mission.id)
    const activity = await h.api.getActivity(mission.id)
    expect(activity.some((a) => a.kind === 'preparing')).toBe(true)
    expect(activity.some((a) => a.kind === 'reading')).toBe(true)
    expect(activity[activity.length - 1].kind).toBe('done')
    expect(activity.every((a) => a.missionId === mission.id && typeof a.at === 'string')).toBe(true)
    expect(h.notifier.notifications.map((n) => n.title)).toContain(`Findings ready: #412 ${mission.pr.title}`)
    expect(h.notifier.notifications.find((n) => n.title.startsWith('Findings ready'))?.body).toBe('4 findings from Vhagar')
    expect(h.runner.calls[0].previousRound).toBeUndefined()
    expect(h.runner.calls[0].diff).toContain('diff --git')
    expect(h.runner.calls[0].loadout.id).toBe('blind')

    const [approved, dropped, ...rest] = round.findings
    await h.api.setFindingDecision({ missionId: mission.id, roundId: round.id, findingId: approved.id, decision: 'approved' })
    await h.api.setFindingDecision({
      missionId: mission.id,
      roundId: round.id,
      findingId: dropped.id,
      decision: 'dropped',
      dropReason: 'product_decision',
      dropNote: 'Discussed with product'
    })
    await h.api.setFindingDecisions({ missionId: mission.id, roundId: round.id, decision: 'approved', findingIds: [rest[0].id] })

    const triaged = missionOf(await h.api.getSnapshot(), mission.id).rounds[0]
    expect(triaged.findings[0].decision).toBe('approved')
    expect(triaged.findings[1]).toMatchObject({ decision: 'dropped', dropReason: 'product_decision', dropNote: 'Discussed with product' })
    expect(triaged.findings[2].decision).toBe('approved')
    expect(triaged.findings[3].decision).toBe('pending')

    const preview = await h.api.previewComment(mission.id)
    expect(preview).toContain(approved.title)
    expect(preview).not.toContain(dropped.title)

    const { url } = await h.api.postComment(mission.id)
    expect(url).toContain('issuecomment')
    const watching = await waitForState(h, mission.id, 'watching')
    expect(watching.slotId).toBeUndefined()
    expect(watching.preferredSlotId).toBe('slot-1')
    expect(watching.worktreePath).toBeDefined()
    expect(latestRound(watching)?.postedCommentUrl).toBe(url)
    expect(latestRound(watching)?.postedAt).toBeDefined()
    expect(latestRound(watching)?.postedBody).toBe(h.github.comments[0].body)
    expect(h.github.comments).toHaveLength(1)
    expect(h.github.comments[0].prId).toBe(PR_412)
    expect(h.github.comments[0].body).toContain(approved.title)
    expect(h.github.comments[0].body).toContain(rest[0].title)
    expect(h.github.comments[0].body).not.toContain(dropped.title)
    expect(h.github.comments[0].body).not.toContain(rest[1].title)
    const after = await h.api.getSnapshot()
    expect(after.slots.every((s) => s.missionId === undefined)).toBe(true)
  })

  it('holds two slots, queues the third, and starts it when a slot frees', async () => {
    const h = await makeEngine()
    const a = await h.api.dispatch({ prId: PR_412 })
    const b = await h.api.dispatch({ prId: PR_1203 })
    const c = await h.api.dispatch({ prId: PR_77 })
    await waitForState(h, a.id, 'needs_you')
    await waitForState(h, b.id, 'needs_you')
    let snap = await h.api.getSnapshot()
    expect(missionOf(snap, a.id).slotId).toBe('slot-1')
    expect(missionOf(snap, b.id).slotId).toBe('slot-2')
    expect(missionOf(snap, c.id).state).toBe('queued')
    expect(missionOf(snap, c.id).slotId).toBeUndefined()
    expect(snap.slots.map((s) => s.missionId)).toEqual([a.id, b.id])

    await h.api.setFindingDecisions({ missionId: b.id, roundId: missionOf(snap, b.id).rounds[0].id, decision: 'approved' })
    await h.api.postComment(b.id)
    await waitForState(h, c.id, 'needs_you')
    snap = await h.api.getSnapshot()
    expect(missionOf(snap, c.id).slotId).toBe('slot-2')
    expect(missionOf(snap, b.id).state).toBe('watching')
    expect(snap.slots.map((s) => s.missionId)).toEqual([a.id, c.id])
  })

  it('rejects bad dispatches', async () => {
    const h = await makeEngine()
    await expect(h.api.dispatch({ prId: 'acme/checkout-api#9999' })).rejects.toThrow('PR not found: acme/checkout-api#9999')
    await expect(h.api.dispatch({ prId: 'garbage' })).rejects.toThrow('PR not found: garbage')
    await expect(h.api.dispatch({ prId: PR_412, loadoutId: 'nope' })).rejects.toThrow('Unknown review type: nope')
    const m = await h.api.dispatch({ prId: PR_412, loadoutId: 'security' })
    expect(m.loadoutId).toBe('security')
    await expect(h.api.dispatch({ prId: PR_412 })).rejects.toThrow('#412 already has an active review')
    await waitForState(h, m.id, 'needs_you')
    expect(h.runner.calls[0].loadout.id).toBe('security')
  })

  it('dispatches a PR that is not in the inbox by fetching it', async () => {
    const h = await makeEngine()
    const fresh = h.github.simulateNewPullRequest()
    let snap = await h.api.getSnapshot()
    expect(snap.inbox.some((p) => p.id === fresh.id)).toBe(false)
    const m = await h.api.dispatch({ prId: fresh.id })
    snap = await h.api.getSnapshot()
    expect(snap.inbox.some((p) => p.id === fresh.id)).toBe(true)
    await waitForState(h, m.id, 'needs_you')
  })

  it('re-queues a watching mission to the front on push, preferring its old slot and passing previousRound', async () => {
    const h = await makeEngine()
    const a = await h.api.dispatch({ prId: PR_412 })
    const b = await h.api.dispatch({ prId: PR_1203 })
    await waitForState(h, a.id, 'needs_you')
    const bDone = await waitForState(h, b.id, 'needs_you')
    expect(bDone.slotId).toBe('slot-2')
    await h.api.setFindingDecisions({ missionId: b.id, roundId: bDone.rounds[0].id, decision: 'approved' })
    await h.api.postComment(b.id)
    const bWatching = await waitForState(h, b.id, 'watching')
    expect(bWatching.preferredSlotId).toBe('slot-2')
    const firstSha = bWatching.rounds[0].headSha

    // c takes the freed slot-2; d has nowhere to go and waits.
    const c = await h.api.dispatch({ prId: PR_77 })
    await waitForState(h, c.id, 'needs_you')
    const d = await h.api.dispatch({ prId: PR_58 })
    expect(missionOf(await h.api.getSnapshot(), d.id).state).toBe('queued')

    h.clock.advance(1000)
    const pushed = h.github.simulatePush(PR_1203)
    const reply = authorReplies(h, PR_1203)
    await h.api.refreshInbox()
    let snap = await h.api.getSnapshot()
    const bQueued = missionOf(snap, b.id)
    expect(bQueued.state).toBe('queued')
    expect(bQueued.stale).toBe(false)
    expect(bQueued.pr.headSha).toBe(pushed.headSha)
    expect(bQueued.timeline[bQueued.timeline.length - 1].note).toBe(`mariam-dev replied; follow-up on ${pushed.headSha.slice(0, 7)}`)

    // Free slot-2 (c) and slot-1 (a): b must go first and land on slot-2 even though slot-1 frees first.
    const aSnap = missionOf(snap, a.id)
    await h.api.setFindingDecisions({ missionId: a.id, roundId: aSnap.rounds[0].id, decision: 'approved' })
    await h.api.postComment(a.id)
    await waitForState(h, a.id, 'watching')
    await waitFor(h, (s) => s.missions.find((m) => m.id === b.id)?.state !== 'queued')
    snap = await h.api.getSnapshot()
    expect(missionOf(snap, b.id).slotId).toBe('slot-1')
    expect(missionOf(snap, d.id).state).toBe('queued')

    const bAgain = await waitForState(h, b.id, 'needs_you')
    expect(bAgain.rounds).toHaveLength(2)
    expect(bAgain.rounds[1].index).toBe(2)
    expect(bAgain.rounds[1].headSha).toBe(pushed.headSha)
    expect(bAgain.rounds[1].previousHeadSha).toBe(firstSha)
    expect(bAgain.rounds[1].briefing).toMatch(new RegExp(`^Since ${firstSha.slice(0, 7)}:`))
    const followUp = h.runner.calls.find((r) => r.mission.id === b.id && r.round.index === 2)
    expect(followUp?.previousRound?.headSha).toBe(firstSha)
    expect(followUp?.previousRound?.postedAt).toBeDefined()
    expect(followUp?.replies).toEqual([reply])
    expect(bAgain.rounds[1].trigger).toBe('reply')
    expect(bAgain.rounds[1].replies).toEqual([reply])
    expect(bAgain.authorReplies).toBeUndefined()
    // The runner got clones: scribbling on them must not reach the engine.
    followUp!.mission.error = 'scribbled'
    followUp!.round.summary = 'scribbled'
    expect(missionOf(await h.api.getSnapshot(), b.id).error).toBeUndefined()
    expect(missionOf(await h.api.getSnapshot(), b.id).rounds[1].summary).not.toBe('scribbled')

    // Once c frees slot-2, d finally starts.
    const cSnap = missionOf(snap, c.id)
    await h.api.setFindingDecisions({ missionId: c.id, roundId: cSnap.rounds[0].id, decision: 'approved' })
    await h.api.postComment(c.id)
    const dDone = await waitForState(h, d.id, 'needs_you')
    expect(dDone.slotId).toBe('slot-2')
  })

  it('prefers the old slot when both are free', async () => {
    const h = await makeEngine()
    const a = await h.api.dispatch({ prId: PR_412 })
    const b = await h.api.dispatch({ prId: PR_1203 })
    const aDone = await waitForState(h, a.id, 'needs_you')
    const bDone = await waitForState(h, b.id, 'needs_you')
    await h.api.setFindingDecisions({ missionId: b.id, roundId: bDone.rounds[0].id, decision: 'approved' })
    await h.api.postComment(b.id)
    await waitForState(h, b.id, 'watching')
    await h.api.setFindingDecisions({ missionId: a.id, roundId: aDone.rounds[0].id, decision: 'approved' })
    await h.api.postComment(a.id)
    await waitForState(h, a.id, 'watching')

    h.github.simulatePush(PR_1203)
    authorReplies(h, PR_1203)
    await h.api.refreshInbox()
    const again = await waitForState(h, b.id, 'needs_you')
    expect(again.slotId).toBe('slot-2')
  })

  it('marks a needs_you mission stale on push and notifies', async () => {
    const h = await makeEngine()
    const a = await h.api.dispatch({ prId: PR_412 })
    await waitForState(h, a.id, 'needs_you')
    const pushed = h.github.simulatePush(PR_412)
    await h.api.refreshInbox()
    const m = missionOf(await h.api.getSnapshot(), a.id)
    expect(m.state).toBe('needs_you')
    expect(m.stale).toBe(true)
    expect(m.pr.headSha).toBe(pushed.headSha)
    expect(h.notifier.notifications.map((n) => n.title)).toContain('New push on #412 while findings wait')

    await h.api.rerunMission(a.id)
    const rerun = await waitForState(h, a.id, 'needs_you')
    expect(rerun.stale).toBe(false)
    expect(rerun.rounds).toHaveLength(2)
    expect(rerun.rounds[1].headSha).toBe(pushed.headSha)
  })

  it('closes the mission and removes the worktree when the PR merges', async () => {
    const h = await makeEngine()
    const a = await h.api.dispatch({ prId: PR_412 })
    const done = await waitForState(h, a.id, 'needs_you')
    expect(h.worktree.trees.size).toBe(1)
    h.github.simulateClose(PR_412, true)
    await h.api.refreshInbox()
    const snap = await h.api.getSnapshot()
    const m = missionOf(snap, a.id)
    expect(m.state).toBe('closed')
    expect(m.slotId).toBeUndefined()
    expect(m.timeline[m.timeline.length - 1].note).toBe('PR merged')
    expect(h.worktree.trees.has(done.worktreePath!)).toBe(false)
    expect(snap.inbox.some((p) => p.id === PR_412)).toBe(false)
    expect(snap.slots.every((s) => s.missionId === undefined)).toBe(true)
    expect(h.notifier.notifications.map((n) => n.title)).toContain('PR #412 merged')
    expect(h.notifier.badge).toBe(0)
  })

  it('closes a watching mission when the PR is closed without merging', async () => {
    const h = await makeEngine()
    const a = await h.api.dispatch({ prId: PR_412 })
    const done = await waitForState(h, a.id, 'needs_you')
    await h.api.setFindingDecisions({ missionId: a.id, roundId: done.rounds[0].id, decision: 'approved' })
    await h.api.postComment(a.id)
    await waitForState(h, a.id, 'watching')
    h.github.simulateClose(PR_412, false)
    await h.api.refreshInbox()
    expect(missionOf(await h.api.getSnapshot(), a.id).state).toBe('closed')
    expect(h.notifier.notifications.map((n) => n.title)).toContain('PR #412 closed')
  })

  it('closeMission from the user removes the worktree and frees the slot', async () => {
    const h = await makeEngine()
    const a = await h.api.dispatch({ prId: PR_412 })
    const b = await h.api.dispatch({ prId: PR_1203 })
    const c = await h.api.dispatch({ prId: PR_77 })
    await waitForState(h, a.id, 'needs_you')
    await waitForState(h, b.id, 'needs_you')
    await h.api.closeMission(a.id)
    const closed = missionOf(await h.api.getSnapshot(), a.id)
    expect(closed.state).toBe('closed')
    expect(closed.worktreePath).toBeUndefined()
    expect(h.worktree.trees.size).toBe(1)
    const cDone = await waitForState(h, c.id, 'needs_you')
    expect(cDone.slotId).toBe('slot-1')
  })

  it('cancels a running mission, then retries it', async () => {
    const h = await makeEngine()
    h.runner.block = true
    const a = await h.api.dispatch({ prId: PR_412 })
    await waitForState(h, a.id, 'reviewing')
    await h.api.cancelMission(a.id)
    const failed = await waitForState(h, a.id, 'failed')
    expect(failed.error).toBe('Cancelled')
    expect(failed.slotId).toBeUndefined()
    expect(failed.rounds[0].error).toBe('Cancelled')
    expect((await h.api.getSnapshot()).slots.every((s) => s.missionId === undefined)).toBe(true)
    expect(h.notifier.notifications.some((n) => n.title.startsWith('Review failed'))).toBe(false)
    const activity = await h.api.getActivity(a.id)
    expect(activity[activity.length - 1]).toMatchObject({ kind: 'error', text: 'Cancelled' })

    h.runner.release()
    await h.api.retryMission(a.id)
    const done = await waitForState(h, a.id, 'needs_you')
    expect(done.error).toBeUndefined()
    expect(done.rounds).toHaveLength(2)
    expect(done.rounds[1].findings.length).toBeGreaterThan(0)
    expect(h.worktree.trees.get(done.worktreePath!)?.prepared).toBe(2)
  })

  it('cancels a queued mission directly', async () => {
    const h = await makeEngine()
    const a = await h.api.dispatch({ prId: PR_412 })
    const b = await h.api.dispatch({ prId: PR_1203 })
    const c = await h.api.dispatch({ prId: PR_77 })
    await waitForState(h, a.id, 'needs_you')
    await waitForState(h, b.id, 'needs_you')
    await h.api.cancelMission(c.id)
    const failed = missionOf(await h.api.getSnapshot(), c.id)
    expect(failed.state).toBe('failed')
    expect(failed.error).toBe('Cancelled')
    expect(failed.rounds).toHaveLength(0)
  })

  it('marks the mission failed with a notification when the review throws', async () => {
    const h = await makeEngine()
    h.runner.inner.failNext = true
    const a = await h.api.dispatch({ prId: PR_412 })
    const failed = await waitForState(h, a.id, 'failed')
    expect(failed.error).toContain('rate limit')
    expect(failed.rounds[0].error).toContain('rate limit')
    expect(failed.slotId).toBeUndefined()
    expect(h.notifier.notifications.map((n) => n.title)).toContain('Review failed: #412')
    await h.api.retryMission(a.id)
    await waitForState(h, a.id, 'needs_you')
  })

  it('keeps the activity tail on the round, on success and on failure', async () => {
    const h = await makeEngine()
    const a = await h.api.dispatch({ prId: PR_412 })
    const done = await waitForState(h, a.id, 'needs_you')
    const live = await h.api.getActivity(a.id)
    expect(live.length).toBeGreaterThan(2)
    expect(done.rounds[0].activity).toEqual(live.slice(-80))
    expect(done.rounds[0].activity?.at(-1)?.kind).toBe('done')

    h.runner.inner.failNext = true
    const b = await h.api.dispatch({ prId: PR_1203 })
    const failed = await waitForState(h, b.id, 'failed')
    const round = failed.rounds[0]
    expect(round.activity?.length).toBeGreaterThan(1)
    expect(round.activity?.at(-1)).toMatchObject({ kind: 'error', text: 'claude exited with code 1: rate limit reached' })
    expect(round.activity).toEqual((await h.api.getActivity(b.id)).slice(-80))
    expect(round.durationMs).toBe(0)
    expect(round.costUsd).toBeUndefined()
  })

  it('records the cost and duration a runner failure reports on the failed round', async () => {
    const h = await makeEngine()
    h.runner.failWith = Object.assign(new Error('Claude finished without a findings payload. Estimated cost $1.73.'), { costUsd: 1.73, durationMs: 277_000 })
    const a = await h.api.dispatch({ prId: PR_412 })
    const failed = await waitForState(h, a.id, 'failed')
    expect(failed.error).toContain('Estimated cost $1.73.')
    expect(failed.rounds[0]).toMatchObject({ error: failed.error, costUsd: 1.73, durationMs: 277_000 })
    expect(failed.rounds[0].findings).toEqual([])
  })

  it('stamps each round with the model and effort from settings, then the model the runner resolved', async () => {
    const h = await makeEngine({ settings: { claudeModel: 'opus', claudeEffort: 'high' } })
    h.runner.block = true
    const a = await h.api.dispatch({ prId: PR_412 })
    const reviewing = await waitForState(h, a.id, 'reviewing')
    expect(reviewing.rounds[0]).toMatchObject({ model: 'opus', effort: 'high' })
    h.runner.release()
    const done = await waitForState(h, a.id, 'needs_you')
    expect(done.rounds[0]).toMatchObject({ model: 'demo-reviewer', effort: 'high' })

    h.runner.inner.failNext = true
    const b = await h.api.dispatch({ prId: PR_1203 })
    const failed = await waitForState(h, b.id, 'failed')
    expect(failed.rounds[0]).toMatchObject({ model: 'opus', effort: 'high' })
  })

  it('labels the CLI default model and effort on the round', async () => {
    const h = await makeEngine({ settings: { claudeModel: '', claudeEffort: undefined } })
    h.runner.inner.failNext = true
    const a = await h.api.dispatch({ prId: PR_412 })
    const failed = await waitForState(h, a.id, 'failed')
    expect(failed.rounds[0]).toMatchObject({ model: 'default', effort: 'default' })
  })

  it('clears the retired slash command from persisted loadouts but keeps a user-entered message', async () => {
    const settings = defaultSettings({ pollIntervalSec: 3600 })
    const message = 'Use the security-review skill on pull request #{number}'
    settings.loadouts = settings.loadouts.map((l) =>
      l.id === 'blind' ? { ...l, slashCommand: RETIRED_SLASH_COMMANDS[0] } : l.id === 'security' ? { ...l, slashCommand: message } : l
    )
    const h = await makeEngine({ store: new MemoryStore({ missions: [], inbox: [], settings }), poll: false })
    const loaded = (await h.api.getSnapshot()).settings.loadouts
    expect(loaded.find((l) => l.id === 'blind')).not.toHaveProperty('slashCommand')
    expect(loaded.find((l) => l.id === 'security')?.slashCommand).toBe(message)
    expect(loaded.find((l) => l.id === 'product')).not.toHaveProperty('slashCommand')
  })

  it('posts without stopping for autoPost repos', async () => {
    const h = await makeEngine({ settings: { autoPostRepos: ['acme/checkout-api'] } })
    const a = await h.api.dispatch({ prId: PR_412 })
    expect(a.autoPost).toBe(true)
    const m = await waitForState(h, a.id, 'watching')
    expect(m.timeline.map((e) => e.to)).toEqual(['queued', 'preparing', 'reviewing', 'posting', 'watching'])
    expect(m.rounds[0].findings.every((f) => f.decision === 'approved')).toBe(true)
    expect(m.rounds[0].postedCommentUrl).toBeDefined()
    expect(m.rounds[0].briefing).toContain('idempotency_key')
    expect(h.github.comments).toHaveLength(1)
    expect(h.github.comments[0].body).toContain(m.rounds[0].findings[0].title)
    expect(h.github.comments[0].body).not.toContain('idempotency_key')
    expect(h.notifier.notifications.some((n) => n.title.startsWith('Findings ready'))).toBe(false)

    const b = await h.api.dispatch({ prId: 'acme/checkout-api#419', autoPost: false })
    expect(b.autoPost).toBe(false)
    await waitForState(h, b.id, 'needs_you')
    expect(h.github.comments).toHaveLength(1)
  })

  it('returns to needs_you with an error when posting fails, and a retry works', async () => {
    const h = await makeEngine()
    const a = await h.api.dispatch({ prId: PR_412 })
    const done = await waitForState(h, a.id, 'needs_you')
    await h.api.setFindingDecisions({ missionId: a.id, roundId: done.rounds[0].id, decision: 'approved' })
    h.github.failNextPost = true
    await expect(h.api.postComment(a.id)).rejects.toThrow('502')
    const back = missionOf(await h.api.getSnapshot(), a.id)
    expect(back.state).toBe('needs_you')
    expect(back.slotId).toBe('slot-1')
    expect(back.error).toContain('502')
    expect(back.rounds[0].postedAt).toBeUndefined()
    expect(h.notifier.notifications.map((n) => n.title)).toContain('Posting failed: #412')

    const { url } = await h.api.postComment(a.id)
    expect(url).toContain('issuecomment')
    const watching = await waitForState(h, a.id, 'watching')
    expect(watching.error).toBeUndefined()
    expect(h.github.comments).toHaveLength(1)
  })

  it('fails with a settings hint when no local checkout is known', async () => {
    const h = await makeEngine({ repos: new MockRepos([]) })
    const a = await h.api.dispatch({ prId: PR_412 })
    const failed = await waitForState(h, a.id, 'failed')
    expect(failed.error).toBe('No local checkout found for acme/checkout-api. Add its path in Settings > Repositories.')
    expect(failed.rounds).toHaveLength(0)
    expect(h.worktree.trees.size).toBe(0)

    await h.api.updateSettings({ repoPaths: { 'acme/checkout-api': '~/Projects/checkout-api' } })
    await h.api.retryMission(a.id)
    const done = await waitForState(h, a.id, 'needs_you')
    expect(h.worktree.trees.get(done.worktreePath!)?.localRepoPath).toBe('/Users/demo/Projects/checkout-api')
  })

  it('recovers in-flight missions from persisted state after a restart', async () => {
    const first = await makeEngine()
    first.runner.block = true
    const a = await first.api.dispatch({ prId: PR_412 })
    const b = await first.api.dispatch({ prId: PR_1203 })
    await waitForState(first, a.id, 'reviewing')
    await waitForState(first, b.id, 'reviewing')
    await first.engine.stop()
    live.splice(live.indexOf(first), 1)
    const persisted = first.store.state!
    expect(persisted.missions.map((m) => m.state)).toEqual(['reviewing', 'reviewing'])

    const second = await makeEngine({ store: new MemoryStore(persisted) })
    const snap = await second.api.getSnapshot()
    for (const id of [a.id, b.id]) {
      const m = missionOf(snap, id)
      expect(m.timeline.some((e) => e.from === 'reviewing' && e.to === 'queued' && e.note === 'recovered after restart')).toBe(true)
    }
    const aDone = await waitForState(second, a.id, 'needs_you')
    await waitForState(second, b.id, 'needs_you')
    expect(second.worktree.trees.has(aDone.worktreePath!)).toBe(true)
    expect(aDone.rounds).toHaveLength(2)
    expect(aDone.rounds[0].error).toBeUndefined()
  })

  it('re-derives slot links on restart and requeues the newer of two claimants', async () => {
    const seed = new MockGitHub({ clock: new FakeClock() })
    const prs = seed.all()
    const pr412 = prs.find((p) => p.id === PR_412)!
    const pr1203 = prs.find((p) => p.id === PR_1203)!
    const pr77 = prs.find((p) => p.id === PR_77)!
    const mk = (id: string, pr: PullRequest, state: Mission['state'], slotId: string, updatedAt: string): Mission => ({
      id,
      prId: pr.id,
      pr,
      loadoutId: 'blind',
      state,
      slotId,
      preferredSlotId: slotId,
      worktreePath: `/Users/demo/.overlook/worktrees/${pr.repo.owner}/${pr.repo.name}/pr-${pr.number}`,
      rounds: [
        {
          id: `${id}-r1`,
          index: 1,
          headSha: pr.headSha,
          startedAt: updatedAt,
          finishedAt: updatedAt,
          findings: [],
          summary: 'x',
          verdict: 'comment'
        }
      ],
      stale: false,
      autoPost: false,
      createdAt: updatedAt,
      updatedAt,
      timeline: [{ at: updatedAt, to: 'queued' }, { at: updatedAt, from: 'reviewing', to: state }]
    })
    const persisted: PersistedState = {
      missions: [
        mk('older', pr412, 'needs_you', 'slot-1', '2026-09-13T10:00:00.000Z'),
        mk('newer', pr1203, 'needs_you', 'slot-1', '2026-09-13T11:00:00.000Z'),
        mk('posting', pr77, 'posting', 'slot-2', '2026-09-13T11:30:00.000Z')
      ],
      inbox: [],
      settings: defaultSettings({ pollIntervalSec: 3600 })
    }
    const h = await makeEngine({ store: new MemoryStore(persisted), poll: false })
    const snap = await h.api.getSnapshot()
    expect(missionOf(snap, 'older').state).toBe('needs_you')
    expect(missionOf(snap, 'older').slotId).toBe('slot-1')
    expect(snap.slots.find((s) => s.id === 'slot-1')?.missionId).toBe('older')
    const newer = missionOf(snap, 'newer')
    expect(newer.timeline.some((e) => e.to === 'queued' && e.note?.startsWith('recovered after restart'))).toBe(true)
    expect(newer.slotId === undefined || newer.slotId === 'slot-2').toBe(true)
    const posting = missionOf(snap, 'posting')
    expect(posting.state).toBe('needs_you')
    expect(posting.slotId).toBe('slot-2')
    expect(posting.timeline.some((e) => e.from === 'posting' && e.to === 'needs_you' && e.note === 'recovered after restart; post again')).toBe(true)
    expect(h.notifier.badge).toBe(2)
  })

  it('validates settings updates and rebuilds slots keeping links', async () => {
    const h = await makeEngine()
    await expect(h.api.updateSettings({ pollIntervalSec: 5 })).rejects.toThrow('pollIntervalSec')
    await expect(h.api.updateSettings({ slots: [] })).rejects.toThrow('slot')
    await expect(h.api.updateSettings({ defaultLoadoutId: 'nope' })).rejects.toThrow("defaultLoadoutId 'nope'")
    await expect(h.api.updateSettings({ maxAutoRoundsPerMission: -1 })).rejects.toThrow('maxAutoRoundsPerMission')
    await expect(h.api.updateSettings({ maxAutoRoundsPerMission: 1.5 })).rejects.toThrow('maxAutoRoundsPerMission')
    await expect(h.api.updateSettings({ maxPrAgeDays: -1 })).rejects.toThrow('maxPrAgeDays')
    await expect(h.api.updateSettings({ maxPrAgeDays: 2.5 })).rejects.toThrow('maxPrAgeDays')
    await expect(h.api.updateSettings({ inactiveRepos: 'acme/x' as unknown as string[] })).rejects.toThrow('inactiveRepos')
    expect((await h.api.getSnapshot()).settings.pollIntervalSec).toBe(3600)

    const a = await h.api.dispatch({ prId: PR_412 })
    await waitForState(h, a.id, 'needs_you')
    const updated = await h.api.updateSettings({
      pollIntervalSec: 60,
      slots: [
        { id: 'slot-1', name: 'Ada', color: '#ffffff' },
        { id: 'slot-2', name: 'Nova', color: '#4fd1c5' },
        { id: 'slot-3', name: 'Rex', color: '#000000' }
      ],
      signature: 'reviewed by robots'
    })
    expect(updated.pollIntervalSec).toBe(60)
    expect(updated.slots).toHaveLength(3)
    const snap = await h.api.getSnapshot()
    expect(snap.slots.map((s) => [s.id, s.name, s.missionId])).toEqual([
      ['slot-1', 'Ada', a.id],
      ['slot-2', 'Nova', undefined],
      ['slot-3', 'Rex', undefined]
    ])
    await sleep(300)
    expect(h.store.state?.settings.signature).toBe('reviewed by robots')

    // Two more missions now fit at once.
    const b = await h.api.dispatch({ prId: PR_1203 })
    const c = await h.api.dispatch({ prId: PR_77 })
    await waitForState(h, b.id, 'needs_you')
    await waitForState(h, c.id, 'needs_you')
    expect((await h.api.previewComment(a.id)).trim().endsWith('reviewed by robots')).toBe(true)
  })

  it('tracks the needs_you count on the badge', async () => {
    const h = await makeEngine()
    expect(h.notifier.badge).toBe(0)
    const a = await h.api.dispatch({ prId: PR_412 })
    const b = await h.api.dispatch({ prId: PR_1203 })
    const aDone = await waitForState(h, a.id, 'needs_you')
    await waitForState(h, b.id, 'needs_you')
    expect(h.notifier.badge).toBe(2)
    await h.api.setFindingDecisions({ missionId: a.id, roundId: aDone.rounds[0].id, decision: 'approved' })
    await h.api.postComment(a.id)
    await waitForState(h, a.id, 'watching')
    expect(h.notifier.badge).toBe(1)
    await h.api.closeMission(b.id)
    expect(h.notifier.badge).toBe(0)
  })

  it('hands out clones, never live state', async () => {
    const h = await makeEngine()
    const a = await h.api.dispatch({ prId: PR_412 })
    await waitForState(h, a.id, 'needs_you')
    const snap = await h.api.getSnapshot()
    const m = missionOf(snap, a.id)
    m.state = 'closed'
    m.rounds[0].findings[0].decision = 'dropped'
    snap.settings.slots.pop()
    snap.inbox.length = 0
    snap.slots[0].missionId = undefined
    const again = await h.api.getSnapshot()
    expect(missionOf(again, a.id).state).toBe('needs_you')
    expect(missionOf(again, a.id).rounds[0].findings[0].decision).toBe('pending')
    expect(again.settings.slots).toHaveLength(2)
    expect(again.inbox.length).toBeGreaterThan(0)
    expect(again.slots[0].missionId).toBe(a.id)

    a.state = 'failed'
    expect(missionOf(await h.api.getSnapshot(), a.id).state).toBe('needs_you')
    const activity = await h.api.getActivity(a.id)
    activity.length = 0
    expect((await h.api.getActivity(a.id)).length).toBeGreaterThan(0)
  })

  it('pushes coalesced snapshot events, activities and notifications', async () => {
    const h = await makeEngine()
    const snapshots: AppSnapshot[] = []
    const kinds: string[] = []
    const titles: string[] = []
    const off = h.engine.subscribe('snapshot', (s) => snapshots.push(s))
    h.engine.subscribe('activity', (a) => kinds.push(a.kind))
    h.engine.subscribe('notification', (n) => titles.push(n.title))
    const a = await h.api.dispatch({ prId: PR_412 })
    await waitForState(h, a.id, 'needs_you')
    await sleep(30)
    expect(snapshots.length).toBeGreaterThan(0)
    expect(snapshots.length).toBeLessThan(10)
    const last = snapshots[snapshots.length - 1]
    expect(missionOf(last, a.id).state).toBe('needs_you')
    expect(last.version).toBe('test')
    expect(last.githubLogin).toBe('ritchey')
    expect(last.lastPollAt).toBe(h.clock.now().toISOString())
    expect(titles).toContain(`Findings ready: #412 ${missionOf(last, a.id).pr.title}`)
    last.missions.length = 0
    expect((await h.api.getSnapshot()).missions).toHaveLength(1)
    expect(kinds[0]).toBe('preparing')
    expect(kinds[kinds.length - 1]).toBe('done')
    off()
    const before = snapshots.length
    await h.api.updateSettings({ signature: 'x' })
    await sleep(30)
    expect(snapshots.length).toBe(before)
  })

  it('keeps the old inbox and reports pollError when GitHub fails, then recovers', async () => {
    const h = await makeEngine()
    const before = await h.api.getSnapshot()
    expect(before.inbox.length).toBe(6)
    expect(before.pollError).toBeUndefined()
    const original = h.github.listReviewRequested.bind(h.github)
    h.github.listReviewRequested = async () => {
      throw new Error('gh: network unreachable')
    }
    const failed = await h.api.refreshInbox()
    expect(failed.pollError).toBe('gh: network unreachable')
    expect(failed.inbox.length).toBe(6)
    h.github.listReviewRequested = original
    const ok = await h.api.refreshInbox()
    expect(ok.pollError).toBeUndefined()
  })

  it('merges review-requested and mine lists, honouring includeMine', async () => {
    const h = await makeEngine()
    const snap = await h.api.getSnapshot()
    expect(snap.inbox.filter((p) => p.mine)).toHaveLength(2)
    expect(snap.inbox.filter((p) => p.reviewRequested)).toHaveLength(4)
    await h.api.updateSettings({ includeMine: false })
    const without = await h.api.refreshInbox()
    expect(without.inbox).toHaveLength(4)
    expect(without.inbox.every((p) => p.reviewRequested)).toBe(true)
  })

  it('keeps a PR with an active mission in the inbox after it is un-requested', async () => {
    const h = await makeEngine()
    const a = await h.api.dispatch({ prId: PR_412 })
    await waitForState(h, a.id, 'needs_you')
    const original = h.github.listReviewRequested.bind(h.github)
    h.github.listReviewRequested = async () => (await original()).filter((p) => p.id !== PR_412)
    const snap = await h.api.refreshInbox()
    expect(snap.inbox.some((p) => p.id === PR_412)).toBe(true)
    expect(missionOf(snap, a.id).state).toBe('needs_you')
    await h.api.closeMission(a.id)
    const after = await h.api.refreshInbox()
    expect(after.inbox.some((p) => p.id === PR_412)).toBe(false)
  })

  it('flags a running mission stale when its PR is pushed mid-review', async () => {
    const h = await makeEngine()
    h.runner.block = true
    const a = await h.api.dispatch({ prId: PR_412 })
    await waitForState(h, a.id, 'reviewing')
    const pushed = h.github.simulatePush(PR_412)
    await h.api.refreshInbox()
    expect(missionOf(await h.api.getSnapshot(), a.id).stale).toBe(true)
    h.runner.release()
    const done = await waitForState(h, a.id, 'needs_you')
    expect(done.stale).toBe(true)
    expect(done.rounds[0].headSha).not.toBe(pushed.headSha)
  })

  it('demoSimulate drives the controls then polls; a no-op without controls', async () => {
    const h = await makeEngine()
    await h.api.demoSimulate({ kind: 'new_pr' })
    expect((await h.api.getSnapshot()).inbox).toHaveLength(6)

    const clock = new FakeClock()
    const github = new MockGitHub({ clock })
    const runner = new MockRunner(0)
    const engine = createEngine({
      ports: {
        github,
        worktree: new MockWorktree(0),
        runner,
        repos: new MockRepos(),
        store: new MemoryStore({ missions: [], inbox: [], settings: defaultSettings({ pollIntervalSec: 3600 }) }),
        notifier: new MockNotifier(),
        clock
      },
      version: 'test',
      homeDir: '/Users/demo',
      demoControls: {
        simulatePush: (prId) => void github.simulatePush(prId),
        simulateClose: (prId, merged) => void github.simulateClose(prId, merged),
        simulateNewPullRequest: () => void github.simulateNewPullRequest(),
        failNextReview: () => {
          runner.failNext = true
        }
      }
    })
    await engine.start()
    try {
      await engine.api.refreshInbox()
      await engine.api.demoSimulate({ kind: 'new_pr' })
      expect((await engine.api.getSnapshot()).inbox).toHaveLength(7)
      await expect(engine.api.demoSimulate({ kind: 'push' })).rejects.toThrow('prId is required')
      await engine.api.demoSimulate({ kind: 'merge', prId: PR_77 })
      expect((await engine.api.getSnapshot()).inbox.some((p) => p.id === PR_77)).toBe(false)
      await engine.api.demoSimulate({ kind: 'fail_next_review' })
      expect(runner.failNext).toBe(true)
    } finally {
      await engine.stop()
    }
  })

  it('persists debounced and flushes on stop without persisting activity', async () => {
    const h = await makeEngine()
    const savesAfterStart = h.store.saves
    const a = await h.api.dispatch({ prId: PR_412 })
    await waitForState(h, a.id, 'needs_you')
    await sleep(300)
    expect(h.store.saves).toBeGreaterThan(savesAfterStart)
    expect(h.store.saves - savesAfterStart).toBeLessThan(4)
    expect(h.store.state?.missions[0].state).toBe('needs_you')
    expect(Object.keys(h.store.state ?? {}).sort()).toEqual(['inbox', 'lastPollAt', 'missions', 'settings'])
    await h.engine.stop()
    live.splice(live.indexOf(h), 1)
    expect(h.store.state?.missions[0].state).toBe('needs_you')
  })

  it('stays closed when the PR is merged while a comment is being posted', async () => {
    const h = await makeEngine()
    const a = await h.api.dispatch({ prId: PR_412 })
    const done = await waitForState(h, a.id, 'needs_you')
    await h.api.setFindingDecisions({ missionId: a.id, roundId: done.rounds[0].id, decision: 'approved' })

    const original = h.github.postComment.bind(h.github)
    let release: () => void = () => undefined
    const gate = new Promise<void>((r) => (release = r))
    h.github.postComment = async (fullName, number, body) => {
      await gate
      return original(fullName, number, body)
    }
    const posting = h.api.postComment(a.id)
    await waitForState(h, a.id, 'posting')
    await h.api.closeMission(a.id)
    expect(missionOf(await h.api.getSnapshot(), a.id).state).toBe('closed')
    release()
    await posting
    await sleep(20)
    const after = missionOf(await h.api.getSnapshot(), a.id)
    expect(after.state).toBe('closed')
    expect(after.rounds[0].postedCommentUrl).toBeDefined()
    expect((await h.api.getSnapshot()).slots.every((s) => s.missionId === undefined)).toBe(true)
    await expect(h.api.rerunMission(a.id)).rejects.toThrow("Cannot rerun from state 'closed'")
  })

  it('does not treat a failed round as the previous round on retry', async () => {
    const h = await makeEngine()
    h.runner.inner.failNext = true
    const a = await h.api.dispatch({ prId: PR_412 })
    await waitForState(h, a.id, 'failed')
    await h.api.retryMission(a.id)
    const done = await waitForState(h, a.id, 'needs_you')
    expect(done.rounds).toHaveLength(2)
    expect(done.rounds[1].previousHeadSha).toBeUndefined()
    const retry = h.runner.calls.find((r) => r.mission.id === a.id && r.round.id === done.rounds[1].id)
    expect(retry?.previousRound).toBeUndefined()
    expect(done.rounds[1].findings).toHaveLength(4)
    expect(await h.api.previewComment(a.id)).not.toContain('Follow-up')

    // After a real posted round, a later retry still follows up on the posted one.
    await h.api.setFindingDecisions({ missionId: a.id, roundId: done.rounds[1].id, decision: 'approved' })
    await h.api.postComment(a.id)
    await waitForState(h, a.id, 'watching')
    h.runner.inner.failNext = true
    await h.api.rerunMission(a.id)
    await waitForState(h, a.id, 'failed')
    await h.api.retryMission(a.id)
    const again = await waitForState(h, a.id, 'needs_you')
    expect(again.rounds).toHaveLength(4)
    expect(again.rounds[3].previousHeadSha).toBe(done.rounds[1].headSha)
    const followUp = h.runner.calls.find((r) => r.round.id === again.rounds[3].id)
    expect(followUp?.previousRound?.id).toBe(done.rounds[1].id)
  })

  it('follows up after posting when the push arrived mid-review', async () => {
    const h = await makeEngine()
    h.runner.block = true
    const a = await h.api.dispatch({ prId: PR_412 })
    await waitForState(h, a.id, 'reviewing')
    const pushed = h.github.simulatePush(PR_412)
    await h.api.refreshInbox()
    h.runner.release()
    const done = await waitForState(h, a.id, 'needs_you')
    expect(done.stale).toBe(true)
    await h.api.setFindingDecisions({ missionId: a.id, roundId: done.rounds[0].id, decision: 'approved' })
    await h.api.postComment(a.id)
    await waitForState(h, a.id, 'watching')

    // Without a reply the moved head only marks the review stale.
    await h.api.refreshInbox()
    await sleep(20)
    const waiting = missionOf(await h.api.getSnapshot(), a.id)
    expect(waiting.state).toBe('watching')
    expect(waiting.stale).toBe(true)
    expect(waiting.timeline[waiting.timeline.length - 1].note).toBe(`new push ${pushed.headSha.slice(0, 7)}; waiting for a reply`)

    authorReplies(h, PR_412)
    await h.api.refreshInbox()
    const followUp = await waitForState(h, a.id, 'needs_you')
    expect(followUp.stale).toBe(false)
    expect(followUp.rounds).toHaveLength(2)
    expect(followUp.rounds[1].headSha).toBe(pushed.headSha)
    expect(followUp.rounds[1].previousHeadSha).toBe(done.rounds[0].headSha)
    expect(
      followUp.timeline.some((e) => e.from === 'watching' && e.to === 'queued' && e.note === `dami-codes replied; follow-up on ${pushed.headSha.slice(0, 7)}`)
    ).toBe(true)

    // Nothing new: the next poll leaves the posted follow-up alone.
    await h.api.setFindingDecisions({ missionId: a.id, roundId: followUp.rounds[1].id, decision: 'approved' })
    await h.api.postComment(a.id)
    await waitForState(h, a.id, 'watching')
    await h.api.refreshInbox()
    await sleep(20)
    expect(missionOf(await h.api.getSnapshot(), a.id).state).toBe('watching')
  })

  it('sanitises corrupt persisted state instead of polling in a tight loop', async () => {
    const corrupt = {
      missions: 'nope',
      inbox: null,
      settings: { pollIntervalSec: 0, slots: [], defaultLoadoutId: 'gone', loadouts: undefined }
    } as unknown as PersistedState
    const clock = new FakeClock()
    const github = new MockGitHub({ clock })
    let lists = 0
    const original = github.listReviewRequested.bind(github)
    github.listReviewRequested = async () => {
      lists++
      return original()
    }
    const h = await makeEngine({ store: new MemoryStore(corrupt), github })
    const snap = await h.api.getSnapshot()
    expect(snap.missions).toEqual([])
    expect(snap.settings.pollIntervalSec).toBeGreaterThanOrEqual(15)
    expect(snap.settings.slots).toHaveLength(2)
    expect(snap.settings.defaultLoadoutId).toBe('blind')
    expect(snap.settings.loadouts.length).toBeGreaterThan(0)
    const seen = lists
    await sleep(60)
    expect(lists).toBe(seen)
    const m = await h.api.dispatch({ prId: PR_412 })
    await waitForState(h, m.id, 'needs_you')
  })

  it('holds dispatched missions until the first repo discovery has finished', async () => {
    const clock = new FakeClock()
    const github = new MockGitHub({ clock })
    const worktree = new MockWorktree(0)
    let release: () => void = () => undefined
    const gate = new Promise<void>((r) => (release = r))
    const repos = new MockRepos()
    const slowDiscover = repos.discover.bind(repos)
    repos.discover = async () => {
      await gate
      return slowDiscover()
    }
    const inbox = github.all().filter((p) => p.state === 'open')
    const settings = defaultSettings({ pollIntervalSec: 3600 })
    const engine = createEngine({
      ports: { github, worktree, runner: new MockRunner(0), repos, store: new MemoryStore({ missions: [], inbox, settings }), notifier: new MockNotifier(), clock },
      version: 'test',
      homeDir: '/Users/demo'
    })
    await engine.start()
    try {
      const m = await engine.api.dispatch({ prId: PR_412 })
      expect(m.state).toBe('queued')
      await sleep(20)
      expect((await engine.api.getSnapshot()).missions[0].state).toBe('queued')
      release()
      const h = { api: engine.api } as Harness
      const done = await waitForState(h, m.id, 'needs_you')
      expect(worktree.trees.get(done.worktreePath!)?.localRepoPath).toBe('/Users/demo/Projects/checkout-api')
    } finally {
      await engine.stop()
    }
  })

  it('refuses to remove a slot that a mission is holding', async () => {
    const h = await makeEngine()
    const a = await h.api.dispatch({ prId: PR_412 })
    const b = await h.api.dispatch({ prId: PR_1203 })
    await waitForState(h, a.id, 'needs_you')
    await waitForState(h, b.id, 'needs_you')
    await expect(h.api.updateSettings({ slots: [{ id: 'slot-1', name: 'Vhagar', color: '#f5b544' }] })).rejects.toThrow('Nova is busy')
    const snap = await h.api.getSnapshot()
    expect(snap.settings.slots).toHaveLength(2)
    expect(snap.slots.map((s) => s.missionId)).toEqual([a.id, b.id])
    await h.api.closeMission(b.id)
    const updated = await h.api.updateSettings({ slots: [{ id: 'slot-1', name: 'Vhagar', color: '#f5b544' }] })
    expect(updated.slots).toHaveLength(1)
    expect((await h.api.getSnapshot()).slots.map((s) => s.missionId)).toEqual([a.id])
  })

  it('does not duplicate an inbox entry when two dispatches fetch the same unknown PR', async () => {
    const h = await makeEngine()
    const fresh = h.github.simulateNewPullRequest()
    const results = await Promise.allSettled([h.api.dispatch({ prId: fresh.id }), h.api.dispatch({ prId: fresh.id })])
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1)
    const snap = await h.api.getSnapshot()
    expect(snap.inbox.filter((p) => p.id === fresh.id)).toHaveLength(1)
    expect(snap.missions.filter((m) => m.prId === fresh.id)).toHaveLength(1)
  })

  it('refuses to cancel while the comment is being posted', async () => {
    const h = await makeEngine()
    const a = await h.api.dispatch({ prId: PR_412 })
    const done = await waitForState(h, a.id, 'needs_you')
    await h.api.setFindingDecisions({ missionId: a.id, roundId: done.rounds[0].id, decision: 'approved' })
    const original = h.github.postComment.bind(h.github)
    let release: () => void = () => undefined
    const gate = new Promise<void>((r) => (release = r))
    h.github.postComment = async (fullName, number, body) => {
      await gate
      return original(fullName, number, body)
    }
    const posting = h.api.postComment(a.id)
    await waitForState(h, a.id, 'posting')
    await expect(h.api.cancelMission(a.id)).rejects.toThrow('posting its comment')
    release()
    await posting
    const after = await waitForState(h, a.id, 'watching')
    expect(after.rounds[0].postedCommentUrl).toBeDefined()
    expect(after.error).toBeUndefined()
  })

  it('records a bulk drop reason and leaves a plain drop without one', async () => {
    const h = await makeEngine()
    const a = await h.api.dispatch({ prId: PR_412 })
    const done = await waitForState(h, a.id, 'needs_you')
    const round = done.rounds[0]
    const nits = round.findings.filter((f) => f.severity === 'nit').map((f) => f.id)
    expect(nits.length).toBeGreaterThan(0)
    await h.api.setFindingDecisions({ missionId: a.id, roundId: round.id, decision: 'dropped', findingIds: nits, dropReason: 'not_worth_it', dropNote: 'cosmetic' })
    await h.api.setFindingDecision({ missionId: a.id, roundId: round.id, findingId: round.findings[0].id, decision: 'dropped' })
    const triaged = latestRound(missionOf(await h.api.getSnapshot(), a.id))!
    for (const id of nits) {
      expect(triaged.findings.find((f) => f.id === id)).toMatchObject({ decision: 'dropped', dropReason: 'not_worth_it', dropNote: 'cosmetic' })
    }
    expect(triaged.findings[0].decision).toBe('dropped')
    expect(triaged.findings[0].dropReason).toBeUndefined()

    await h.api.setFindingDecisions({ missionId: a.id, roundId: round.id, decision: 'dropped' })
    const again = latestRound(missionOf(await h.api.getSnapshot(), a.id))!
    expect(again.findings.every((f) => f.decision === 'dropped')).toBe(true)
    expect(again.findings.find((f) => f.id === nits[0])?.dropReason).toBe('not_worth_it')
    expect(again.findings[0].dropReason).toBeUndefined()
    await h.api.setFindingDecision({ missionId: a.id, roundId: round.id, findingId: nits[0], decision: 'approved' })
    const approved = latestRound(missionOf(await h.api.getSnapshot(), a.id))!.findings.find((f) => f.id === nits[0])!
    expect(approved.dropReason).toBeUndefined()
    expect(approved.dropNote).toBeUndefined()
  })

  it('starts from the defaultSettings overrides and falls back to them for invalid persisted fields', async () => {
    const boot = async (store: MemoryStore) => {
      const clock = new FakeClock()
      const engine = createEngine({
        ports: { github: new MockGitHub({ clock }), worktree: new MockWorktree(0), runner: new MockRunner(0), repos: new MockRepos(), store, notifier: new MockNotifier(), clock },
        version: 'test',
        homeDir: '/Users/demo',
        defaultSettings: { pollIntervalSec: 45, demoMode: false }
      })
      await engine.start()
      try {
        return (await engine.api.getSnapshot()).settings
      } finally {
        await engine.stop()
      }
    }
    const fresh = await boot(new MemoryStore(null))
    expect(fresh.pollIntervalSec).toBe(45)
    expect(fresh.demoMode).toBe(false)
    expect(fresh.defaultLoadoutId).toBe('blind')

    const corrupt = await boot(
      new MemoryStore({
        missions: [],
        inbox: [],
        settings: {
          ...defaultSettings(),
          pollIntervalSec: 0,
          demoMode: true,
          maxAutoRoundsPerMission: 'lots' as unknown as number,
          maxPrAgeDays: -3,
          inactiveRepos: 'acme/x' as unknown as string[]
        }
      })
    )
    expect(corrupt.pollIntervalSec).toBe(45)
    expect(corrupt.demoMode).toBe(true)
    expect(corrupt.maxAutoRoundsPerMission).toBe(0)
    expect(corrupt.maxPrAgeDays).toBe(30)
    expect(corrupt.inactiveRepos).toEqual([])
    expect(corrupt.claudeModel).toBe('opus')

    const { claudeModel: _dropped, ...withoutModel } = defaultSettings()
    const missingModel = await boot(new MemoryStore({ missions: [], inbox: [], settings: withoutModel as Settings }))
    expect(missingModel.claudeModel).toBe('opus')
    const cliDefault = await boot(new MemoryStore({ missions: [], inbox: [], settings: { ...defaultSettings(), claudeModel: '' } }))
    expect(cliDefault.claudeModel).toBe('')
    expect(fresh.claudeFallbackModel).toBeUndefined()
    const withFallback = await boot(new MemoryStore({ missions: [], inbox: [], settings: { ...defaultSettings(), claudeFallbackModel: 'sonnet' } }))
    expect(withFallback.claudeFallbackModel).toBe('sonnet')
  })

  it('sends the full diff on round 1 only and says so when it is unavailable', async () => {
    const h = await makeEngine()
    const a = await h.api.dispatch({ prId: PR_412 })
    const done = await waitForState(h, a.id, 'needs_you')
    expect(h.runner.calls[0].diff).toContain('diff --git')
    await h.api.setFindingDecisions({ missionId: a.id, roundId: done.rounds[0].id, decision: 'approved' })
    await h.api.postComment(a.id)
    await waitForState(h, a.id, 'watching')
    h.github.simulatePush(PR_412)
    authorReplies(h, PR_412)
    await h.api.refreshInbox()
    const followUp = await waitForState(h, a.id, 'needs_you')
    expect(followUp.rounds).toHaveLength(2)
    const call = h.runner.calls.find((r) => r.round.id === followUp.rounds[1].id)!
    expect(call.diff).toBe('')
    expect(call.previousRound?.id).toBe(done.rounds[0].id)

    h.github.getDiff = async () => {
      throw new Error('gh: 502 Bad Gateway')
    }
    const b = await h.api.dispatch({ prId: PR_1203 })
    await waitForState(h, b.id, 'needs_you')
    const bCall = h.runner.calls.find((r) => r.mission.id === b.id)!
    expect(bCall.diff).toBe('')
    expect(bCall.previousRound).toBeUndefined()
    const activity = await h.api.getActivity(b.id)
    expect(activity).toContainEqual(
      expect.objectContaining({ kind: 'preparing', text: 'Diff unavailable: gh: 502 Bad Gateway; the reviewer will run git diff itself' })
    )
  })

  it('pauses auto follow-up at the round cap; a manual rerun still works', async () => {
    const h = await makeEngine({ settings: { maxAutoRoundsPerMission: 1 } })
    const a = await h.api.dispatch({ prId: PR_412 })
    const postLatest = async () => {
      const m = missionOf(await h.api.getSnapshot(), a.id)
      await h.api.setFindingDecisions({ missionId: a.id, roundId: latestRound(m)!.id, decision: 'approved' })
      await h.api.postComment(a.id)
      return waitForState(h, a.id, 'watching')
    }
    await waitForState(h, a.id, 'needs_you')
    await postLatest()
    h.github.simulatePush(PR_412)
    authorReplies(h, PR_412)
    await h.api.refreshInbox()
    const second = await waitForState(h, a.id, 'needs_you')
    expect(second.rounds).toHaveLength(2)
    await postLatest()

    const pushed = h.github.simulatePush(PR_412)
    await h.api.refreshInbox()
    await sleep(20)
    const paused = missionOf(await h.api.getSnapshot(), a.id)
    expect(paused.state).toBe('watching')
    expect(paused.stale).toBe(true)
    expect(paused.rounds).toHaveLength(2)
    expect(paused.pr.headSha).toBe(pushed.headSha)
    expect(paused.timeline[paused.timeline.length - 1]).toEqual({
      at: h.clock.now().toISOString(),
      to: 'watching',
      note: `new push ${pushed.headSha.slice(0, 7)}; auto follow-up paused`
    })
    expect(h.notifier.notifications[h.notifier.notifications.length - 1]).toEqual({
      title: 'New push on #412',
      body: 'The automatic follow-up limit (1) is reached. Re-run when ready.',
      missionId: a.id
    })
    expect(h.runner.calls).toHaveLength(2)

    // Nothing new: later polls stay quiet instead of nagging.
    const count = h.notifier.notifications.length
    await h.api.refreshInbox()
    await sleep(20)
    const still = missionOf(await h.api.getSnapshot(), a.id)
    expect(still.state).toBe('watching')
    expect(still.timeline).toHaveLength(paused.timeline.length)
    expect(h.notifier.notifications).toHaveLength(count)

    // A reply cannot get past the cap either.
    authorReplies(h, PR_412)
    await h.api.refreshInbox()
    await sleep(20)
    expect(missionOf(await h.api.getSnapshot(), a.id).state).toBe('watching')
    expect(h.notifier.notifications[h.notifier.notifications.length - 1]).toMatchObject({ title: 'dami-codes replied on #412' })

    await h.api.rerunMission(a.id)
    const third = await waitForState(h, a.id, 'needs_you')
    expect(third.rounds).toHaveLength(3)
    expect(third.stale).toBe(false)
    expect(third.rounds[2].headSha).toBe(pushed.headSha)
    expect(third.rounds[2].trigger).toBe('rerun')
    expect(third.rounds[2].replies).toHaveLength(1)
    expect(third.autoFollowUp).toBeUndefined()
  })

  it('honours the per-mission auto follow-up toggle', async () => {
    const h = await makeEngine()
    const a = await h.api.dispatch({ prId: PR_412 })
    const done = await waitForState(h, a.id, 'needs_you')
    await h.api.setAutoFollowUp({ missionId: a.id, enabled: false })
    expect(missionOf(await h.api.getSnapshot(), a.id).autoFollowUp).toBe(false)
    await h.api.setFindingDecisions({ missionId: a.id, roundId: done.rounds[0].id, decision: 'approved' })
    await h.api.postComment(a.id)
    await waitForState(h, a.id, 'watching')

    const pushed = h.github.simulatePush(PR_412)
    await h.api.refreshInbox()
    await sleep(20)
    const paused = missionOf(await h.api.getSnapshot(), a.id)
    expect(paused.state).toBe('watching')
    expect(paused.stale).toBe(true)
    expect(paused.pr.headSha).toBe(pushed.headSha)
    expect(paused.rounds).toHaveLength(1)
    expect(h.notifier.notifications[h.notifier.notifications.length - 1]).toEqual({
      title: 'New push on #412',
      body: 'Automatic follow-ups are off for this review. Re-run when ready.',
      missionId: a.id
    })

    await h.api.setAutoFollowUp({ missionId: a.id, enabled: true })
    const again = h.github.simulatePush(PR_412)
    authorReplies(h, PR_412)
    await h.api.refreshInbox()
    const followUp = await waitForState(h, a.id, 'needs_you')
    expect(followUp.autoFollowUp).toBe(true)
    expect(followUp.stale).toBe(false)
    expect(followUp.rounds).toHaveLength(2)
    expect(followUp.rounds[1].headSha).toBe(again.headSha)

    await h.api.closeMission(a.id)
    await expect(h.api.setAutoFollowUp({ missionId: a.id, enabled: false })).rejects.toThrow("Cannot change auto follow-up from state 'closed'")
    await expect(h.api.setAutoFollowUp({ missionId: 'nope', enabled: false })).rejects.toThrow('Review not found: nope')
  })

  it('recovers a mission that was posting into needs_you with its triage intact', async () => {
    const first = await makeEngine()
    const a = await first.api.dispatch({ prId: PR_412 })
    const done = await waitForState(first, a.id, 'needs_you')
    const round = done.rounds[0]
    await first.api.setFindingDecision({ missionId: a.id, roundId: round.id, findingId: round.findings[0].id, decision: 'approved' })
    await first.api.setFindingDecision({
      missionId: a.id,
      roundId: round.id,
      findingId: round.findings[1].id,
      decision: 'dropped',
      dropReason: 'false_positive'
    })
    first.github.postComment = () => new Promise(() => undefined)
    void first.api.postComment(a.id).catch(() => undefined)
    await waitForState(first, a.id, 'posting')
    await first.engine.stop()
    live.splice(live.indexOf(first), 1)
    expect(first.store.state?.missions[0].state).toBe('posting')

    const second = await makeEngine({ store: new MemoryStore(first.store.state) })
    await sleep(20)
    const m = missionOf(await second.api.getSnapshot(), a.id)
    expect(m.state).toBe('needs_you')
    expect(m.error).toBe('The app restarted while posting. Check the PR before posting again.')
    expect(m.slotId).toBe('slot-1')
    expect(m.timeline[m.timeline.length - 1]).toMatchObject({ from: 'posting', to: 'needs_you', note: 'recovered after restart; post again' })
    expect(m.rounds).toHaveLength(1)
    expect(m.rounds[0].findings).toHaveLength(4)
    expect(m.rounds[0].findings[0].decision).toBe('approved')
    expect(m.rounds[0].findings[1]).toMatchObject({ decision: 'dropped', dropReason: 'false_positive' })
    expect(m.rounds[0].postedAt).toBeUndefined()
    expect(second.runner.calls).toHaveLength(0)
    expect(second.notifier.badge).toBe(1)
    expect((await second.api.getSnapshot()).slots.find((s) => s.id === 'slot-1')?.missionId).toBe(a.id)

    const { url } = await second.api.postComment(a.id)
    expect(url).toContain('issuecomment')
    const watching = await waitForState(second, a.id, 'watching')
    expect(watching.error).toBeUndefined()
    expect(second.github.comments[0].body).toContain(round.findings[0].title)
    expect(second.github.comments[0].body).not.toContain(round.findings[1].title)
  })

  it('lets the user edit an un-posted summary and posts the edited text', async () => {
    const h = await makeEngine()
    h.runner.block = true
    const a = await h.api.dispatch({ prId: PR_412 })
    const reviewing = await waitForState(h, a.id, 'reviewing')
    await expect(h.api.setRoundSummary({ missionId: a.id, roundId: reviewing.rounds[0].id, summary: 'x' })).rejects.toThrow(
      "Cannot edit the summary from state 'reviewing'"
    )
    h.runner.release()
    const done = await waitForState(h, a.id, 'needs_you')
    const round = done.rounds[0]
    const original = round.summary
    expect(original.length).toBeGreaterThan(0)
    expect(round.originalSummary).toBeUndefined()
    await expect(h.api.setRoundSummary({ missionId: a.id, roundId: round.id, summary: '   ' })).rejects.toThrow('Summary cannot be empty')
    await expect(h.api.setRoundSummary({ missionId: a.id, roundId: 'nope', summary: 'x' })).rejects.toThrow('Round not found: nope')
    expect(latestRound(missionOf(await h.api.getSnapshot(), a.id))?.originalSummary).toBeUndefined()

    await h.api.setRoundSummary({ missionId: a.id, roundId: round.id, summary: '  First edit.  ' })
    let edited = latestRound(missionOf(await h.api.getSnapshot(), a.id))!
    expect(edited.summary).toBe('First edit.')
    expect(edited.originalSummary).toBe(original)
    await h.api.setRoundSummary({ missionId: a.id, roundId: round.id, summary: 'Second edit.' })
    edited = latestRound(missionOf(await h.api.getSnapshot(), a.id))!
    expect(edited.summary).toBe('Second edit.')
    expect(edited.originalSummary).toBe(original)
    const preview = await h.api.previewComment(a.id)
    expect(preview).toContain('Second edit.')
    expect(preview).not.toContain(original)

    await h.api.setFindingDecisions({ missionId: a.id, roundId: round.id, decision: 'approved' })
    h.github.failNextPost = true
    await expect(h.api.postComment(a.id)).rejects.toThrow('502')
    expect(missionOf(await h.api.getSnapshot(), a.id).error).toContain('502')
    await h.api.setRoundSummary({ missionId: a.id, roundId: round.id, summary: 'Third edit.' })
    expect(missionOf(await h.api.getSnapshot(), a.id).error).toBeUndefined()

    await h.api.postComment(a.id)
    await waitForState(h, a.id, 'watching')
    expect(h.github.comments[0].body).toContain('Third edit.')
    expect(h.github.comments[0].body).not.toContain(original)
    await expect(h.api.setRoundSummary({ missionId: a.id, roundId: round.id, summary: 'Too late.' })).rejects.toThrow('already been posted')
    expect(latestRound(missionOf(await h.api.getSnapshot(), a.id))?.summary).toBe('Third edit.')

    // A failed mission with an un-posted round is still editable.
    const b = await h.api.dispatch({ prId: PR_1203 })
    const bDone = await waitForState(h, b.id, 'needs_you')
    await h.api.setFindingDecisions({ missionId: b.id, roundId: bDone.rounds[0].id, decision: 'approved' })
    await h.api.postComment(b.id)
    await waitForState(h, b.id, 'watching')
    h.runner.inner.failNext = true
    await h.api.rerunMission(b.id)
    const bFailed = await waitForState(h, b.id, 'failed')
    await h.api.setRoundSummary({ missionId: b.id, roundId: bFailed.rounds[1].id, summary: 'Edited after failure.' })
    expect(missionOf(await h.api.getSnapshot(), b.id).rounds[1].summary).toBe('Edited after failure.')
  })

  it('reruns with another loadout and records it on the timeline', async () => {
    const h = await makeEngine()
    const a = await h.api.dispatch({ prId: PR_412 })
    const done = await waitForState(h, a.id, 'needs_you')
    await expect(h.api.rerunMission(a.id, 'nope')).rejects.toThrow('Unknown review type: nope')
    expect(missionOf(await h.api.getSnapshot(), a.id)).toMatchObject({ state: 'needs_you', loadoutId: 'blind' })

    await h.api.rerunMission(a.id, 'security')
    const rerun = await waitForState(h, a.id, 'needs_you')
    expect(rerun.loadoutId).toBe('security')
    expect(rerun.rounds).toHaveLength(2)
    expect(rerun.timeline.filter((e) => e.to === 'queued').map((e) => e.note)).toEqual([undefined, 'rerun requested (Security pass)'])
    expect(h.runner.calls[1].loadout.id).toBe('security')

    // Without a loadout the mission keeps the one it has.
    await h.api.rerunMission(a.id)
    const again = await waitForState(h, a.id, 'needs_you')
    expect(again.loadoutId).toBe('security')
    expect(again.timeline[again.timeline.length - 4].note).toBe('rerun requested (Security pass)')
    expect(h.runner.calls[2].loadout.id).toBe('security')

    // From watching and from failed too.
    await h.api.setFindingDecisions({ missionId: a.id, roundId: latestRound(again)!.id, decision: 'approved' })
    await h.api.postComment(a.id)
    await waitForState(h, a.id, 'watching')
    h.runner.inner.failNext = true
    await h.api.rerunMission(a.id, 'product')
    const failed = await waitForState(h, a.id, 'failed')
    expect(failed.loadoutId).toBe('product')
    await h.api.rerunMission(a.id, 'blind')
    const last = await waitForState(h, a.id, 'needs_you')
    expect(last.loadoutId).toBe('blind')
    expect(last.timeline.filter((e) => e.note === 'rerun requested (Product eye)')).toHaveLength(1)
    expect(last.timeline.filter((e) => e.note === 'rerun requested (Blind review)')).toHaveLength(1)
    expect(done.rounds[0].findings.length).toBeGreaterThan(0)
  })

  it('rediscovers repos when roots or overrides change and re-polls when includeMine changes', async () => {
    const h = await makeEngine()
    let discovers = 0
    const discover = h.repos.discover.bind(h.repos)
    h.repos.discover = async () => {
      discovers++
      return discover()
    }
    let lists = 0
    const listRequested = h.github.listReviewRequested.bind(h.github)
    h.github.listReviewRequested = async () => {
      lists++
      return listRequested()
    }
    let mine = 0
    const listMine = h.github.listMine.bind(h.github)
    h.github.listMine = async () => {
      mine++
      return listMine()
    }

    await h.api.updateSettings({ signature: 'x' })
    await sleep(20)
    expect(discovers).toBe(0)
    expect(lists).toBe(0)

    await h.api.updateSettings({ projectsRoots: ['~/Code'] })
    expect(discovers).toBe(1)
    await h.api.updateSettings({ repoPaths: { 'acme/checkout-api': '~/Code/checkout-api' } })
    expect(discovers).toBe(2)
    await h.api.updateSettings({ repoPaths: { 'acme/checkout-api': '~/Code/checkout-api' } })
    expect(discovers).toBe(2)
    expect(lists).toBe(0)

    await h.api.updateSettings({ includeMine: false })
    await waitFor(h, (s) => s.inbox.length === 4)
    expect(lists).toBe(1)
    expect(mine).toBe(0)
    await h.api.updateSettings({ includeMine: true })
    await waitFor(h, (s) => s.inbox.length === 6)
    expect(lists).toBe(2)
    expect(mine).toBe(1)
    expect(discovers).toBe(2)
  })

  it('hides inactive repos and stale PRs from the inbox, re-polling when either setting changes', async () => {
    const h = await makeEngine()
    expect((await h.api.getSnapshot()).inbox).toHaveLength(6)

    await h.api.updateSettings({ inactiveRepos: ['acme/storefront-web', 'acme/mobile-app'] })
    const hidden = await waitFor(h, (s) => s.inbox.length === 3)
    expect(hidden.inbox.map((p) => p.repo.fullName).sort()).toEqual(['acme/checkout-api', 'acme/checkout-api', 'acme/notifications-service'])

    // The seed is at most 20 hours old, so a 1 day cut-off keeps it and 31 days later drops it all.
    await h.api.updateSettings({ inactiveRepos: [], maxPrAgeDays: 1 })
    await waitFor(h, (s) => s.inbox.length === 6)
    h.clock.advance(31 * 86_400_000)
    expect((await h.api.refreshInbox()).inbox).toHaveLength(0)
    await h.api.updateSettings({ maxPrAgeDays: 0 })
    await waitFor(h, (s) => s.inbox.length === 6)
  })

  it('keeps a PR with a live mission when its repo is switched off, and drops it once the mission closes', async () => {
    const h = await makeEngine()
    const a = await h.api.dispatch({ prId: PR_412 })
    await waitForState(h, a.id, 'needs_you')
    await h.api.updateSettings({ inactiveRepos: ['acme/checkout-api'] })
    const snap = await waitFor(h, (s) => s.inbox.length === 5)
    expect(snap.inbox.some((p) => p.id === PR_412)).toBe(true)
    expect(missionOf(snap, a.id).state).toBe('needs_you')

    h.github.simulatePush(PR_412)
    await h.api.refreshInbox()
    expect(missionOf(await h.api.getSnapshot(), a.id).stale).toBe(true)

    await h.api.closeMission(a.id)
    expect((await h.api.refreshInbox()).inbox.some((p) => p.repo.fullName === 'acme/checkout-api')).toBe(false)
  })

  it('detects pushes and merges that the listing has not caught up with', async () => {
    const h = await makeEngine()
    const a = await h.api.dispatch({ prId: PR_412 })
    const b = await h.api.dispatch({ prId: PR_1203 })
    const aDone = await waitForState(h, a.id, 'needs_you')
    await waitForState(h, b.id, 'needs_you')
    await h.api.setFindingDecisions({ missionId: a.id, roundId: aDone.rounds[0].id, decision: 'approved' })
    await h.api.postComment(a.id)
    await waitForState(h, a.id, 'watching')

    const stale = await h.github.listReviewRequested()
    h.github.listReviewRequested = async () => structuredClone(stale)
    const pushed = h.github.simulatePush(PR_412)
    authorReplies(h, PR_412)
    h.github.simulateClose(PR_1203, true)
    const snap = await h.api.refreshInbox()
    const listedPr = snap.inbox.find((p) => p.id === PR_412)
    expect(listedPr?.headSha).toBe(pushed.headSha)
    expect(listedPr?.reviewRequested).toBe(true)
    expect(snap.inbox.some((p) => p.id === PR_1203)).toBe(false)
    expect(missionOf(snap, b.id).state).toBe('closed')
    const followUp = await waitForState(h, a.id, 'needs_you')
    expect(followUp.rounds).toHaveLength(2)
    expect(followUp.rounds[1].headSha).toBe(pushed.headSha)
  })

  it('runs the environment check on demand and caches it on the snapshot', async () => {
    const h = await makeEngine()
    expect((await h.api.getSnapshot()).environment).toBeUndefined()
    const fallback = await h.api.checkEnvironment()
    expect(fallback).toEqual({
      checkedAt: h.clock.now().toISOString(),
      ok: false,
      items: [{ id: 'claude', label: 'Claude Code', ok: false, detail: 'Environment checks are only available in the desktop app' }]
    })
    expect((await h.api.getSnapshot()).environment).toEqual(fallback)

    const clock = new FakeClock()
    let checks = 0
    const engine = createEngine({
      ports: {
        github: new MockGitHub({ clock }),
        worktree: new MockWorktree(0),
        runner: new MockRunner(0),
        repos: new MockRepos(),
        store: new MemoryStore({ missions: [], inbox: [], settings: defaultSettings({ pollIntervalSec: 3600, claudePath: '/opt/claude' }) }),
        notifier: new MockNotifier(),
        clock
      },
      version: 'test',
      homeDir: '/Users/demo',
      checkEnvironment: async (settings) => {
        checks++
        return {
          checkedAt: clock.now().toISOString(),
          ok: true,
          items: [{ id: 'claude', label: 'Claude Code', ok: true, detail: settings.claudePath }]
        }
      }
    })
    await engine.start()
    try {
      await engine.api.refreshInbox()
      await sleep(20)
      expect(checks).toBe(0)
      expect((await engine.api.getSnapshot()).environment).toBeUndefined()
      const snapshots: AppSnapshot[] = []
      engine.subscribe('snapshot', (s) => snapshots.push(s))
      const result = await engine.api.checkEnvironment()
      expect(checks).toBe(1)
      expect(result.ok).toBe(true)
      expect(result.items[0].detail).toBe('/opt/claude')
      expect(snapshots[snapshots.length - 1].environment).toEqual(result)
      expect((await engine.api.getSnapshot()).environment).toEqual(result)
      result.ok = false
      expect((await engine.api.getSnapshot()).environment?.ok).toBe(true)
    } finally {
      await engine.stop()
    }
  })

  it('persists auto follow-up and edited summaries across a restart', async () => {
    const first = await makeEngine()
    const a = await first.api.dispatch({ prId: PR_412 })
    const done = await waitForState(first, a.id, 'needs_you')
    await first.api.setAutoFollowUp({ missionId: a.id, enabled: false })
    await first.api.setRoundSummary({ missionId: a.id, roundId: done.rounds[0].id, summary: 'Edited.' })
    await first.api.checkEnvironment()
    await first.engine.stop()
    live.splice(live.indexOf(first), 1)
    expect(Object.keys(first.store.state ?? {}).sort()).toEqual(['inbox', 'lastPollAt', 'missions', 'settings'])

    const second = await makeEngine({ store: new MemoryStore(first.store.state) })
    const snap = await second.api.getSnapshot()
    const m = missionOf(snap, a.id)
    expect(m.state).toBe('needs_you')
    expect(m.autoFollowUp).toBe(false)
    expect(m.rounds[0].summary).toBe('Edited.')
    expect(m.rounds[0].originalSummary).toBe(done.rounds[0].summary)
    expect(snap.environment).toBeUndefined()
  })

  it("hands a workspace review its siblings, the reviewer's open PRs in them and the container notes", async () => {
    const h = await makeEngine({ settings: { repoPaths: { 'acme/mobile-app': '~/Code/mobile-app' } } })
    const a = await h.api.dispatch({ prId: PR_412 })
    const done = await waitForState(h, a.id, 'needs_you')
    expect(done.rounds[0].workspaceName).toBe('acme')
    expect(h.runner.calls[0].workspace).toEqual({
      name: 'acme',
      rootPath: DEMO_WORKSPACE_ROOT,
      siblings: [
        { fullName: 'acme/storefront-web', path: '/Users/demo/Projects/storefront-web', defaultBranch: 'main' },
        { fullName: 'acme/mobile-app', path: '/Users/demo/Code/mobile-app', defaultBranch: 'main' },
        { fullName: 'acme/notifications-service', path: '/Users/demo/Projects/notifications-service', defaultBranch: 'main' }
      ],
      myOpenPrs: [
        {
          fullName: 'acme/storefront-web',
          number: 1210,
          title: 'feat(floor-plan): seat picker with live availability',
          headRef: 'feat/seat-picker',
          baseRef: 'main',
          url: 'https://github.com/acme/storefront-web/pull/1210'
        }
      ],
      notes: DEMO_WORKSPACE_NOTES
    })
    const activity = await h.api.getActivity(a.id)
    expect(activity).toContainEqual(expect.objectContaining({ kind: 'preparing', text: 'Workspace acme: 3 sibling repos, 1 of your open PRs' }))
    expect(activity.findIndex((x) => x.text.startsWith('Workspace'))).toBeLessThan(activity.findIndex((x) => x.kind === 'reading'))
  })

  it('reviews a repo outside every workspace without any workspace context', async () => {
    const repos = new MockRepos([...defaultDemoRepos(), { fullName: 'other/tool', path: '/Users/demo/Projects/tool', defaultBranch: 'main' }])
    const h = await makeEngine({ repos })
    const pr = h.github.simulateNewPullRequest({ repo: repoRefFromFullName('other/tool') })
    const a = await h.api.dispatch({ prId: pr.id })
    const done = await waitForState(h, a.id, 'needs_you')
    expect('workspace' in h.runner.calls[0]).toBe(false)
    expect('workspaceName' in done.rounds[0]).toBe(false)
    expect((await h.api.getActivity(a.id)).some((x) => x.text.startsWith('Workspace'))).toBe(false)
  })

  it("falls back to the inbox for the reviewer's PRs when listMine fails, and leaves the notes out when they are off", async () => {
    const h = await makeEngine()
    const { workspaces } = (await h.api.getSnapshot()).settings
    await h.api.updateSettings({ workspaces: workspaces.map((w) => ({ ...w, includeNotes: false })) })
    h.github.listMine = async () => {
      throw new Error('gh: rate limited')
    }
    const b = await h.api.dispatch({ prId: PR_1203 })
    const done = await waitForState(h, b.id, 'needs_you')
    const ws = h.runner.calls[0].workspace!
    expect(ws.myOpenPrs.map((p) => `${p.fullName}#${p.number}`)).toEqual(['acme/checkout-api#419'])
    expect('notes' in ws).toBe(false)
    expect(done.rounds[0].workspaceName).toBe('acme')
    expect(await h.api.getActivity(b.id)).toContainEqual(expect.objectContaining({ text: 'Workspace acme: 3 sibling repos, 1 of your open PRs' }))
  })

  it('ignores a workspace the user switched off', async () => {
    const h = await makeEngine()
    const { workspaces } = (await h.api.getSnapshot()).settings
    expect(workspaces).toEqual([
      { id: 'ws-acme', name: 'acme', rootPath: DEMO_WORKSPACE_ROOT, repos: defaultDemoRepos().map((r) => r.fullName), enabled: true, source: 'detected', includeNotes: true }
    ])
    await h.api.updateSettings({ workspaces: workspaces.map((w) => ({ ...w, enabled: false })) })
    const a = await h.api.dispatch({ prId: PR_412 })
    const done = await waitForState(h, a.id, 'needs_you')
    expect(h.runner.calls[0].workspace).toBeUndefined()
    expect(done.rounds[0].workspaceName).toBeUndefined()
  })

  it("merges detected workspaces on every scan, keeping the user's choices and manual entries, and persists them", async () => {
    const stale: Workspace = { id: 'ws-old', name: 'old', rootPath: '/Users/demo/Projects/old', repos: ['old/a', 'old/b'], enabled: true, source: 'detected', includeNotes: true }
    const kept: Workspace = { id: 'ws-acme', name: 'Acme apps', rootPath: DEMO_WORKSPACE_ROOT, repos: ['acme/checkout-api'], enabled: false, source: 'detected', includeNotes: false }
    const manual: Workspace = { id: 'ws-mine', name: 'Mine', repos: ['acme/checkout-api', 'other/tool'], enabled: true, source: 'manual', includeNotes: false }
    const h = await makeEngine({ settings: { workspaces: [stale, kept, manual] } })
    const merged = [{ ...kept, repos: defaultDemoRepos().map((r) => r.fullName) }, manual]
    expect((await h.api.getSnapshot()).settings.workspaces).toEqual(merged)
    await sleep(300)
    expect(h.store.state?.settings.workspaces).toEqual(merged)

    h.repos.workspaces.push({ rootPath: '/Users/demo/Projects/beta', name: 'beta', repos: ['beta/a', 'beta/b'], hasClaudeMd: false })
    await h.api.updateSettings({ projectsRoots: ['~/Projects', '~/Code'] })
    expect((await h.api.getSnapshot()).settings.workspaces.map((w) => [w.id, w.enabled])).toEqual([
      ['ws-acme', false],
      ['ws-mine', true],
      ['ws-beta', false]
    ])
    expect(h.repos.workspaces.length).toBe(2)
  })

  it('validates workspace updates and sanitises a corrupt persisted list', async () => {
    const h = await makeEngine()
    const ws = (await h.api.getSnapshot()).settings.workspaces[0]
    await expect(h.api.updateSettings({ workspaces: [ws, { ...ws, name: 'again' }] })).rejects.toThrow('Duplicate workspace id: ws-acme')
    await expect(h.api.updateSettings({ workspaces: [{ ...ws, repos: [42 as unknown as string] }] })).rejects.toThrow("Workspace 'acme' repos must be a list of owner/name strings")
    await expect(h.api.updateSettings({ workspaces: 'nope' as unknown as Workspace[] })).rejects.toThrow('workspaces must be a list')
    await expect(h.api.updateSettings({ workspaces: [{ ...ws, id: '' }] })).rejects.toThrow('Every workspace needs an id')

    const manual: Workspace = { id: 'ws-mine', name: 'Mine', repos: ['acme/checkout-api'], enabled: true, source: 'manual', includeNotes: false }
    const corrupt = await makeEngine({
      repos: new MockRepos([], []),
      settings: { workspaces: [null, 'x', { id: 'no-repos' }, manual] as unknown as Workspace[] }
    })
    expect((await corrupt.api.getSnapshot()).settings.workspaces).toEqual([manual])
    const notAList = await makeEngine({ repos: new MockRepos([], []), settings: { workspaces: 'corrupt' as unknown as Workspace[] } })
    expect((await notAList.api.getSnapshot()).settings.workspaces).toEqual([])
  })

  it('holds a push until the author replies, and flags a reply that comes without one', async () => {
    const h = await makeEngine()
    const a = await h.api.dispatch({ prId: PR_412 })
    const done = await waitForState(h, a.id, 'needs_you')
    await h.api.setFindingDecisions({ missionId: a.id, roundId: done.rounds[0].id, decision: 'approved' })
    await h.api.postComment(a.id)
    await waitForState(h, a.id, 'watching')

    // A reply with no new commits only raises the flag.
    const early = authorReplies(h, PR_412, 'Will fix tomorrow.')
    await h.api.refreshInbox()
    await sleep(20)
    let m = missionOf(await h.api.getSnapshot(), a.id)
    expect(m.state).toBe('watching')
    expect(m.stale).toBe(false)
    expect(m.authorReplies).toEqual([early])
    expect(m.timeline[m.timeline.length - 1].note).toBe('dami-codes replied')
    expect(h.notifier.notifications[h.notifier.notifications.length - 1]).toEqual({
      title: 'dami-codes replied on #412',
      body: 'No new commits yet, so no follow-up has started.',
      missionId: a.id
    })
    const count = h.notifier.notifications.length
    await h.api.refreshInbox()
    await sleep(20)
    expect(h.notifier.notifications).toHaveLength(count)

    // The push after it starts the follow-up, and the reviewer gets both replies.
    h.github.simulatePush(PR_412)
    const late = authorReplies(h, PR_412, 'Pushed the fixes.')
    await h.api.refreshInbox()
    const followUp = await waitForState(h, a.id, 'needs_you')
    expect(followUp.rounds[1].trigger).toBe('reply')
    expect(followUp.rounds[1].replies?.map((r) => r.body)).toEqual([early.body, late.body])
    expect(h.runner.calls.find((c) => c.round.id === followUp.rounds[1].id)?.replies).toHaveLength(2)
    expect(followUp.authorReplies).toBeUndefined()
  })

  it("ignores other people's comments and tells a self-review reply from the app's own comment", async () => {
    const h = await makeEngine()
    const mine = 'acme/checkout-api#419'
    const a = await h.api.dispatch({ prId: mine })
    const done = await waitForState(h, a.id, 'needs_you')
    await h.api.setFindingDecisions({ missionId: a.id, roundId: done.rounds[0].id, decision: 'approved' })
    await h.api.postComment(a.id)
    await waitForState(h, a.id, 'watching')

    h.github.simulatePush(mine)
    h.clock.advance(1000)
    h.github.simulateReply(mine, 'Preview deployed.', 'vercel')
    await h.api.refreshInbox()
    await sleep(20)
    let m = missionOf(await h.api.getSnapshot(), a.id)
    expect(m.state).toBe('watching')
    expect(m.stale).toBe(true)
    expect(m.authorReplies).toBeUndefined()

    // Same account as the app, but not a comment the app posted.
    authorReplies(h, mine, 'Done, see the table.')
    await h.api.refreshInbox()
    m = await waitForState(h, a.id, 'needs_you')
    expect(m.rounds[1].replies?.map((r) => r.author)).toEqual(['ritchey'])
  })

  it('runs one review with the chosen model, effort and budget, then goes back to the settings', async () => {
    const h = await makeEngine({ settings: { claudeModel: 'opus', claudeEffort: 'max', maxBudgetUsdPerReview: 15 } })
    const a = await h.api.dispatch({ prId: PR_412, options: { model: 'sonnet', effort: 'low', maxBudgetUsd: 2 } })
    const done = await waitForState(h, a.id, 'needs_you')
    const first = h.runner.calls[0]
    expect(first.settings).toMatchObject({ claudeModel: 'sonnet', claudeEffort: 'low', maxBudgetUsdPerReview: 2 })
    expect(done.rounds[0]).toMatchObject({ effort: 'low', budgetUsd: 2, trigger: 'dispatch' })
    expect(done.runOptions).toBeUndefined()
    expect((await h.api.getSnapshot()).settings.claudeModel).toBe('opus')

    await h.api.setFindingDecisions({ missionId: a.id, roundId: done.rounds[0].id, decision: 'approved' })
    await h.api.postComment(a.id)
    await waitForState(h, a.id, 'watching')
    h.github.simulatePush(PR_412)
    authorReplies(h, PR_412)
    await h.api.refreshInbox()
    const followUp = await waitForState(h, a.id, 'needs_you')
    const second = h.runner.calls.find((c) => c.round.id === followUp.rounds[1].id)!
    expect(second.settings).toMatchObject({ claudeModel: 'opus', claudeEffort: 'max', maxBudgetUsdPerReview: 15 })
  })

  it('keeps re-run options for a retry and can post that one run without triage', async () => {
    const h = await makeEngine()
    const a = await h.api.dispatch({ prId: PR_412 })
    const done = await waitForState(h, a.id, 'needs_you')
    await h.api.setFindingDecisions({ missionId: a.id, roundId: done.rounds[0].id, decision: 'approved' })
    await h.api.postComment(a.id)
    await waitForState(h, a.id, 'watching')

    h.runner.inner.failNext = true
    await h.api.rerunMission(a.id, 'security', { model: '', maxBudgetUsd: 1, autoPost: true })
    const failed = await waitForState(h, a.id, 'failed')
    expect(failed.runOptions).toEqual({ model: '', maxBudgetUsd: 1, autoPost: true })
    expect(failed.timeline.some((e) => e.note === 'rerun requested (Security pass, CLI default model, $1 budget, posts without triage)')).toBe(true)

    await h.api.retryMission(a.id)
    const posted = await waitForState(h, a.id, 'watching')
    const retry = h.runner.calls[h.runner.calls.length - 1]
    expect(retry.settings).toMatchObject({ claudeModel: '', maxBudgetUsdPerReview: 1 })
    expect(latestRound(posted)).toMatchObject({ model: 'demo-reviewer', budgetUsd: 1, trigger: 'retry' })
    expect(latestRound(posted)?.postedBody).toContain('Posted automatically')
    expect(posted.runOptions).toBeUndefined()
    expect(posted.autoPost).toBe(false)
  })

  it('clears the new-push flag and any replies when the review closes', async () => {
    const h = await makeEngine({ settings: { maxAutoRoundsPerMission: 0 } })
    const a = await h.api.dispatch({ prId: PR_412 })
    const done = await waitForState(h, a.id, 'needs_you')
    await h.api.setFindingDecisions({ missionId: a.id, roundId: done.rounds[0].id, decision: 'approved' })
    await h.api.postComment(a.id)
    await waitForState(h, a.id, 'watching')
    h.github.simulatePush(PR_412)
    authorReplies(h, PR_412)
    await h.api.refreshInbox()
    await sleep(20)
    const flagged = missionOf(await h.api.getSnapshot(), a.id)
    expect(flagged.stale).toBe(true)
    expect(flagged.authorReplies).toHaveLength(1)
    await h.api.closeMission(a.id)
    const closed = missionOf(await h.api.getSnapshot(), a.id)
    expect(closed.state).toBe('closed')
    expect(closed.stale).toBe(false)
    expect(closed.authorReplies).toBeUndefined()
  })

  it('reads the replies of a review watched before replies were tracked without notifying, then notifies new ones', async () => {
    const h = await makeEngine()
    const a = await h.api.dispatch({ prId: PR_412 })
    const done = await waitForState(h, a.id, 'needs_you')
    await h.api.setFindingDecisions({ missionId: a.id, roundId: done.rounds[0].id, decision: 'approved' })
    await h.api.postComment(a.id)
    await waitForState(h, a.id, 'watching')
    expect(missionOf(await h.api.getSnapshot(), a.id).repliesCheckedAt).toBeDefined()
    await h.engine.stop()
    live.splice(live.indexOf(h), 1)

    // As an older version would have saved it.
    delete h.store.state!.missions[0].repliesCheckedAt
    const old = authorReplies(h, PR_412, 'Answered before the upgrade.')
    const again = await makeEngine({ store: h.store, github: h.github, poll: false })
    await again.api.refreshInbox()
    let m = missionOf(await again.api.getSnapshot(), a.id)
    expect(m.authorReplies).toEqual([old])
    expect(again.notifier.notifications.some((n) => n.title.includes('replied'))).toBe(false)

    h.clock.advance(1000)
    again.clock.advance(5000)
    h.github.simulateReply(PR_412, 'And one after it.')
    await again.api.refreshInbox()
    m = missionOf(await again.api.getSnapshot(), a.id)
    expect(m.authorReplies).toHaveLength(2)
    expect(again.notifier.notifications.filter((n) => n.title === 'dami-codes replied on #412')).toHaveLength(1)
  })

  it('posts one first run without triage when asked, then stops for triage on follow-ups', async () => {
    const h = await makeEngine()
    const a = await h.api.dispatch({ prId: PR_412, options: { autoPost: true } })
    const posted = await waitForState(h, a.id, 'watching')
    expect(posted.autoPost).toBe(false)
    expect(h.github.comments).toHaveLength(1)
    h.github.simulatePush(PR_412)
    authorReplies(h, PR_412)
    await h.api.refreshInbox()
    const followUp = await waitForState(h, a.id, 'needs_you')
    expect(followUp.rounds[1].findings.every((f) => f.decision === 'pending')).toBe(true)
    expect(h.github.comments).toHaveLength(1)
  })

  it('announces a push that landed during triage once, not again after posting', async () => {
    const h = await makeEngine()
    const a = await h.api.dispatch({ prId: PR_412 })
    const done = await waitForState(h, a.id, 'needs_you')
    h.github.simulatePush(PR_412)
    await h.api.refreshInbox()
    await h.api.setFindingDecisions({ missionId: a.id, roundId: done.rounds[0].id, decision: 'approved' })
    await h.api.postComment(a.id)
    await waitForState(h, a.id, 'watching')
    await h.api.refreshInbox()
    await sleep(20)
    expect(h.notifier.notifications.filter((n) => n.title.startsWith('New push on #412'))).toHaveLength(1)
    expect(missionOf(await h.api.getSnapshot(), a.id).stale).toBe(true)
  })
})

