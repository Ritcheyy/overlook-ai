/**
 * Composes the mocks into an Engine that runs entirely in the browser (used by
 * `pnpm dev:web`, the Playwright web tests, and demo mode).
 */
import type { EnvironmentCheckId, PullRequest } from '../domain'
import { ENVIRONMENT_CHECK_LABELS } from '../domain'
import type { Engine } from '../ipc-contract'
import { createEngine } from '../engine/api-server'
import { defaultSettings } from '../loadouts'
import type { PersistedState, StorePort } from '../ports'
import { systemClock } from '../ports'
import { MockGitHub } from '../mocks/github'
import { MockNotifier, MockRepos } from '../mocks/misc'
import { MockRunner } from '../mocks/runner'
import { MemoryStore } from '../mocks/store'
import { MockWorktree } from '../mocks/worktree'

export interface DemoEngineOptions {
  /** Milliseconds per fake step. 0 = instant (tests). ~1500 feels live. */
  stepMs?: number
  version?: string
  openExternal?: (url: string) => Promise<void>
}

export const DEMO_STORAGE_KEY = 'overlook-demo-state'
export const DEMO_HOME_DIR = '/Users/demo'
export const DEMO_SETTINGS = { demoMode: true, pollIntervalSec: 30 } as const
const DEMO_ENVIRONMENT: [EnvironmentCheckId, string][] = [
  ['gh', 'demo login'],
  ['claude', 'demo reviewer'],
  ['git', 'demo'],
  ['worktreeRoot', `${DEMO_HOME_DIR}/.overlook/worktrees`]
]

function localStorageOrNull(): Storage | null {
  try {
    const ls = globalThis.localStorage
    return ls && typeof ls.getItem === 'function' ? ls : null
  } catch {
    return null
  }
}

function readStoredState(): PersistedState | null {
  try {
    const raw = localStorageOrNull()?.getItem(DEMO_STORAGE_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : null
    if (parsed && typeof parsed === 'object') return parsed as PersistedState
  } catch {
    // Corrupt or unreadable storage starts fresh.
  }
  return null
}

function demoDefaults(): PersistedState {
  return { missions: [], inbox: [], settings: defaultSettings(DEMO_SETTINGS) }
}

/** localStorage-backed store; falls back to memory where storage is missing or blocked. */
export function createDemoStore(): StorePort {
  const memory = new MemoryStore()
  return {
    async load() {
      return readStoredState() ?? (await memory.load()) ?? demoDefaults()
    },
    async save(state) {
      await memory.save(state)
      try {
        localStorageOrNull()?.setItem(DEMO_STORAGE_KEY, JSON.stringify(state))
      } catch {
        // Quota or privacy mode; memory keeps the session alive.
      }
    }
  }
}

/**
 * PRs the previous session left in the inbox, so pushes, merges and new PRs
 * simulated earlier survive a reload instead of snapping back to the seed.
 */
export function persistedDemoSeed(state: PersistedState | null): PullRequest[] | undefined {
  const inbox = state?.inbox
  if (!Array.isArray(inbox) || inbox.length === 0) return undefined
  const valid = inbox.every((p) => p && typeof p.id === 'string' && typeof p.repo?.fullName === 'string')
  return valid ? inbox : undefined
}

export function createDemoEngine(opts: DemoEngineOptions = {}): Engine {
  const stepMs = opts.stepMs ?? 1500
  const github = new MockGitHub({ clock: systemClock, seed: persistedDemoSeed(readStoredState()) })
  const worktree = new MockWorktree(stepMs)
  const runner = new MockRunner(stepMs)
  return createEngine({
    ports: {
      github,
      worktree,
      runner,
      repos: new MockRepos(),
      store: createDemoStore(),
      notifier: new MockNotifier(),
      clock: systemClock
    },
    version: opts.version ?? 'demo',
    homeDir: DEMO_HOME_DIR,
    defaultSettings: DEMO_SETTINGS,
    openExternal: opts.openExternal,
    checkEnvironment: async () => ({
      checkedAt: systemClock.now().toISOString(),
      ok: true,
      items: DEMO_ENVIRONMENT.map(([id, detail]) => ({ id, label: ENVIRONMENT_CHECK_LABELS[id], ok: true, detail }))
    }),
    relaunch: async () => undefined,
    demoControls: {
      simulatePush: (prId) => void github.simulatePush(prId),
      simulateClose: (prId, merged) => void github.simulateClose(prId, merged),
      simulateNewPullRequest: () => void github.simulateNewPullRequest(),
      failNextReview: () => {
        runner.failNext = true
      }
    }
  })
}
