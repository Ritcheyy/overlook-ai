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

/** The author answered the posted round and nobody has looked yet. */
export function hasWaitingReply(mission: Pick<Mission, 'state' | 'authorReplies'>): boolean {
  return mission.state === 'watching' && (mission.authorReplies?.length ?? 0) > 0
}

/** A push or a reply nobody has reviewed: what the floor counts as an update. */
export function hasFloorUpdate(mission: Pick<Mission, 'state' | 'stale' | 'authorReplies'>): boolean {
  return hasUnreviewedPush(mission) || hasWaitingReply(mission)
}

/** Missions the floor counts as updates. */
export function selectStaleMissions(missions: readonly Mission[]): Mission[] {
  return missions.filter(hasFloorUpdate)
}

/** Watched missions for the corkboard: updates first, so the few cards that fit show what changed, then newest activity. */
export function orderWatching(missions: readonly Mission[]): Mission[] {
  return missions
    .filter((m) => m.state === 'watching')
    .sort((a, b) => Number(hasFloorUpdate(b)) - Number(hasFloorUpdate(a)) || b.updatedAt.localeCompare(a.updatedAt))
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
