import { describe, expect, it } from 'vitest'
import type { Mission, PullRequest } from '../domain'
import { seedPullRequests } from '../demo/seed'
import { defaultSettings } from '../loadouts'
import { applyInboxFilters, authorRepliesSince, autoFollowUpAllowed, inboxWanted, mergeListings, updatedSince } from './poller'

const NOW = new Date('2026-09-13T12:00:00Z')
const DAY = 86_400_000

function pr(fullName: string, number: number, daysAgo: number): PullRequest {
  const base = seedPullRequests(NOW)[0]
  const updatedAt = new Date(NOW.getTime() - daysAgo * DAY).toISOString()
  return { ...base, id: `${fullName}#${number}`, repo: { host: 'github', owner: fullName.split('/')[0], name: fullName.split('/')[1], fullName }, number, updatedAt }
}

function mission(p: PullRequest, state: Mission['state']): Mission {
  const at = NOW.toISOString()
  return { id: `m-${p.number}`, prId: p.id, pr: p, loadoutId: 'blind', state, rounds: [], stale: false, autoPost: false, createdAt: at, updatedAt: at, timeline: [] }
}

describe('updatedSince', () => {
  it('is the cut-off date, or undefined when the age limit is off', () => {
    expect(updatedSince({ maxPrAgeDays: 30 }, NOW)?.toISOString()).toBe('2026-08-14T12:00:00.000Z')
    expect(updatedSince({ maxPrAgeDays: 0 }, NOW)).toBeUndefined()
    expect(updatedSince({ maxPrAgeDays: Number.NaN }, NOW)).toBeUndefined()
  })
})

describe('inboxWanted', () => {
  it('drops PRs from inactive repos', () => {
    const settings = defaultSettings({ inactiveRepos: ['acme/legacy'] })
    expect(inboxWanted(pr('acme/legacy', 1, 0), settings, NOW)).toBe(false)
    expect(inboxWanted(pr('acme/checkout-api', 1, 0), settings, NOW)).toBe(true)
  })

  it('drops PRs older than maxPrAgeDays and keeps everything when it is 0', () => {
    expect(inboxWanted(pr('acme/checkout-api', 1, 31), defaultSettings({ maxPrAgeDays: 30 }), NOW)).toBe(false)
    expect(inboxWanted(pr('acme/checkout-api', 1, 29), defaultSettings({ maxPrAgeDays: 30 }), NOW)).toBe(true)
    expect(inboxWanted(pr('acme/checkout-api', 1, 2000), defaultSettings({ maxPrAgeDays: 0 }), NOW)).toBe(true)
  })

  it('keeps a PR whose updatedAt cannot be parsed', () => {
    expect(inboxWanted({ ...pr('acme/checkout-api', 1, 0), updatedAt: 'garbage' }, defaultSettings(), NOW)).toBe(true)
  })
})

describe('applyInboxFilters', () => {
  it('removes unwanted PRs from the listing unless a live mission holds them', () => {
    const settings = defaultSettings({ inactiveRepos: ['acme/legacy'], maxPrAgeDays: 30 })
    const stale = pr('acme/checkout-api', 2, 90)
    const inactive = pr('acme/legacy', 3, 0)
    const inactiveHeld = pr('acme/legacy', 4, 0)
    const staleClosed = pr('acme/checkout-api', 5, 90)
    const fresh = pr('acme/checkout-api', 6, 1)
    const listed = mergeListings([stale, inactive, inactiveHeld, staleClosed, fresh], [])
    applyInboxFilters(listed, [mission(inactiveHeld, 'watching'), mission(staleClosed, 'closed')], settings, NOW)
    expect([...listed.keys()]).toEqual([inactiveHeld.id, fresh.id])
  })
})

describe('authorRepliesSince', () => {
  const posted = { url: 'https://github.com/acme/checkout-api/pull/412#issuecomment-100', createdAt: '2026-09-13T12:00:05Z' }
  const watched = (author: string): Mission => ({
    ...mission({ ...pr('acme/checkout-api', 412, 0), author }, 'watching'),
    rounds: [
      {
        id: 'r1',
        index: 1,
        headSha: 'a'.repeat(40),
        startedAt: '2026-09-13T11:00:00Z',
        findings: [],
        summary: '',
        verdict: 'comment',
        postedAt: '2026-09-13T12:00:07Z',
        postedCommentUrl: 'https://github.com/acme/checkout-api/pull/412#issuecomment-100'
      }
    ]
  })
  const comment = (id: number, author: string, createdAt: string) => ({ url: `https://github.com/acme/checkout-api/pull/412#issuecomment-${id}`, author, body: `c${id}`, createdAt })

  it("counts only the author's comments after the posted review", () => {
    const replies = authorRepliesSince(watched('dami-codes'), [
      comment(90, 'dami-codes', '2026-09-13T11:59:00Z'),
      { ...comment(100, 'ritchey', posted.createdAt), url: posted.url },
      comment(101, 'vercel', '2026-09-13T12:01:00Z'),
      comment(102, 'Dami-Codes', '2026-09-13T12:02:00Z')
    ])
    expect(replies.map((r) => r.body)).toEqual(['c102'])
  })

  it("tells the app's own comment from the author's on a self-review by comment id", () => {
    const replies = authorRepliesSince(watched('ritchey'), [
      { ...comment(100, 'ritchey', posted.createdAt), url: posted.url },
      comment(101, 'ritchey', '2026-09-13T12:06:00Z')
    ])
    expect(replies.map((r) => r.body)).toEqual(['c101'])
  })

  it('uses GitHub time for the posted comment, so a reply seconds after it still counts under clock drift', () => {
    const replies = authorRepliesSince(watched('dami-codes'), [{ ...comment(100, 'ritchey', posted.createdAt), url: posted.url }, comment(101, 'dami-codes', '2026-09-13T12:00:06Z')])
    expect(replies).toHaveLength(1)
  })

  it('finds nothing before anything was posted', () => {
    expect(authorRepliesSince({ ...watched('dami-codes'), rounds: [] }, [comment(101, 'dami-codes', '2026-09-13T12:06:00Z')])).toEqual([])
  })
})

describe('autoFollowUpAllowed', () => {
  it('counts the automatic rounds the previous version started from their queue note', () => {
    const m = {
      ...mission(pr('acme/checkout-api', 412, 0), 'watching'),
      timeline: [
        { at: '2026-09-13T10:00:00Z', to: 'queued' as const },
        { at: '2026-09-13T11:00:00Z', from: 'watching' as const, to: 'queued' as const, note: 'new push 1234567' },
        { at: '2026-09-13T11:30:00Z', from: 'watching' as const, to: 'queued' as const, note: 'rerun requested (Blind review)' }
      ]
    }
    expect(autoFollowUpAllowed(m, defaultSettings({ maxAutoRoundsPerMission: 1 }))).toBe(false)
    expect(autoFollowUpAllowed(m, defaultSettings({ maxAutoRoundsPerMission: 2 }))).toBe(true)
  })
})

