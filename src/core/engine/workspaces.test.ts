import { describe, expect, it } from 'vitest'
import type { DetectedWorkspace, Workspace } from '../domain'
import { seedPullRequests } from '../demo/seed'
import { defaultDemoRepos } from '../mocks/misc'
import { buildWorkspaceContext, describeWorkspaceContext, mergeDetectedWorkspaces, uniqueWorkspaceId, workspaceFor, workspaceSlug } from './workspaces'

const ACME_REPOS = ['acme/checkout-api', 'acme/storefront-web', 'acme/mobile-app', 'acme/notifications-service']

const detected = (overrides: Partial<DetectedWorkspace> = {}): DetectedWorkspace => ({
  rootPath: '/Users/demo/Projects/acme',
  name: 'acme',
  repos: ACME_REPOS,
  hasClaudeMd: true,
  ...overrides
})

const workspace = (overrides: Partial<Workspace> = {}): Workspace => ({
  id: 'ws-acme',
  name: 'acme',
  rootPath: '/Users/demo/Projects/acme',
  repos: ACME_REPOS,
  enabled: true,
  source: 'detected',
  includeNotes: true,
  ...overrides
})

describe('workspaceSlug and uniqueWorkspaceId', () => {
  it('slugs names and numbers collisions', () => {
    expect(workspaceSlug('Acme Apps (2026)')).toBe('acme-apps-2026')
    expect(workspaceSlug('***')).toBe('workspace')
    expect(uniqueWorkspaceId('acme', [])).toBe('ws-acme')
    expect(uniqueWorkspaceId('acme', ['ws-acme'])).toBe('ws-acme-2')
    expect(uniqueWorkspaceId('acme', ['ws-acme', 'ws-acme-2'])).toBe('ws-acme-3')
  })
})

describe('mergeDetectedWorkspaces', () => {
  it('adds new containers, enabled only when they carry a CLAUDE.md', () => {
    const merged = mergeDetectedWorkspaces([], [detected(), detected({ rootPath: '/Users/demo/Projects/beta', name: 'beta', repos: ['beta/a', 'beta/b'], hasClaudeMd: false })])
    expect(merged).toEqual([
      workspace(),
      { id: 'ws-beta', name: 'beta', rootPath: '/Users/demo/Projects/beta', repos: ['beta/a', 'beta/b'], enabled: false, source: 'detected', includeNotes: true }
    ])
  })

  it("keeps the user's name and switches, refreshes repos from disk, drops vanished roots and leaves manual entries alone", () => {
    const kept = workspace({ name: 'Acme apps', enabled: false, includeNotes: false, repos: ['acme/checkout-api'] })
    const vanished = workspace({ id: 'ws-old', name: 'old', rootPath: '/Users/demo/Projects/old', repos: ['old/a', 'old/b'] })
    const manual: Workspace = { id: 'ws-mine', name: 'Mine', repos: ['acme/checkout-api', 'other/tool'], enabled: true, source: 'manual', includeNotes: false }
    const merged = mergeDetectedWorkspaces([vanished, kept, manual], [detected({ repos: ['acme/checkout-api', 'acme/storefront-web'] })])
    expect(merged).toEqual([{ ...kept, repos: ['acme/checkout-api', 'acme/storefront-web'] }, manual])
    expect(merged[1]).toBe(manual)
  })

  it('does not reuse an id a manual workspace already holds', () => {
    const manual: Workspace = { id: 'ws-acme', name: 'acme', repos: [], enabled: true, source: 'manual', includeNotes: false }
    const merged = mergeDetectedWorkspaces([manual], [detected()])
    expect(merged.map((w) => w.id)).toEqual(['ws-acme', 'ws-acme-2'])
  })

  it('matches by root path even when a manual entry shares the name', () => {
    const merged = mergeDetectedWorkspaces([workspace({ id: 'ws-1' })], [detected({ name: 'renamed-on-disk' })])
    expect(merged).toEqual([workspace({ id: 'ws-1' })])
  })
})

describe('workspaceFor', () => {
  it('returns the first enabled workspace listing the repo', () => {
    const off = workspace({ id: 'ws-off', enabled: false })
    const on = workspace({ id: 'ws-on' })
    expect(workspaceFor([off, on], 'acme/checkout-api')).toBe(on)
    expect(workspaceFor([off], 'acme/checkout-api')).toBeUndefined()
    expect(workspaceFor([on], 'other/tool')).toBeUndefined()
  })
})

describe('buildWorkspaceContext', () => {
  const now = new Date('2026-09-13T12:00:00Z')

  it('lists the other repos with their checkouts and keeps only open PRs of mine in them', () => {
    const prs = seedPullRequests(now)
    const merged = { ...prs.find((p) => p.number === 1210)!, state: 'merged' as const }
    const context = buildWorkspaceContext({
      workspace: workspace(),
      fullName: 'acme/checkout-api',
      localRepos: defaultDemoRepos().filter((r) => r.fullName !== 'acme/mobile-app'),
      pathOf: (name) => (name === 'acme/mobile-app' ? '/Users/demo/Code/mobile-app' : defaultDemoRepos().find((r) => r.fullName === name)?.path),
      myPrs: [merged, ...prs.filter((p) => p.mine && p.number !== 1210), prs.find((p) => p.number === 1203)!],
      notes: 'notes'
    })
    expect(context).toEqual({
      name: 'acme',
      rootPath: '/Users/demo/Projects/acme',
      siblings: [
        { fullName: 'acme/storefront-web', path: '/Users/demo/Projects/storefront-web', defaultBranch: 'main' },
        { fullName: 'acme/mobile-app', path: '/Users/demo/Code/mobile-app' },
        { fullName: 'acme/notifications-service', path: '/Users/demo/Projects/notifications-service', defaultBranch: 'main' }
      ],
      myOpenPrs: [
        {
          fullName: 'acme/storefront-web',
          number: 1203,
          title: 'feat(cart): persist promo code across sessions',
          headRef: 'feat/persist-promo',
          baseRef: 'main',
          url: 'https://github.com/acme/storefront-web/pull/1203'
        }
      ],
      notes: 'notes'
    })
  })

  it('omits rootPath and notes when absent and never lists the reviewed repo as a sibling', () => {
    const manual: Workspace = { id: 'ws-mine', name: 'Mine', repos: ['acme/checkout-api', 'other/tool'], enabled: true, source: 'manual', includeNotes: false }
    const context = buildWorkspaceContext({ workspace: manual, fullName: 'acme/checkout-api', localRepos: [], pathOf: () => undefined, myPrs: [] })
    expect(context).toEqual({ name: 'Mine', siblings: [{ fullName: 'other/tool' }], myOpenPrs: [] })
    expect('rootPath' in context).toBe(false)
    expect('notes' in context).toBe(false)
  })
})

describe('describeWorkspaceContext', () => {
  it('counts siblings and open PRs', () => {
    expect(describeWorkspaceContext({ name: 'acme', siblings: [{ fullName: 'a/b' }, { fullName: 'a/c' }], myOpenPrs: [] })).toBe('Workspace acme: 2 sibling repos, 0 of your open PRs')
    expect(
      describeWorkspaceContext({
        name: 'pair',
        siblings: [{ fullName: 'a/b' }],
        myOpenPrs: [{ fullName: 'a/b', number: 1, title: 't', headRef: 'h', baseRef: 'main', url: 'u' }]
      })
    ).toBe('Workspace pair: 1 sibling repo, 1 of your open PRs')
  })
})
