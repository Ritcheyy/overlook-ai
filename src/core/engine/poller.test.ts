import { describe, expect, it } from 'vitest'
import type { Mission, PullRequest } from '../domain'
import { seedPullRequests } from '../demo/seed'
import { defaultSettings } from '../loadouts'
import { applyInboxFilters, inboxWanted, mergeListings, updatedSince } from './poller'

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
