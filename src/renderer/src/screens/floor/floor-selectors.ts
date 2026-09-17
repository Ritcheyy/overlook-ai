import type { Mission } from '@core/domain'
import { missionHoldsSlot } from '@core/domain'

/**
 * A failed mission no longer holds its slot, but the floor still shows it on
 * the character that last worked it until the user retries or closes it.
 */
export function failedMissionForSlot(missions: readonly Mission[], slotId: string): Mission | undefined {
  let best: Mission | undefined
  for (const m of missions) {
    if (m.state !== 'failed') continue
    if (m.slotId !== slotId && m.preferredSlotId !== slotId) continue
    if (!best || m.updatedAt > best.updatedAt) best = m
  }
  return best
}

/** A push nobody has looked at: it landed while the mission waited for the user, or watched with follow-ups paused. */
export function hasUnreviewedPush(mission: Pick<Mission, 'state' | 'stale'>): boolean {
  return mission.stale && (mission.state === 'watching' || mission.state === 'needs_you')
}

/** Missions the floor tags with "new push". */
export function selectStaleMissions(missions: readonly Mission[]): Mission[] {
  return missions.filter(hasUnreviewedPush)
}

/**
 * True when nobody is working, nothing waits, and no character shows a
 * failure. A mission cancelled while still queued fails without ever having
 * sat at a desk, so it is not visible on the floor and does not count.
 */
export function floorIsEmpty(missions: readonly Mission[]): boolean {
  return !missions.some(
    (m) => m.state === 'queued' || missionHoldsSlot(m.state) || (m.state === 'failed' && !!(m.slotId || m.preferredSlotId))
  )
}
