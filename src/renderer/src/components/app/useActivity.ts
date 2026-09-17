import type { Activity } from '@core/domain'
import { useAppStore } from '@/state/store'

const EMPTY: Activity[] = []

/**
 * Live activity for a mission. `fallback` (a round's stored tail) stands in
 * once a restart has emptied the in-memory list. Stable references, so
 * selectors never loop.
 */
export function useActivityFor(missionId?: string, fallback?: Activity[]): Activity[] {
  const live = useAppStore((s) => (missionId ? s.activity[missionId] : undefined))
  return live?.length ? live : (fallback ?? EMPTY)
}
