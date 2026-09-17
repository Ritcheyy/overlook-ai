import { describe, expect, it } from 'vitest'
import type { Mission, MissionState } from '@core/domain'
import { failedMissionForSlot, floorIsEmpty, hasUnreviewedPush, selectStaleMissions } from './floor-selectors'

function mission(id: string, state: MissionState, extra: Partial<Mission> = {}): Mission {
  return {
    id,
    prId: `acme/x#${id}`,
    pr: {} as Mission['pr'],
    loadoutId: 'blind',
    state,
    rounds: [],
    stale: false,
    autoPost: false,
    createdAt: '2026-09-13T12:00:00Z',
    updatedAt: '2026-09-13T12:00:00Z',
    timeline: [],
    ...extra
  }
}

describe('failedMissionForSlot', () => {
  it('finds a failed mission by its slot or preferred slot', () => {
    const bySlot = mission('a', 'failed', { slotId: 'slot-1' })
    const byPreferred = mission('b', 'failed', { preferredSlotId: 'slot-2' })
    const missions = [bySlot, byPreferred, mission('c', 'reviewing', { slotId: 'slot-1' })]
    expect(failedMissionForSlot(missions, 'slot-1')).toBe(bySlot)
    expect(failedMissionForSlot(missions, 'slot-2')).toBe(byPreferred)
    expect(failedMissionForSlot(missions, 'slot-3')).toBeUndefined()
  })

  it('prefers the most recent failure', () => {
    const older = mission('a', 'failed', { slotId: 'slot-1', updatedAt: '2026-09-13T11:00:00Z' })
    const newer = mission('b', 'failed', { preferredSlotId: 'slot-1', updatedAt: '2026-09-13T12:30:00Z' })
    expect(failedMissionForSlot([older, newer], 'slot-1')).toBe(newer)
  })

  it('ignores missions in other states', () => {
    expect(failedMissionForSlot([mission('a', 'closed', { slotId: 'slot-1' })], 'slot-1')).toBeUndefined()
  })
})

describe('selectStaleMissions', () => {
  it('lists watching and needs_you missions whose push nobody has reviewed', () => {
    const watching = mission('a', 'watching', { stale: true })
    const waiting = mission('b', 'needs_you', { slotId: 'slot-1', stale: true })
    const missions = [
      watching,
      mission('c', 'watching'),
      waiting,
      mission('d', 'reviewing', { slotId: 'slot-2', stale: true }),
      mission('e', 'failed', { preferredSlotId: 'slot-1', stale: true }),
      mission('f', 'closed', { stale: true })
    ]
    expect(selectStaleMissions(missions)).toEqual([watching, waiting])
    expect(selectStaleMissions([])).toEqual([])
  })

  it('hasUnreviewedPush needs both the flag and a state that waits on the user', () => {
    expect(hasUnreviewedPush({ state: 'watching', stale: true })).toBe(true)
    expect(hasUnreviewedPush({ state: 'needs_you', stale: true })).toBe(true)
    expect(hasUnreviewedPush({ state: 'watching', stale: false })).toBe(false)
    expect(hasUnreviewedPush({ state: 'posting', stale: true })).toBe(false)
  })
})

describe('floorIsEmpty', () => {
  it('is empty with no missions or only watched/closed ones', () => {
    expect(floorIsEmpty([])).toBe(true)
    expect(floorIsEmpty([mission('a', 'watching'), mission('b', 'closed')])).toBe(true)
  })

  it('is not empty when something is queued, running, or failed at a desk', () => {
    expect(floorIsEmpty([mission('a', 'queued')])).toBe(false)
    expect(floorIsEmpty([mission('a', 'preparing', { slotId: 'slot-1' })])).toBe(false)
    expect(floorIsEmpty([mission('a', 'failed', { preferredSlotId: 'slot-1' })])).toBe(false)
  })

  it('ignores a failure that never reached a desk, since no character shows it', () => {
    expect(floorIsEmpty([mission('a', 'failed', { error: 'Cancelled' })])).toBe(true)
    expect(failedMissionForSlot([mission('a', 'failed')], 'slot-1')).toBeUndefined()
  })
})
