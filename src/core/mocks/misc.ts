import type { DetectedWorkspace, LocalRepo, Notification } from '../domain'
import type { Clock, NotifierPort, ReposPort } from '../ports'

export class MockRepos implements ReposPort {
  constructor(
    public repos: LocalRepo[] = defaultDemoRepos(),
    public workspaces: DetectedWorkspace[] = defaultDemoWorkspaces()
  ) {}
  async discover(): Promise<LocalRepo[]> {
    return structuredClone(this.repos)
  }
  async discoverWorkspaces(): Promise<DetectedWorkspace[]> {
    return structuredClone(this.workspaces)
  }
  async readWorkspaceNotes(rootPath: string): Promise<string | undefined> {
    return this.workspaces.some((w) => w.rootPath === rootPath) ? DEMO_WORKSPACE_NOTES : undefined
  }
}

export const DEMO_WORKSPACE_ROOT = '/Users/demo/Projects/acme'

export const DEMO_WORKSPACE_NOTES = [
  '# Workspace notes',
  '',
  '- checkout-api#419 changes `sessionExpiresIn` to seconds; the web and mobile clients still assume milliseconds.',
  '- Promo codes are validated by checkout-api only; the clients never re-check them locally.'
].join('\n')

export function defaultDemoWorkspaces(): DetectedWorkspace[] {
  return [
    {
      rootPath: DEMO_WORKSPACE_ROOT,
      name: 'acme',
      repos: defaultDemoRepos().map((r) => r.fullName),
      hasClaudeMd: true
    }
  ]
}

export function defaultDemoRepos(): LocalRepo[] {
  return [
    { fullName: 'acme/checkout-api', path: '/Users/demo/Projects/checkout-api', defaultBranch: 'main' },
    { fullName: 'acme/storefront-web', path: '/Users/demo/Projects/storefront-web', defaultBranch: 'main' },
    { fullName: 'acme/mobile-app', path: '/Users/demo/Projects/mobile-app', defaultBranch: 'main' },
    { fullName: 'acme/notifications-service', path: '/Users/demo/Projects/notifications-service', defaultBranch: 'main' }
  ]
}

export class MockNotifier implements NotifierPort {
  notifications: Notification[] = []
  badge = 0
  notify(n: Notification): void {
    this.notifications.push(n)
  }
  setBadge(count: number): void {
    this.badge = count
  }
}

/** Manually advanced clock for deterministic timestamps in tests. */
export class FakeClock implements Clock {
  constructor(private t = new Date('2026-09-13T12:00:00Z').getTime()) {}
  now(): Date {
    return new Date(this.t)
  }
  advance(ms: number): void {
    this.t += ms
  }
}
