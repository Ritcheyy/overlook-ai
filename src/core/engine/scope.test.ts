import { describe, expect, it } from 'vitest'
import { HEAD_SHA, PREV_SHA, makeFinding, makeMission, makeRound } from '../review/test-helpers'
import { isCleanRound, nextScope, wholePassDone, worseVerdict } from './scope'

const posted = (overrides = {}) => makeRound({ id: 'r1', index: 1, headSha: PREV_SHA, postedAt: '2026-09-13T12:00:00Z', ...overrides })
const followUp = (overrides = {}) => makeRound({ id: 'r2', index: 2, headSha: HEAD_SHA, previousHeadSha: PREV_SHA, postedAt: '2026-09-13T13:00:00Z', ...overrides })
const NEW_HEAD = 'e'.repeat(40)

describe('isCleanRound', () => {
  it('allows one finding above nit and any number of nits and praise', () => {
    expect(isCleanRound({ findings: [] })).toBe(true)
    expect(isCleanRound({ findings: [makeFinding({ severity: 'minor' }), makeFinding({ severity: 'nit' }), makeFinding({ severity: 'praise' })] })).toBe(true)
    expect(isCleanRound({ findings: [makeFinding({ severity: 'major' }), makeFinding({ severity: 'minor' })] })).toBe(false)
  })
})

describe('nextScope', () => {
  it('reads the delta by default and the whole PR when asked', () => {
    const m = makeMission({ rounds: [posted()] })
    expect(nextScope(m, NEW_HEAD)).toBe('delta')
    expect(nextScope(m, NEW_HEAD, 'whole')).toBe('whole')
    expect(nextScope(makeMission({ rounds: [followUp({ findings: [makeFinding({ severity: 'nit' })] })] }), NEW_HEAD, 'delta')).toBe('delta')
  })

  it('reads the whole PR when nothing was pushed since the posted round', () => {
    expect(nextScope(makeMission({ rounds: [posted()] }), PREV_SHA)).toBe('whole')
  })

  it('reads the whole PR after a clean follow-up, not after a clean first round or a busy follow-up', () => {
    expect(nextScope(makeMission({ rounds: [posted(), followUp({ findings: [makeFinding({ severity: 'minor' })] })] }), NEW_HEAD)).toBe('whole')
    expect(nextScope(makeMission({ rounds: [posted({ findings: [] })] }), NEW_HEAD)).toBe('delta')
    expect(nextScope(makeMission({ rounds: [posted(), followUp({ findings: [makeFinding({ severity: 'major' }), makeFinding({ severity: 'major' })] })] }), NEW_HEAD)).toBe('delta')
  })

  it('ignores rounds that were never posted', () => {
    expect(nextScope(makeMission({ rounds: [posted(), followUp({ postedAt: undefined, findings: [] })] }), NEW_HEAD)).toBe('delta')
    expect(nextScope(makeMission({ rounds: [] }), NEW_HEAD)).toBe('delta')
  })
})

describe('wholePassDone', () => {
  it('is true once a full pass completed at that head', () => {
    const m = makeMission({ rounds: [followUp({ scope: 'delta+whole' })] })
    expect(wholePassDone(m, HEAD_SHA)).toBe(true)
    expect(wholePassDone(m, NEW_HEAD)).toBe(false)
    expect(wholePassDone(makeMission({ rounds: [followUp({ scope: 'whole', error: 'boom' })] }), HEAD_SHA)).toBe(false)
    expect(wholePassDone(makeMission({ rounds: [followUp({ scope: 'delta', fullPassError: 'budget' })] }), HEAD_SHA)).toBe(false)
  })
})

describe('worseVerdict', () => {
  it('keeps the stricter of the two', () => {
    expect(worseVerdict('approve', 'comment')).toBe('comment')
    expect(worseVerdict('request_changes', 'approve')).toBe('request_changes')
    expect(worseVerdict('comment', 'comment')).toBe('comment')
  })
})
