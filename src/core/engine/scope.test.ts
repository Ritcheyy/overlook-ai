import { describe, expect, it } from 'vitest'
import { HEAD_SHA, PREV_SHA, makeFinding, makeMission, makeRound } from '../review/test-helpers'
import { autoFullPassesUsed, fullPassHold, isCleanRound, nextScope, wholePassDone, worseVerdict } from './scope'

const posted = (overrides = {}) => makeRound({ id: 'r1', index: 1, headSha: PREV_SHA, postedAt: '2026-09-13T12:00:00Z', findings: [makeFinding({ severity: 'major' }), makeFinding({ severity: 'minor' })], ...overrides })
const followUp = (overrides = {}) => makeRound({ id: 'r2', index: 2, headSha: HEAD_SHA, previousHeadSha: PREV_SHA, postedAt: '2026-09-13T13:00:00Z', ...overrides })
const NEW_HEAD = 'e'.repeat(40)
const on = { fullPassBeforeApproval: true }
const off = { fullPassBeforeApproval: false }

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
    expect(nextScope(makeMission({ rounds: [posted(), followUp({ findings: [] })] }), NEW_HEAD)).toBe('delta')
  })

  it('reads the whole PR when nothing was pushed since the posted round', () => {
    expect(nextScope(makeMission({ rounds: [posted()] }), PREV_SHA)).toBe('whole')
    expect(nextScope(makeMission({ rounds: [posted()] }), PREV_SHA, 'delta')).toBe('delta')
  })

  it('ignores rounds that were never posted', () => {
    expect(nextScope(makeMission({ rounds: [posted(), followUp({ postedAt: undefined })] }), HEAD_SHA)).toBe('delta')
    expect(nextScope(makeMission({ rounds: [] }), NEW_HEAD)).toBe('delta')
  })
})

describe('fullPassHold', () => {
  it('lets a clean delta run a full pass after a round with real findings', () => {
    expect(fullPassHold(makeMission({ rounds: [posted()] }), HEAD_SHA, on)).toBeUndefined()
    expect(fullPassHold(makeMission({ rounds: [posted()] }), HEAD_SHA, off)).toBe('off')
  })

  it('holds it when the round before was clean, judged on the posted findings', () => {
    expect(fullPassHold(makeMission({ rounds: [posted({ findings: [makeFinding({ severity: 'minor' }), makeFinding({ severity: 'nit' })] })] }), HEAD_SHA, on)).toBe('previous_clean')
    expect(fullPassHold(makeMission({ rounds: [posted(), followUp({ findings: [] })] }), NEW_HEAD, on)).toBe('previous_clean')
    const twoMajorsOneDropped = followUp({ findings: [makeFinding({ severity: 'major' }), makeFinding({ severity: 'major', decision: 'dropped', dropReason: 'false_positive' })] })
    expect(fullPassHold(makeMission({ rounds: [posted(), twoMajorsOneDropped] }), NEW_HEAD, on)).toBe('previous_clean')
    // A round that had real findings arms it again.
    expect(fullPassHold(makeMission({ rounds: [posted({ findings: [] }), followUp({ findings: [makeFinding({ severity: 'major' }), makeFinding({ severity: 'major' })] })] }), NEW_HEAD, on)).toBeUndefined()
  })

  it('never treats a round whose full pass failed as clean', () => {
    const failed = followUp({ findings: [makeFinding({ severity: 'nit', decision: 'approved' })], fullPassError: 'budget' })
    expect(fullPassHold(makeMission({ rounds: [posted(), failed] }), NEW_HEAD, on)).toBeUndefined()
  })

  it('holds it once a full pass ran at that head', () => {
    expect(fullPassHold(makeMission({ rounds: [posted(), followUp({ scope: 'delta+whole', postedAt: undefined })] }), HEAD_SHA, on)).toBe('done_at_head')
  })

  it('holds it after two automatic full passes on the PR, failed ones included', () => {
    const first = followUp({ id: 'r2', index: 2, headSha: 'b'.repeat(40), scope: 'delta+whole', findings: [makeFinding({ severity: 'major' }), makeFinding({ severity: 'major', missedEarlier: true })] })
    const second = followUp({ id: 'r3', index: 3, headSha: 'c'.repeat(40), previousHeadSha: 'b'.repeat(40), scope: 'delta', fullPassError: 'budget', findings: [makeFinding({ severity: 'major' }), makeFinding({ severity: 'major' })] })
    expect(fullPassHold(makeMission({ rounds: [posted(), first] }), NEW_HEAD, on)).toBeUndefined()
    expect(fullPassHold(makeMission({ rounds: [posted(), first, second] }), NEW_HEAD, on)).toBe('used_up')
    // A manual whole-PR round does not count against the cap.
    const manual = followUp({ id: 'r3', index: 3, headSha: 'c'.repeat(40), scope: 'whole', findings: [makeFinding({ severity: 'major' }), makeFinding({ severity: 'major' })] })
    expect(fullPassHold(makeMission({ rounds: [posted(), first, manual] }), NEW_HEAD, on)).toBeUndefined()
  })

  it('ignores rounds that were never posted when judging the round before', () => {
    expect(fullPassHold(makeMission({ rounds: [posted(), followUp({ postedAt: undefined, findings: [] })] }), NEW_HEAD, on)).toBeUndefined()
  })
})

describe('autoFullPassesUsed', () => {
  it('counts chained full passes and failed attempts, not manual whole-PR rounds', () => {
    expect(autoFullPassesUsed(makeMission({ rounds: [posted(), followUp({ scope: 'delta+whole' }), followUp({ id: 'r3', scope: 'whole' }), followUp({ id: 'r4', scope: 'delta', fullPassError: 'timeout' })] }))).toBe(2)
    expect(autoFullPassesUsed(makeMission({ rounds: [] }))).toBe(0)
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
