/**
 * Mission lifecycle: queue ordering, slot assignment, the prepare/review/post
 * pipeline, and every state transition. Browser-safe; talks only to ports.
 */
import { nanoid } from 'nanoid'
import type {
  Activity,
  DropReason,
  EnvironmentCheck,
  Finding,
  LocalRepo,
  Mission,
  MissionState,
  Notification,
  PullRequest,
  ReviewRound,
  Settings,
  Slot
} from '../domain'
import { latestRound, missionHoldsSlot, prIdOf } from '../domain'
import type {
  BulkFindingDecisionArgs,
  DispatchArgs,
  FindingDecisionArgs,
  SetAutoFollowUpArgs,
  SetRoundSummaryArgs
} from '../ipc-contract'
import type { Ports, WorkspaceContext } from '../ports'
import { buildComment } from '../comment-builder'
import { expandHome, parsePrId, worktreePathFor } from './paths'
import { buildWorkspaceContext, describeWorkspaceContext, workspaceFor } from './workspaces'

export interface EngineState {
  settings: Settings
  inbox: PullRequest[]
  missions: Mission[]
  slots: Slot[]
  localRepos: LocalRepo[]
  lastPollAt?: string
  pollError?: string
  githubLogin?: string
  environment?: EnvironmentCheck
}

export interface SchedulerHooks {
  /** Some part of the state changed; the owner emits a snapshot and persists. */
  onChange(): void
  onActivity(activity: Activity): void
  onNotification(n: Notification): void
}

const MAX_ACTIVITY = 200
/** Activity lines a finished round keeps for post-mortems after a restart. */
const ROUND_ACTIVITY_TAIL = 80
const RUNNING_STATES: readonly MissionState[] = ['preparing', 'reviewing', 'posting']

export function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message
  return typeof e === 'string' ? e : String(e)
}

function clone<T>(value: T): T {
  return structuredClone(value)
}

/** A finite number a runner error carries under `key`, such as the cost of a review that produced nothing. */
function numberOnError(e: unknown, key: 'costUsd' | 'durationMs'): number | undefined {
  const value = e instanceof Error ? (e as Error & Record<string, unknown>)[key] : undefined
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new Error('Cancelled')
}

/**
 * The round a follow-up builds on. Only a posted round counts: a failed or
 * abandoned round would make the runner (and the posted comment) claim a
 * follow-up on findings the author never saw.
 */
function lastPostedRound(mission: Mission): ReviewRound | undefined {
  for (let i = mission.rounds.length - 1; i >= 0; i--) {
    if (mission.rounds[i].postedAt) return mission.rounds[i]
  }
  return undefined
}

/** Time a mission last entered `queued`; drives FIFO ordering within a priority band. */
function queuedAt(mission: Mission): string {
  for (let i = mission.timeline.length - 1; i >= 0; i--) {
    const ev = mission.timeline[i]
    if (ev.to === 'queued') return ev.at
  }
  return mission.createdAt
}

export class Scheduler {
  private controllers = new Map<string, AbortController>()
  private activity = new Map<string, Activity[]>()
  private stopped = false
  /** Queued missions wait here until the first repo discovery has settled, or they would fail to find their checkout. */
  ready = false

  constructor(
    readonly state: EngineState,
    readonly ports: Ports,
    private readonly homeDir: string,
    private readonly hooks: SchedulerHooks
  ) {}

  now(): string {
    return this.ports.clock.now().toISOString()
  }

  changed(): void {
    this.hooks.onChange()
  }

  notify(n: Notification): void {
    this.hooks.onNotification(n)
  }

  mustFind(missionId: string): Mission {
    const m = this.state.missions.find((x) => x.id === missionId)
    if (!m) throw new Error(`Mission not found: ${missionId}`)
    return m
  }

  getActivity(missionId: string): Activity[] {
    return clone(this.activity.get(missionId) ?? [])
  }

  localRepoPath(fullName: string): string | undefined {
    const override = this.state.settings.repoPaths[fullName]
    if (override) return expandHome(override, this.homeDir)
    return this.state.localRepos.find((r) => r.fullName === fullName)?.path
  }

  /**
   * The only way a mission changes state. Keeps the slot links on both the
   * mission and the slot consistent: entering a slot-holding state claims a
   * slot, leaving one releases it and remembers it as preferred.
   */
  transition(mission: Mission, to: MissionState, note?: string, opts: { slotId?: string } = {}): void {
    const from = mission.state
    const at = this.now()
    if (missionHoldsSlot(to) && !missionHoldsSlot(from)) {
      const slot = opts.slotId ? this.slotById(opts.slotId) : this.freeSlotFor(mission)
      if (slot) {
        slot.missionId = mission.id
        mission.slotId = slot.id
        mission.preferredSlotId = slot.id
      }
    } else if (!missionHoldsSlot(to) && mission.slotId) {
      const slot = this.slotById(mission.slotId)
      if (slot?.missionId === mission.id) slot.missionId = undefined
      mission.preferredSlotId = mission.slotId
      mission.slotId = undefined
    }
    mission.state = to
    mission.updatedAt = at
    mission.timeline.push(note ? { at, from, to, note } : { at, from, to })
    this.changed()
  }

  /** Records something that happened without a state change. */
  annotate(mission: Mission, note: string): void {
    const at = this.now()
    mission.updatedAt = at
    mission.timeline.push({ at, to: mission.state, note })
    this.changed()
  }

  slotById(id: string): Slot | undefined {
    return this.state.slots.find((s) => s.id === id)
  }

  private freeSlotFor(mission: Mission): Slot | undefined {
    const preferred = mission.preferredSlotId ? this.slotById(mission.preferredSlotId) : undefined
    if (preferred && !preferred.missionId) return preferred
    return this.state.slots.find((s) => !s.missionId)
  }

  /** Rebuilds `state.slots` from settings, keeping who sits where by slot id. */
  rebuildSlots(): void {
    const links = new Map(this.state.slots.map((s) => [s.id, s.missionId]))
    this.state.slots = this.state.settings.slots.map((s) => {
      const missionId = links.get(s.id)
      return missionId ? { ...s, missionId } : { ...s }
    })
  }

  /** Re-derives slot links from mission states after a restart. */
  recover(): void {
    this.rebuildSlots()
    const claimants = [...this.state.missions]
      .filter((m) => missionHoldsSlot(m.state))
      .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt))
    for (const m of claimants) {
      if (m.state === 'posting') {
        // Whether the comment landed is unknowable here; only the user can check.
        m.error = 'The app restarted while posting. Check the PR before posting again.'
        this.transition(m, 'needs_you', 'recovered after restart; post again')
      } else if (RUNNING_STATES.includes(m.state)) {
        this.transition(m, 'queued', 'recovered after restart')
        continue
      }
      const slot = m.slotId ? this.slotById(m.slotId) : undefined
      if (slot && !slot.missionId) {
        slot.missionId = m.id
        m.preferredSlotId = slot.id
      } else {
        m.slotId = undefined
        this.transition(m, 'queued', 'recovered after restart')
      }
    }
    for (const m of this.state.missions) {
      if (!missionHoldsSlot(m.state) && m.slotId) m.slotId = undefined
    }
    this.changed()
  }

  /** Aborts running work; missions keep their state so a restart can recover them. */
  shutdown(): void {
    this.stopped = true
    for (const c of this.controllers.values()) c.abort()
    this.controllers.clear()
  }

  async dispatch(args: DispatchArgs): Promise<Mission> {
    const pr = await this.resolvePullRequest(args.prId)
    if (pr.state !== 'open') throw new Error(`#${pr.number} is ${pr.state}`)
    const active = this.state.missions.find((m) => m.prId === pr.id && m.state !== 'closed')
    if (active) throw new Error(`#${pr.number} already has an active mission`)
    const { settings } = this.state
    const loadoutId = args.loadoutId ?? settings.defaultLoadoutId
    if (!settings.loadouts.some((l) => l.id === loadoutId)) throw new Error(`Unknown loadout: ${loadoutId}`)
    const at = this.now()
    const mission: Mission = {
      id: nanoid(),
      prId: pr.id,
      pr: clone(pr),
      loadoutId,
      state: 'queued',
      rounds: [],
      stale: false,
      autoPost: args.autoPost ?? settings.autoPostRepos.includes(pr.repo.fullName),
      createdAt: at,
      updatedAt: at,
      timeline: [{ at, to: 'queued' }]
    }
    this.state.missions.push(mission)
    this.changed()
    this.schedule()
    return clone(mission)
  }

  private async resolvePullRequest(prId: string): Promise<PullRequest> {
    const inInbox = this.state.inbox.find((p) => p.id === prId)
    if (inInbox) return inInbox
    const parsed = parsePrId(prId)
    if (!parsed) throw new Error(`PR not found: ${prId}`)
    let pr: PullRequest
    try {
      pr = await this.ports.github.getPullRequest(parsed.fullName, parsed.number)
    } catch (e) {
      throw new Error(`PR not found: ${prId} (${errorMessage(e)})`)
    }
    if (pr.id !== prIdOf(parsed.fullName, parsed.number)) throw new Error(`PR not found: ${prId}`)
    // A concurrent dispatch or poll may have added it while the fetch ran.
    const added = this.state.inbox.find((p) => p.id === prId)
    if (added) return added
    this.state.inbox.push(pr)
    this.changed()
    return pr
  }

  /** Follow-ups (missions that already have a round) go first, then FIFO by queue time. */
  queuedInOrder(): Mission[] {
    return this.state.missions
      .filter((m) => m.state === 'queued')
      .sort((a, b) => {
        const fa = a.rounds.length > 0 ? 0 : 1
        const fb = b.rounds.length > 0 ? 0 : 1
        if (fa !== fb) return fa - fb
        return queuedAt(a).localeCompare(queuedAt(b))
      })
  }

  schedule(): void {
    if (this.stopped || !this.ready) return
    for (const mission of this.queuedInOrder()) {
      const slot = this.freeSlotFor(mission)
      if (!slot) break
      void this.runMission(mission, slot.id)
    }
  }

  private async runMission(mission: Mission, slotId: string): Promise<void> {
    const controller = new AbortController()
    const { signal } = controller
    this.controllers.set(mission.id, controller)
    let round: ReviewRound | undefined
    const { github, worktree, runner } = this.ports
    try {
      mission.error = undefined
      this.transition(mission, 'preparing', undefined, { slotId })
      const { pr } = mission
      const { fullName } = pr.repo
      const settings = this.state.settings
      const localRepoPath = this.localRepoPath(fullName)
      if (!localRepoPath) {
        throw new Error(`No local checkout found for ${fullName}. Add its path in Settings > Repositories.`)
      }
      const worktreePath = worktreePathFor(settings.worktreeRoot, pr, this.homeDir)
      const prepared = await worktree.prepare({
        localRepoPath,
        worktreePath,
        pr: clone(pr),
        prepareCommand: settings.prepareCommands[fullName],
        linkNodeModules: settings.linkNodeModules,
        signal,
        onActivity: (text) => this.emitActivity(mission.id, 'preparing', text)
      })
      throwIfAborted(signal)
      mission.worktreePath = prepared.worktreePath
      const workspace = await this.workspaceContext(mission, signal)
      throwIfAborted(signal)
      this.transition(mission, 'reviewing')

      const previousRound = lastPostedRound(mission)
      round = {
        id: nanoid(),
        index: mission.rounds.length + 1,
        headSha: prepared.headSha,
        previousHeadSha: previousRound?.headSha,
        startedAt: this.now(),
        findings: [],
        summary: '',
        verdict: 'comment',
        // An empty model is the CLI default; the runner replaces the alias with what the CLI resolved.
        model: settings.claudeModel || 'default',
        effort: settings.claudeEffort ?? 'default'
      }
      if (workspace) round.workspaceName = workspace.name
      mission.rounds.push(round)
      this.changed()

      // A follow-up reviews the delta since the posted round, which only the
      // runner can compute inside the worktree.
      let diff = ''
      if (!previousRound) {
        try {
          diff = await github.getDiff(fullName, pr.number)
        } catch (e) {
          this.emitActivity(mission.id, 'preparing', `Diff unavailable: ${errorMessage(e)}; the reviewer will run git diff itself`)
        }
      }
      throwIfAborted(signal)
      const loadout = settings.loadouts.find((l) => l.id === mission.loadoutId)
      if (!loadout) throw new Error(`Unknown loadout: ${mission.loadoutId}`)

      const result = await runner.review({
        mission: clone(mission),
        round: clone(round),
        loadout: clone(loadout),
        worktreePath: prepared.worktreePath,
        diff,
        previousRound: previousRound ? clone(previousRound) : undefined,
        ...(workspace && { workspace }),
        settings: clone(settings),
        signal,
        onActivity: (a) => this.emitActivity(mission.id, a.kind, a.text)
      })
      throwIfAborted(signal)

      const decision = mission.autoPost ? 'approved' : 'pending'
      round.findings = result.findings.map((f): Finding => ({ ...f, id: nanoid(), decision }))
      round.summary = result.summary
      round.verdict = result.verdict
      round.briefing = result.briefing
      round.rawOutput = result.rawOutput
      round.costUsd = result.costUsd
      if (result.model) round.model = result.model
      round.finishedAt = this.now()
      round.durationMs = result.durationMs ?? Math.max(0, Date.parse(round.finishedAt) - Date.parse(round.startedAt))
      this.emitActivity(mission.id, 'done', `${countFindings(round.findings.length)}, verdict ${result.verdict}`)
      round.activity = this.activityTail(mission.id)

      if (mission.autoPost) {
        // A failed post already parked the mission in needs_you with the error.
        await this.postRound(mission, round).catch(() => undefined)
      } else {
        this.transition(mission, 'needs_you')
        this.notify({
          title: `Findings ready: #${pr.number} ${pr.title}`,
          body: `${countFindings(round.findings.length)} from ${this.slotName(mission)}`,
          missionId: mission.id
        })
      }
    } catch (e) {
      if (this.stopped) return
      if (mission.state === 'closed') {
        if (round && !round.finishedAt) {
          round.error = 'Cancelled'
          round.finishedAt = this.now()
          round.activity = this.activityTail(mission.id)
          this.changed()
        }
        return
      }
      const cancelled = signal.aborted
      const message = cancelled ? 'Cancelled' : errorMessage(e)
      mission.error = message
      this.emitActivity(mission.id, 'error', message)
      if (round) {
        round.error = message
        round.finishedAt ??= this.now()
        round.durationMs ??= numberOnError(e, 'durationMs') ?? Math.max(0, Date.parse(round.finishedAt) - Date.parse(round.startedAt))
        const spent = numberOnError(e, 'costUsd')
        if (spent !== undefined) round.costUsd ??= spent
        round.activity = this.activityTail(mission.id)
      }
      this.transition(mission, 'failed', message)
      if (!cancelled) {
        this.notify({ title: `Review failed: #${mission.pr.number}`, body: message, missionId: mission.id })
      }
    } finally {
      if (this.controllers.get(mission.id) === controller) this.controllers.delete(mission.id)
      this.schedule()
    }
  }

  /** What the review may look at beyond its worktree; undefined when the repo is in no enabled workspace. */
  private async workspaceContext(mission: Mission, signal: AbortSignal): Promise<WorkspaceContext | undefined> {
    const { fullName } = mission.pr.repo
    const workspace = workspaceFor(this.state.settings.workspaces, fullName)
    if (!workspace) return undefined
    let myPrs: PullRequest[]
    try {
      myPrs = await this.ports.github.listMine()
    } catch {
      // The inbox holds what the last poll saw of them.
      myPrs = this.state.inbox.filter((p) => p.mine)
    }
    throwIfAborted(signal)
    let notes: string | undefined
    if (workspace.includeNotes && workspace.rootPath) {
      try {
        notes = await this.ports.repos.readWorkspaceNotes(workspace.rootPath)
      } catch {
        // Notes are context only; an unreadable store must not fail the review.
      }
    }
    const context = buildWorkspaceContext({
      workspace,
      fullName,
      localRepos: this.state.localRepos,
      pathOf: (name) => this.localRepoPath(name),
      myPrs,
      notes
    })
    this.emitActivity(mission.id, 'preparing', describeWorkspaceContext(context))
    return context
  }

  private async postRound(mission: Mission, round: ReviewRound): Promise<{ url: string }> {
    const { pr } = mission
    const body = buildComment({ mission: clone(mission), round: clone(round), settings: clone(this.state.settings), login: this.state.githubLogin })
    this.transition(mission, 'posting')
    try {
      const { url } = await this.ports.github.postComment(pr.repo.fullName, pr.number, body)
      round.postedAt = this.now()
      round.postedCommentUrl = url
      round.postedBody = body
      mission.error = undefined
      // The PR may have merged (or the user closed the mission) while the
      // comment was in flight; the comment exists either way, but a closed
      // mission must not come back to life.
      if (mission.state === 'posting') {
        this.transition(mission, 'watching', `posted round ${round.index}`)
        this.schedule()
      } else {
        this.changed()
      }
      return { url }
    } catch (e) {
      const message = errorMessage(e)
      if (mission.state === 'posting') {
        mission.error = `Posting failed: ${message}`
        this.transition(mission, 'needs_you', 'posting failed')
        this.notify({ title: `Posting failed: #${pr.number}`, body: message, missionId: mission.id })
      }
      throw e
    }
  }

  async postComment(missionId: string): Promise<{ url: string }> {
    const mission = this.mustFind(missionId)
    const round = latestRound(mission)
    if (!round) throw new Error(`#${mission.pr.number} has no review round to post`)
    const retryable = mission.state === 'failed' && round.findings.length > 0 && !round.postedAt
    if (mission.state !== 'needs_you' && !retryable) {
      throw new Error(`Cannot post from state '${mission.state}'`)
    }
    return this.postRound(mission, round)
  }

  previewComment(missionId: string): string {
    const mission = this.mustFind(missionId)
    const round = latestRound(mission)
    if (!round) throw new Error(`#${mission.pr.number} has no review round yet`)
    return buildComment({ mission: clone(mission), round: clone(round), settings: clone(this.state.settings), login: this.state.githubLogin })
  }

  setFindingDecision(args: FindingDecisionArgs): void {
    const mission = this.mustFind(args.missionId)
    const round = this.mustFindRound(mission, args.roundId)
    const finding = round.findings.find((f) => f.id === args.findingId)
    if (!finding) throw new Error(`Finding not found: ${args.findingId}`)
    applyDecision(finding, args.decision, args.dropReason, args.dropNote)
    mission.error = undefined
    mission.updatedAt = this.now()
    this.changed()
  }

  setFindingDecisions(args: BulkFindingDecisionArgs): void {
    const mission = this.mustFind(args.missionId)
    const round = this.mustFindRound(mission, args.roundId)
    const ids = args.findingIds ? new Set(args.findingIds) : undefined
    for (const finding of round.findings) {
      if (ids && !ids.has(finding.id)) continue
      applyDecision(finding, args.decision, args.dropReason ?? finding.dropReason, args.dropNote ?? finding.dropNote)
    }
    mission.error = undefined
    mission.updatedAt = this.now()
    this.changed()
  }

  private mustFindRound(mission: Mission, roundId: string): ReviewRound {
    const round = mission.rounds.find((r) => r.id === roundId)
    if (!round) throw new Error(`Round not found: ${roundId}`)
    return round
  }

  rerunMission(missionId: string, loadoutId?: string): void {
    const mission = this.mustFind(missionId)
    if (!['needs_you', 'watching', 'failed'].includes(mission.state)) {
      throw new Error(`Cannot rerun from state '${mission.state}'`)
    }
    const { loadouts } = this.state.settings
    if (loadoutId !== undefined) {
      if (!loadouts.some((l) => l.id === loadoutId)) throw new Error(`Unknown loadout: ${loadoutId}`)
      mission.loadoutId = loadoutId
    }
    const loadoutName = loadouts.find((l) => l.id === mission.loadoutId)?.name ?? mission.loadoutId
    mission.stale = false
    mission.error = undefined
    this.transition(mission, 'queued', `rerun requested (${loadoutName})`)
    this.schedule()
  }

  setRoundSummary(args: SetRoundSummaryArgs): void {
    const mission = this.mustFind(args.missionId)
    const round = this.mustFindRound(mission, args.roundId)
    if (round.postedAt) throw new Error(`Round ${round.index} has already been posted`)
    if (mission.state !== 'needs_you' && mission.state !== 'failed') {
      throw new Error(`Cannot edit the summary from state '${mission.state}'`)
    }
    const summary = args.summary.trim()
    if (!summary) throw new Error('Summary cannot be empty')
    round.originalSummary ??= round.summary
    round.summary = summary
    mission.error = undefined
    mission.updatedAt = this.now()
    this.changed()
  }

  setAutoFollowUp(args: SetAutoFollowUpArgs): void {
    const mission = this.mustFind(args.missionId)
    if (mission.state === 'closed') throw new Error(`Cannot change auto follow-up from state '${mission.state}'`)
    mission.autoFollowUp = args.enabled
    mission.updatedAt = this.now()
    this.changed()
  }

  cancelMission(missionId: string): void {
    const mission = this.mustFind(missionId)
    if (mission.state === 'queued') {
      mission.error = 'Cancelled'
      this.transition(mission, 'failed', 'Cancelled')
      return
    }
    // GitHubPort.postComment cannot be interrupted; once the comment is on
    // its way the only honest outcome is to let it finish.
    if (mission.state === 'posting') throw new Error(`#${mission.pr.number} is posting its comment; wait for it to finish`)
    if (!RUNNING_STATES.includes(mission.state)) throw new Error(`Cannot cancel from state '${mission.state}'`)
    this.controllers.get(mission.id)?.abort()
  }

  retryMission(missionId: string): void {
    const mission = this.mustFind(missionId)
    if (mission.state !== 'failed') throw new Error(`Cannot retry from state '${mission.state}'`)
    mission.stale = false
    mission.error = undefined
    this.transition(mission, 'queued', 'retry')
    this.schedule()
  }

  async closeMission(missionId: string, note?: string): Promise<void> {
    const mission = this.mustFind(missionId)
    if (mission.state === 'closed') return
    this.controllers.get(mission.id)?.abort()
    this.transition(mission, 'closed', note)
    this.schedule()
    const localRepoPath = this.localRepoPath(mission.pr.repo.fullName)
    if (mission.worktreePath && localRepoPath) {
      try {
        await this.ports.worktree.remove(localRepoPath, mission.worktreePath)
        mission.worktreePath = undefined
      } catch (e) {
        mission.error = `Worktree removal failed: ${errorMessage(e)}`
      }
      this.changed()
    }
  }

  private activityTail(missionId: string): Activity[] {
    return clone((this.activity.get(missionId) ?? []).slice(-ROUND_ACTIVITY_TAIL))
  }

  private emitActivity(missionId: string, kind: Activity['kind'], text: string): void {
    const activity: Activity = { missionId, at: this.now(), kind, text }
    const list = this.activity.get(missionId) ?? []
    list.push(activity)
    if (list.length > MAX_ACTIVITY) list.splice(0, list.length - MAX_ACTIVITY)
    this.activity.set(missionId, list)
    this.hooks.onActivity(activity)
  }

  private slotName(mission: Mission): string {
    return (mission.slotId && this.slotById(mission.slotId)?.name) || 'the reviewer'
  }
}

function countFindings(n: number): string {
  return n === 1 ? '1 finding' : `${n} findings`
}

function applyDecision(finding: Finding, decision: Finding['decision'], dropReason?: DropReason, dropNote?: string): void {
  finding.decision = decision
  if (decision === 'dropped') {
    // Left unset until the user picks one, so the triage UI can ask for it.
    if (dropReason !== undefined) finding.dropReason = dropReason
    else delete finding.dropReason
    if (dropNote !== undefined) finding.dropNote = dropNote
    else delete finding.dropNote
  } else {
    delete finding.dropReason
    delete finding.dropNote
  }
}
