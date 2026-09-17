/**
 * The engine: owns the state, wraps the scheduler and the poller, and exposes
 * the `Api` contract plus push events. Composed by the Electron main process
 * (real adapters) and by the browser demo (mocks) alike.
 */
import type { AppSnapshot, DetectedWorkspace, EnvironmentCheck, Settings } from '../domain'
import { ENVIRONMENT_CHECK_LABELS } from '../domain'
import type { Api, DemoSimulateArgs, Engine, PushEvent, PushEvents } from '../ipc-contract'
import { RETIRED_SLASH_COMMANDS, defaultSettings } from '../loadouts'
import type { PersistedState, Ports } from '../ports'
import { pollInbox } from './poller'
import { Scheduler, type EngineState } from './scheduler'
import { mergeDetectedWorkspaces } from './workspaces'

export interface EngineOptions {
  ports: Ports
  version: string
  /** Used to expand `~` in settings paths. */
  homeDir: string
  /** Overrides for the built-in defaults: fresh installs start from these, and invalid persisted fields fall back to them. */
  defaultSettings?: Partial<Settings>
  /** Electron passes shell.openExternal; the browser opens a new tab. */
  openExternal?: (url: string) => Promise<void>
  openPath?: (path: string) => Promise<void>
  /** Main runs the real preflight; the demo reports everything ok. */
  checkEnvironment?: (settings: Settings) => Promise<EnvironmentCheck>
  /** Main calls app.relaunch(); absent in the browser. */
  relaunch?: () => Promise<void>
  demoControls?: {
    simulatePush?: (prId: string) => void
    simulateClose?: (prId: string, merged: boolean) => void
    simulateNewPullRequest?: () => void
    failNextReview?: () => void
  }
}

const SNAPSHOT_COALESCE_MS = 10
const PERSIST_DEBOUNCE_MS = 250
const MAX_TIMER_DELAY_MS = 2 ** 31 - 1
export const MIN_POLL_INTERVAL_SEC = 15

type Listeners = { [E in PushEvent]: Set<(payload: PushEvents[E]) => void> }

export function validateSettings(settings: Settings): void {
  if (!Number.isFinite(settings.pollIntervalSec) || settings.pollIntervalSec < MIN_POLL_INTERVAL_SEC) {
    throw new Error(`pollIntervalSec must be at least ${MIN_POLL_INTERVAL_SEC}`)
  }
  if (!Array.isArray(settings.slots) || settings.slots.length < 1) throw new Error('At least one slot is required')
  const ids = new Set<string>()
  for (const slot of settings.slots) {
    if (!slot.id) throw new Error('Every slot needs an id')
    if (ids.has(slot.id)) throw new Error(`Duplicate slot id: ${slot.id}`)
    ids.add(slot.id)
  }
  if (!Array.isArray(settings.loadouts) || settings.loadouts.length < 1) throw new Error('At least one loadout is required')
  if (!settings.loadouts.some((l) => l.id === settings.defaultLoadoutId)) {
    throw new Error(`defaultLoadoutId '${settings.defaultLoadoutId}' is not one of the loadouts`)
  }
  if (!Number.isInteger(settings.maxAutoRoundsPerMission) || settings.maxAutoRoundsPerMission < 0) {
    throw new Error('maxAutoRoundsPerMission must be a whole number of 0 or more')
  }
  if (!Number.isInteger(settings.maxPrAgeDays) || settings.maxPrAgeDays < 0) {
    throw new Error('maxPrAgeDays must be a whole number of 0 or more')
  }
  if (!Array.isArray(settings.inactiveRepos) || settings.inactiveRepos.some((r) => typeof r !== 'string')) {
    throw new Error('inactiveRepos must be a list of owner/name strings')
  }
  if (!Array.isArray(settings.workspaces)) throw new Error('workspaces must be a list')
  const workspaceIds = new Set<string>()
  for (const ws of settings.workspaces) {
    if (!ws?.id) throw new Error('Every workspace needs an id')
    if (workspaceIds.has(ws.id)) throw new Error(`Duplicate workspace id: ${ws.id}`)
    workspaceIds.add(ws.id)
    if (!Array.isArray(ws.repos) || ws.repos.some((r) => typeof r !== 'string')) {
      throw new Error(`Workspace '${ws.name || ws.id}' repos must be a list of owner/name strings`)
    }
  }
}

/**
 * Persisted settings never went through validation (older versions, hand
 * edits, a corrupt file), so each invalid field falls back to its default
 * rather than refusing to start or, worse, polling with a 0s interval.
 */
function sanitizeSettings(raw: unknown, defaults: Settings): Settings {
  if (!raw || typeof raw !== 'object') return defaults
  const merged: Settings = { ...defaults, ...(raw as Partial<Settings>) }
  if (!Number.isFinite(merged.pollIntervalSec) || merged.pollIntervalSec < MIN_POLL_INTERVAL_SEC) {
    merged.pollIntervalSec = defaults.pollIntervalSec
  }
  if (!Array.isArray(merged.slots) || merged.slots.length < 1 || merged.slots.some((s) => !s?.id)) merged.slots = defaults.slots
  if (!Array.isArray(merged.loadouts) || merged.loadouts.length < 1) merged.loadouts = defaults.loadouts
  merged.loadouts = merged.loadouts.map((l) => {
    if (typeof l.slashCommand !== 'string' || !RETIRED_SLASH_COMMANDS.includes(l.slashCommand.trim())) return l
    const { slashCommand: _retired, ...rest } = l
    return rest
  })
  if (!merged.loadouts.some((l) => l.id === merged.defaultLoadoutId)) merged.defaultLoadoutId = merged.loadouts[0].id
  if (!Number.isInteger(merged.maxAutoRoundsPerMission) || merged.maxAutoRoundsPerMission < 0) {
    merged.maxAutoRoundsPerMission = defaults.maxAutoRoundsPerMission
  }
  if (!Number.isInteger(merged.maxPrAgeDays) || merged.maxPrAgeDays < 0) merged.maxPrAgeDays = defaults.maxPrAgeDays
  // An empty model is a deliberate "CLI default"; only a missing key takes the app default.
  if (merged.claudeModel === undefined) merged.claudeModel = defaults.claudeModel
  for (const key of ['projectsRoots', 'autoPostRepos', 'inactiveRepos'] as const) {
    if (!Array.isArray(merged[key])) merged[key] = defaults[key]
  }
  for (const key of ['repoPaths', 'prepareCommands'] as const) {
    if (!merged[key] || typeof merged[key] !== 'object') merged[key] = defaults[key]
  }
  merged.workspaces = Array.isArray(merged.workspaces)
    ? merged.workspaces.filter((w) => !!w && typeof w === 'object' && typeof w.id === 'string' && Array.isArray(w.repos))
    : defaults.workspaces
  return merged
}

function arrayOrEmpty<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : []
}

export function createEngine(opts: EngineOptions): Engine {
  const { ports } = opts
  const listeners: Listeners = { snapshot: new Set(), activity: new Set(), notification: new Set(), navigate: new Set() }
  const baseSettings = defaultSettings(opts.defaultSettings)
  const state: EngineState = { settings: baseSettings, inbox: [], missions: [], slots: [], localRepos: [] }

  let snapshotTimer: ReturnType<typeof setTimeout> | undefined
  let persistTimer: ReturnType<typeof setTimeout> | undefined
  let pollTimer: ReturnType<typeof setInterval> | undefined
  let stopped = false
  let lastBadge = -1
  let pollChain: Promise<void> = Promise.resolve()
  let pollInFlight = false

  function emit<E extends PushEvent>(event: E, payload: PushEvents[E]): void {
    for (const cb of listeners[event]) {
      try {
        cb(payload)
      } catch {
        // A broken subscriber must not take the engine down.
      }
    }
  }

  function snapshot(): AppSnapshot {
    return structuredClone({
      inbox: state.inbox,
      missions: state.missions,
      slots: state.slots,
      settings: state.settings,
      localRepos: state.localRepos,
      lastPollAt: state.lastPollAt,
      pollError: state.pollError,
      githubLogin: state.githubLogin,
      version: opts.version,
      environment: state.environment
    })
  }

  function emitSnapshotNow(): void {
    if (snapshotTimer) {
      clearTimeout(snapshotTimer)
      snapshotTimer = undefined
    }
    emit('snapshot', snapshot())
  }

  function scheduleSnapshot(): void {
    if (snapshotTimer) return
    snapshotTimer = setTimeout(() => {
      snapshotTimer = undefined
      emit('snapshot', snapshot())
    }, SNAPSHOT_COALESCE_MS)
  }

  function persistedState(): PersistedState {
    return structuredClone({
      missions: state.missions,
      settings: state.settings,
      inbox: state.inbox,
      lastPollAt: state.lastPollAt
    })
  }

  async function flushPersist(): Promise<void> {
    if (persistTimer) {
      clearTimeout(persistTimer)
      persistTimer = undefined
    }
    try {
      await ports.store.save(persistedState())
    } catch {
      // Persistence is best effort; the next change retries.
    }
  }

  function schedulePersist(): void {
    if (persistTimer) return
    persistTimer = setTimeout(() => {
      persistTimer = undefined
      void flushPersist()
    }, PERSIST_DEBOUNCE_MS)
  }

  // The OS notifier (dock badge, toast) must never fail a state transition.
  function updateBadge(): void {
    const count = state.missions.filter((m) => m.state === 'needs_you').length
    if (count === lastBadge) return
    lastBadge = count
    try {
      ports.notifier.setBadge(count)
    } catch {
      // Ignored; the next change retries.
    }
  }

  function notifyUser(n: PushEvents['notification']): void {
    emit('notification', n)
    if (!state.settings.notifications) return
    try {
      ports.notifier.notify(n)
    } catch {
      // In-app toast already went out via the push event.
    }
  }

  const sched = new Scheduler(state, ports, opts.homeDir, {
    onChange: () => {
      if (stopped) return
      scheduleSnapshot()
      schedulePersist()
      updateBadge()
    },
    onActivity: (activity) => emit('activity', activity),
    onNotification: notifyUser
  })

  function startPollTimer(): void {
    if (pollTimer) clearInterval(pollTimer)
    // Timers silently fall back to a 1ms delay above 2^31-1ms, which would
    // turn a huge interval into a polling storm.
    const delay = Math.min(Math.max(state.settings.pollIntervalSec, MIN_POLL_INTERVAL_SEC) * 1000, MAX_TIMER_DELAY_MS)
    pollTimer = setInterval(() => {
      if (!pollInFlight) refreshInbox().catch(() => undefined)
    }, delay)
  }

  async function refreshInbox(): Promise<AppSnapshot> {
    const run = pollChain.then(async () => {
      if (stopped) return
      pollInFlight = true
      try {
        await pollInbox(sched)
      } finally {
        pollInFlight = false
      }
    })
    pollChain = run.catch(() => undefined)
    await run
    return snapshot()
  }

  async function discoverRepos() {
    const roots = state.settings.projectsRoots
    const repos = await ports.repos.discover(roots)
    let detected: DetectedWorkspace[] | undefined
    try {
      detected = await ports.repos.discoverWorkspaces(roots)
    } catch {
      // The repo list is still good; the known workspaces stay as they are.
    }
    state.localRepos = repos
    if (detected) state.settings = { ...state.settings, workspaces: mergeDetectedWorkspaces(state.settings.workspaces, detected) }
    sched.changed()
    return structuredClone(repos)
  }

  async function updateSettings(patch: Partial<Settings>): Promise<Settings> {
    const previous = state.settings
    const next: Settings = { ...previous, ...structuredClone(patch) }
    validateSettings(next)
    const differs = (key: keyof Settings) => JSON.stringify(previous[key]) !== JSON.stringify(next[key])
    const slotsChanged = differs('slots')
    if (slotsChanged) {
      const kept = new Set(next.slots.map((s) => s.id))
      const busy = state.slots.find((s) => s.missionId && !kept.has(s.id))
      if (busy) throw new Error(`Slot '${busy.name}' is busy; wait for its mission to finish before removing it`)
    }
    state.settings = next
    if (slotsChanged) sched.rebuildSlots()
    if (previous.pollIntervalSec !== next.pollIntervalSec && pollTimer) startPollTimer()
    sched.changed()
    if (differs('projectsRoots') || differs('repoPaths')) {
      try {
        await discoverRepos()
      } catch {
        // The settings still took; missions report the missing checkout.
      }
    }
    if (differs('includeMine') || differs('inactiveRepos') || differs('maxPrAgeDays')) refreshInbox().catch(() => undefined)
    sched.schedule()
    // A rescan may have merged detected workspaces on top of the patch.
    return structuredClone(state.settings)
  }

  async function checkEnvironment(): Promise<EnvironmentCheck> {
    const result: EnvironmentCheck = opts.checkEnvironment
      ? await opts.checkEnvironment(structuredClone(state.settings))
      : {
          checkedAt: ports.clock.now().toISOString(),
          ok: false,
          items: [{ id: 'claude', label: ENVIRONMENT_CHECK_LABELS.claude, ok: false, detail: 'Environment checks are only available in the desktop app' }]
        }
    state.environment = structuredClone(result)
    if (!stopped) emitSnapshotNow()
    return structuredClone(result)
  }

  async function demoSimulate(args: DemoSimulateArgs): Promise<void> {
    const controls = opts.demoControls
    if (!controls) return
    const needPr = (): string => {
      if (!args.prId) throw new Error(`prId is required for '${args.kind}'`)
      return args.prId
    }
    switch (args.kind) {
      case 'push':
        controls.simulatePush?.(needPr())
        break
      case 'close':
        controls.simulateClose?.(needPr(), false)
        break
      case 'merge':
        controls.simulateClose?.(needPr(), true)
        break
      case 'new_pr':
        controls.simulateNewPullRequest?.()
        break
      case 'fail_next_review':
        controls.failNextReview?.()
        break
    }
    await refreshInbox()
  }

  const api: Api = {
    getSnapshot: async () => snapshot(),
    refreshInbox,
    dispatch: (args) => sched.dispatch(args),
    cancelMission: async (id) => sched.cancelMission(id),
    retryMission: async (id) => sched.retryMission(id),
    rerunMission: async (id, loadoutId) => sched.rerunMission(id, loadoutId),
    closeMission: (id) => sched.closeMission(id, 'closed by user'),
    setFindingDecision: async (args) => sched.setFindingDecision(args),
    setFindingDecisions: async (args) => sched.setFindingDecisions(args),
    setRoundSummary: async (args) => sched.setRoundSummary(args),
    setAutoFollowUp: async (args) => sched.setAutoFollowUp(args),
    previewComment: async (id) => sched.previewComment(id),
    postComment: (id) => sched.postComment(id),
    getActivity: async (id) => sched.getActivity(id),
    updateSettings,
    discoverRepos,
    openExternal: async (url) => {
      await opts.openExternal?.(url)
    },
    openPath: async (path) => {
      await opts.openPath?.(path)
    },
    demoSimulate,
    checkEnvironment,
    relaunch: async () => {
      await opts.relaunch?.()
    }
  }

  async function start(): Promise<void> {
    let persisted: PersistedState | null = null
    try {
      persisted = await ports.store.load()
    } catch {
      persisted = null
    }
    state.settings = sanitizeSettings(persisted?.settings, defaultSettings(opts.defaultSettings))
    state.missions = arrayOrEmpty(persisted?.missions)
    state.inbox = arrayOrEmpty(persisted?.inbox)
    state.lastPollAt = typeof persisted?.lastPollAt === 'string' ? persisted.lastPollAt : undefined
    sched.recover()
    emitSnapshotNow()
    updateBadge()

    // Queued missions need the repo list to resolve their checkout, so
    // discovery runs before the first scheduling pass and the first poll.
    void (async () => {
      try {
        await discoverRepos()
      } catch {
        // No repos yet; missions will report the missing checkout.
      }
      if (stopped) return
      sched.ready = true
      sched.schedule()
      await refreshInbox()
    })().catch(() => undefined)
    startPollTimer()
  }

  async function stop(): Promise<void> {
    stopped = true
    if (pollTimer) {
      clearInterval(pollTimer)
      pollTimer = undefined
    }
    if (snapshotTimer) {
      clearTimeout(snapshotTimer)
      snapshotTimer = undefined
    }
    sched.shutdown()
    await flushPersist()
  }

  return {
    api,
    subscribe(event, cb) {
      const set = listeners[event] as Set<typeof cb>
      set.add(cb)
      return () => {
        set.delete(cb)
      }
    },
    start,
    stop
  }
}
