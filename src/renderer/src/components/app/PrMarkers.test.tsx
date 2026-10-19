// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import type { AppSnapshot } from '@core/domain'
import { defaultSettings } from '@core/loadouts'
import { makeMission, makePr, makeRound } from '@core/review/test-helpers'

vi.mock('@/lib/api', () => ({ api: {}, onPush: vi.fn(() => () => {}), isElectron: false }))

import { useAppStore } from '@/state/store'
import { PrMarkers, followUpLimitReached } from './PrMarkers'

afterEach(cleanup)

function withSettings(maxAutoRoundsPerMission: number) {
  const settings = defaultSettings({ maxAutoRoundsPerMission })
  const snapshot: AppSnapshot = { inbox: [], ignoredPrs: {}, missions: [], slots: settings.slots, settings, localRepos: [], version: 'test' }
  useAppStore.setState({ snapshot, loading: false })
  return settings
}

const usedUp = makeMission({
  state: 'watching',
  rounds: [makeRound({ id: 'r1', index: 1, postedAt: '2026-09-13T11:00:00.000Z' }), makeRound({ id: 'r2', index: 2, trigger: 'reply' }), makeRound({ id: 'r3', index: 3, trigger: 'reply' })]
})

describe('PrMarkers', () => {
  it('tags a watched review that has used all its automatic follow-ups', () => {
    const settings = withSettings(2)
    expect(followUpLimitReached(usedUp, settings)).toBe(true)
    render(<PrMarkers pr={makePr()} mission={usedUp} />)
    expect(screen.getByText('auto limit reached').closest('[title]')?.getAttribute('title')).toBe('All 2 automatic follow-ups are used; re-run the next round yourself')
  })

  it('stays quiet below the cap, when follow-ups are off altogether, and once the review is closed', () => {
    withSettings(3)
    render(<PrMarkers pr={makePr()} mission={usedUp} />)
    expect(screen.queryByText('auto limit reached')).toBeNull()
    cleanup()
    withSettings(0)
    render(<PrMarkers pr={makePr()} mission={usedUp} />)
    expect(screen.queryByText('auto limit reached')).toBeNull()
    cleanup()
    withSettings(2)
    render(<PrMarkers pr={makePr()} mission={{ ...usedUp, state: 'closed' }} />)
    expect(screen.queryByText('auto limit reached')).toBeNull()
  })
})
