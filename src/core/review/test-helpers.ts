/** Fixtures for the review and comment-builder tests. Not used at runtime. */
import type { Finding, Mission, PullRequest, ReviewRound } from '../domain'
import { prIdOf, repoRefFromFullName } from '../domain'
import { BUILT_IN_LOADOUTS, defaultSettings } from '../loadouts'
import type { ReviewRequest, WorkspaceContext } from '../ports'

export const HEAD_SHA = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678'
export const PREV_SHA = '9f8e7d6c5b4a30211f0e9d8c7b6a5f4e3d2c1b0a'

export function makePr(overrides: Partial<PullRequest> = {}): PullRequest {
  const fullName = overrides.repo?.fullName ?? 'acme/checkout-api'
  const number = overrides.number ?? 412
  return {
    id: prIdOf(fullName, number),
    repo: repoRefFromFullName(fullName),
    number,
    title: 'fix(refunds): make refund creation idempotent per order',
    body: 'Refunds could be created twice when the client retried.',
    author: 'dami-codes',
    url: `https://github.com/${fullName}/pull/${number}`,
    headRef: 'fix/refund-idempotency',
    headSha: HEAD_SHA,
    baseRef: 'main',
    isDraft: false,
    state: 'open',
    createdAt: '2026-09-13T08:00:00.000Z',
    updatedAt: '2026-09-13T10:00:00.000Z',
    labels: ['backend'],
    reviewRequested: true,
    mine: false,
    ...overrides
  }
}

let findingSeq = 0

export function makeFinding(overrides: Partial<Finding> = {}): Finding {
  findingSeq++
  return {
    id: `f-${findingSeq}`,
    severity: 'major',
    category: 'correctness',
    title: `Finding ${findingSeq}`,
    body: `Body of finding ${findingSeq}.`,
    decision: 'approved',
    ...overrides
  }
}

export function makeRound(overrides: Partial<ReviewRound> = {}): ReviewRound {
  return {
    id: 'round-1',
    index: 1,
    headSha: HEAD_SHA,
    startedAt: '2026-09-13T10:05:00.000Z',
    findings: [],
    summary: 'Solid change with one real bug around retries.',
    verdict: 'request_changes',
    ...overrides
  }
}

export function makeMission(overrides: Partial<Mission> = {}): Mission {
  const pr = overrides.pr ?? makePr()
  return {
    id: 'mission-1',
    prId: pr.id,
    pr,
    loadoutId: 'blind',
    state: 'needs_you',
    rounds: [],
    stale: false,
    autoPost: false,
    createdAt: '2026-09-13T10:00:00.000Z',
    updatedAt: '2026-09-13T10:30:00.000Z',
    timeline: [],
    ...overrides
  }
}

export function makeRequest(overrides: Partial<ReviewRequest> = {}): ReviewRequest {
  const mission = overrides.mission ?? makeMission()
  const round = overrides.round ?? makeRound()
  return {
    mission,
    round,
    loadout: { ...BUILT_IN_LOADOUTS[0] },
    worktreePath: '/Users/demo/.overlook/worktrees/acme/checkout-api/pr-412',
    diff: 'diff --git a/src/refunds/refund.service.ts b/src/refunds/refund.service.ts\n@@ -40,3 +40,5 @@\n+const key = sha256(orderId + amount)\n',
    settings: defaultSettings({ demoMode: false }),
    ...overrides
  }
}

export function makeWorkspace(overrides: Partial<WorkspaceContext> = {}): WorkspaceContext {
  return {
    name: 'acme',
    rootPath: '/Users/demo/Projects/acme',
    siblings: [
      { fullName: 'acme/storefront-web', path: '/Users/demo/Projects/storefront-web', defaultBranch: 'main' },
      { fullName: 'acme/mobile-app', path: '/Users/demo/Projects/mobile-app', defaultBranch: 'main' },
      { fullName: 'acme/notifications-service' }
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
    notes: '# Workspace notes\n\n- checkout-api#419 changes `sessionExpiresIn` to seconds.',
    ...overrides
  }
}
