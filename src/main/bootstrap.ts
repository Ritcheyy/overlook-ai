/**
 * Composition root. Reads persisted settings to decide between demo ports
 * (fake GitHub, fake runner) and the real adapters, then wires the engine to
 * IPC and OS notifications.
 */
import { app, Notification, shell } from 'electron'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { createEngine } from '@core/engine/api-server'
import type { Settings } from '@core/domain'
import { persistedDemoSeed } from '@core/demo/engine'
import type { Api, Engine, NavigateArgs } from '@core/ipc-contract'
import { notificationTarget, osNotificationActions, performNotificationAction } from '@core/notifications'
import type { NotifierPort, Ports } from '@core/ports'
import { systemClock } from '@core/ports'
import { defaultSettings } from '@core/loadouts'
import { MockGitHub } from '@core/mocks/github'
import { MockRepos } from '@core/mocks/misc'
import { MockRunner } from '@core/mocks/runner'
import { MockWorktree } from '@core/mocks/worktree'
import { updatedSince } from '@core/engine/poller'
import { ClaudeCliRunner } from './adapters/claude-cli'
import { CursorCliRunner } from './adapters/cursor-cli'
import { EngineRunner } from './adapters/engine-runner'
import { GhCliGitHub, type SearchFilter } from './adapters/gh-cli'
import { GitWorktree } from './adapters/git-worktree'
import { JsonFileStore } from './adapters/json-store'
import { RepoDiscovery } from './adapters/repo-discover'
import { checkEnvironment } from './environment'
import { broadcast, wireEngineToIpc } from './ipc'
import { importLoginShellPath } from './shell-path'
import { showMainWindow } from './window'

/** A new window subscribes to pushes once React has mounted, a beat after its load event. */
const NAVIGATE_AFTER_LOAD_MS = 300

function navigateTo(target: NavigateArgs): void {
  const { win, created } = showMainWindow()
  if (!created) {
    broadcast('navigate', target)
    return
  }
  win.webContents.once('did-finish-load', () => {
    setTimeout(() => broadcast('navigate', target), NAVIGATE_AFTER_LOAD_MS)
  })
}

/** The engine comes after the ports, so the notifier reaches its API through a getter. */
function electronNotifier(getApi: () => Api | undefined): NotifierPort {
  return {
    notify(n) {
      if (!Notification.isSupported()) return
      const actions = osNotificationActions(n)
      const note = new Notification({ title: n.title, body: n.body, actions: actions.map((a) => ({ type: 'button', text: a.label })) })
      note.on('click', () => navigateTo(notificationTarget(n)))
      note.on('action', (_event, index) => {
        const action = actions[index]
        const api = getApi()
        if (!action || !api) return
        performNotificationAction(api, n, action.id)
          .then((target) => {
            if (target) navigateTo(target)
          })
          .catch((e: Error) => {
            new Notification({ title: `${action.label} failed`, body: e.message }).show()
          })
      })
      note.show()
    },
    setBadge(count) {
      if (process.platform === 'darwin') app.dock?.setBadge(count > 0 ? String(count) : '')
      else app.setBadgeCount(count)
    }
  }
}

export async function bootstrap(): Promise<Engine> {
  const store = new JsonFileStore(join(app.getPath('userData'), 'state.json'))
  const persisted = await store.load().catch(() => null)
  const settings = persisted?.settings ?? defaultSettings()
  const demo = process.env['OVERLOOK_DEMO'] === '1' || settings.demoMode
  // Even in demo mode the environment check probes the real gh, git and claude.
  await importLoginShellPath()

  // Seeding from the persisted inbox keeps simulated pushes, merges and new
  // PRs across restarts; the fake repos give every demo mission a checkout.
  const github = new MockGitHub({ seed: persistedDemoSeed(persisted) })
  const worktree = new MockWorktree(1200)
  const runner = new MockRunner(1800)

  // The engine sanitises and updates settings after the ports exist, so the
  // gh adapter reads the latest copy through this holder rather than a snapshot.
  let current: Settings = settings
  const searchFilter = (): SearchFilter => ({
    inactiveRepos: Array.isArray(current.inactiveRepos) ? current.inactiveRepos : [],
    updatedSince: updatedSince(current, systemClock.now())?.toISOString().slice(0, 10)
  })

  let api: Api | undefined
  const notifier = electronNotifier(() => api)
  const ports: Ports = demo
    ? { github, worktree, runner, repos: new MockRepos(), store, notifier, clock: systemClock }
    : {
        github: new GhCliGitHub({ filter: searchFilter }),
        worktree: new GitWorktree(),
        runner: new EngineRunner({ claude: new ClaudeCliRunner(), cursor: new CursorCliRunner() }),
        repos: new RepoDiscovery(),
        store,
        notifier,
        clock: systemClock
      }

  const engine: Engine = createEngine({
    ports,
    version: app.getVersion(),
    homeDir: homedir(),
    openExternal: (url) => shell.openExternal(url),
    openPath: async (path) => {
      await shell.openPath(path)
    },
    checkEnvironment: (current) => checkEnvironment(current, homedir()),
    relaunch: async () => {
      await engine.stop()
      app.relaunch()
      app.exit(0)
    },
    demoControls: demo
      ? {
          simulatePush: (prId) => void github.simulatePush(prId),
      simulateReply: (prId) => void github.simulateReply(prId),
          simulateClose: (prId, merged) => void github.simulateClose(prId, merged),
          simulateNewPullRequest: () => void github.simulateNewPullRequest(),
          failNextReview: () => {
            runner.failNext = true
          }
        }
      : undefined
  })
  api = engine.api
  engine.subscribe('snapshot', (snap) => {
    current = snap.settings
  })
  wireEngineToIpc(engine)
  await engine.start()
  return engine
}
