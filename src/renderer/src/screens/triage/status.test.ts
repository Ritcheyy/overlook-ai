import { describe, expect, it } from 'vitest'
import { defaultSettings } from '@core/loadouts'
import { makeFinding, makeMission, makeRound } from '@core/review/test-helpers'
import { groupTimeline } from './timeline-groups'
import { statusFor } from './status'

const settings = defaultSettings({ maxAutoRoundsPerMission: 0 })
const reply = { url: 'https://github.com/acme/checkout-api/pull/412#issuecomment-9', author: 'dami-codes', body: 'Fixed', createdAt: '2026-09-13T12:10:00Z' }
const posted = makeRound({ postedAt: '2026-09-13T12:00:00Z', postedCommentUrl: 'https://github.com/x#issuecomment-1' })

describe('statusFor', () => {
  it('offers a review for a PR nobody has reviewed', () => {
    expect(statusFor(undefined, settings)).toMatchObject({ text: 'Not reviewed yet.', action: 'review' })
  })

  it('says why a push did not start a follow-up and offers the delta', () => {
    const m = makeMission({ state: 'watching', stale: true, rounds: [posted] })
    const s = statusFor(m, settings)
    expect(s.action).toBe('review_delta')
    expect(s.text).toContain('pushed a1b2c3d after round 1')
    expect(s.text).toContain('Automatic follow-ups are off in Settings.')
  })

  it('tells a reply without a push from one with a push', () => {
    const replied = makeMission({ state: 'watching', rounds: [posted], authorReplies: [reply] })
    expect(statusFor(replied, settings)).toMatchObject({ icon: 'reply', action: 'review_again' })
    // Nothing was pushed, so there is no delta: a re-run reads it all.
    expect(statusFor(replied, settings)).toMatchObject({ text: `${replied.pr.author} replied to round 1 without pushing. Review again reads the whole PR.`, scope: 'whole' })
    const both = { ...replied, stale: true, pr: { ...replied.pr, headSha: 'b'.repeat(40) } }
    expect(statusFor(both, settings).text).toContain('replied and pushed')
    expect(statusFor(both, settings).text).not.toContain('reads the whole PR')
    expect(statusFor(both, settings)).toMatchObject({ action: 'review_delta', scope: 'delta' })
  })

  it('says when a clean delta gets a full pass, and when the automatic ones are used up', () => {
    const busy = { ...posted, findings: [makeFinding({ severity: 'major', decision: 'approved' }), makeFinding({ severity: 'minor', decision: 'approved' })] }
    const m = makeMission({ state: 'watching', stale: true, rounds: [busy], pr: { ...makeMission().pr, headSha: 'd'.repeat(40) } })
    expect(statusFor(m, settings)).toMatchObject({ action: 'review_delta', scope: 'delta', fullPass: 'follows' })
    expect(statusFor(m, settings).text).toContain('If the delta is clean, a full pass follows.')
    // After a clean round the next delta stays a delta, and the setting off says nothing either.
    const clean = { ...posted, findings: [makeFinding({ severity: 'nit', decision: 'approved' })] }
    expect(statusFor({ ...m, rounds: [clean] }, settings)).toMatchObject({ scope: 'delta', fullPass: undefined })
    expect(statusFor({ ...m, rounds: [clean] }, settings).text).not.toContain('full pass')
    expect(statusFor(m, { ...settings, fullPassBeforeApproval: false }).text).not.toContain('full pass')
    // The cap is said, so the user knows to tick Read the whole PR.
    const spent = [1, 2].map((i) => makeRound({ id: `r${i + 1}`, index: i + 1, headSha: `${i}`.repeat(40), previousHeadSha: 'c'.repeat(40), scope: 'delta+whole' as const, postedAt: `2026-09-1${i + 3}T13:00:00Z`, findings: busy.findings }))
    expect(statusFor({ ...m, rounds: [busy, ...spent] }, settings)).toMatchObject({ fullPass: 'used_up' })
    expect(statusFor({ ...m, rounds: [busy, ...spent] }, settings).text).toContain('Automatic full passes are used up; tick Read the whole PR for another.')
    // Quietly watching says nothing about scope; only a re-run offered after a push does.
    const idle = makeMission({ state: 'watching', rounds: [busy], pr: { ...makeMission().pr, headSha: busy.headSha } })
    expect(statusFor(idle, settings).text).not.toContain('full pass')
  })

  it('counts the findings waiting for decisions and puts a posting error first', () => {
    const waiting = makeMission({ state: 'needs_you', rounds: [makeRound({ findings: [makeFinding()] })] })
    expect(statusFor(waiting, settings).text).toBe('1 finding waits for your decision.')
    expect(statusFor({ ...waiting, error: 'Posting failed: 502\nmore' }, settings)).toMatchObject({ tone: 'rose', text: 'Posting failed: 502' })
  })

  it('offers a retry with the first line of the error', () => {
    const failed = makeMission({ state: 'failed', error: 'git worktree add failed\nstderr tail' })
    expect(statusFor(failed, settings)).toMatchObject({ action: 'retry', text: 'The review failed: git worktree add failed' })
  })
})

describe('groupTimeline', () => {
  it('splits the timeline into attempts named after the round each produced', () => {
    const rounds = [makeRound({ id: 'r1', index: 1, startedAt: '2026-09-13T10:00:05Z' }), makeRound({ id: 'r2', index: 2, startedAt: '2026-09-13T11:00:05Z' })]
    const groups = groupTimeline({
      rounds,
      timeline: [
        { at: '2026-09-13T10:00:00Z', to: 'queued' },
        { at: '2026-09-13T10:00:01Z', from: 'queued', to: 'preparing' },
        { at: '2026-09-13T10:00:05Z', from: 'preparing', to: 'reviewing' },
        { at: '2026-09-13T10:05:00Z', from: 'reviewing', to: 'watching', note: 'posted round 1' },
        { at: '2026-09-13T10:30:00Z', to: 'watching', note: 'new push 1234567; waiting for a reply' },
        { at: '2026-09-13T10:40:00Z', from: 'watching', to: 'queued', note: 'retry' },
        { at: '2026-09-13T10:40:01Z', from: 'queued', to: 'failed', note: 'Cancelled' },
        { at: '2026-09-13T11:00:00Z', from: 'failed', to: 'queued', note: 'dami-codes replied; follow-up on 1234567' },
        { at: '2026-09-13T11:00:05Z', from: 'queued', to: 'reviewing' }
      ]
    })
    expect(groups.map((g) => g.label)).toEqual(['Round 1', 'Failed before reviewing', 'Round 2'])
    expect(groups[0].events).toHaveLength(5)
    expect(groups[2].reason).toBe('dami-codes replied; follow-up on 1234567')
  })
})
