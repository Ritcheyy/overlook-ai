import { useEffect, useMemo, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import type { Activity, Mission, Slot } from '@core/domain'
import { latestRound, missionHoldsSlot } from '@core/domain'
import {
  selectActivityFor,
  selectLastActivityFor,
  selectMissionForSlot,
  selectMissionsInState,
  selectQueue,
  selectSettings,
  selectSlots,
  useAppStore,
  type AppState
} from '@/state/store'
import type { VisualState } from './animation'
import { visualStateFor } from './animation'
import { failedMissionForSlot, floorIsEmpty, selectStaleMissions } from './floor-selectors'

export interface SlotView {
  slot: Slot
  mission?: Mission
  visual: VisualState
  lastActivity?: Activity
  findingCount: number
  loadoutName?: string
}

const selectFailedForSlot = (slotId: string) => (s: AppState) => failedMissionForSlot(s.snapshot?.missions ?? [], slotId)

/** Everything the scene and the HUD need about one slot, with stable references. */
export function useSlotView(slot: Slot): SlotView {
  const missionSelector = useMemo(() => selectMissionForSlot(slot.id), [slot.id])
  const active = useAppStore(missionSelector)
  const failedSelector = useMemo(() => selectFailedForSlot(slot.id), [slot.id])
  const failed = useAppStore(failedSelector)
  const mission = active ?? failed
  const activitySelector = useMemo(() => selectLastActivityFor(mission?.id), [mission?.id])
  const lastActivity = useAppStore(activitySelector)
  const settings = useAppStore(selectSettings)
  const visual = visualStateFor(mission?.state, lastActivity?.kind)
  const round = mission ? latestRound(mission) : undefined
  const loadoutName = mission ? settings?.loadouts.find((l) => l.id === mission.loadoutId)?.name : undefined
  return useMemo(
    () => ({ slot, mission, visual, lastActivity, findingCount: round?.findings.length ?? 0, loadoutName }),
    [slot, mission, visual, lastActivity, round, loadoutName]
  )
}

export function useSlots(): Slot[] {
  return useAppStore(useShallow(selectSlots))
}

export function useQueue(): Mission[] {
  return useAppStore(useShallow(selectQueue))
}

export function useWatching(): Mission[] {
  return useAppStore(useShallow(selectMissionsInState('watching')))
}

/** Watching or waiting missions whose latest push nobody has reviewed. */
export function useNewPushCount(): number {
  return useAppStore((s) => selectStaleMissions(s.snapshot?.missions ?? []).length)
}

export function useActivityLines(missionId: string | undefined, count: number): Activity[] {
  const selector = useMemo(() => selectActivityFor(missionId), [missionId])
  const all = useAppStore(useShallow(selector))
  return useMemo(() => all.slice(-count), [all, count])
}

/** The PR the demo buttons act on: the first mission on the floor, else one being watched. */
export function useDemoTarget(): Mission | undefined {
  return useAppStore(
    useShallow((s) => {
      const missions = s.snapshot?.missions ?? []
      return missions.find((m) => missionHoldsSlot(m.state)) ?? missions.find((m) => m.state === 'watching')
    })
  )
}

export function useFloorEmpty(): boolean {
  return useAppStore((s) => floorIsEmpty(s.snapshot?.missions ?? []))
}

/** Re-renders on an interval; used for elapsed-time labels. */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])
  return now
}

/** Milliseconds since the slot last became empty; 0 while it holds a mission. */
export function useIdleSince(hasMission: boolean): number | undefined {
  const [since, setSince] = useState<number | undefined>(() => (hasMission ? undefined : Date.now()))
  useEffect(() => {
    setSince(hasMission ? undefined : Date.now())
  }, [hasMission])
  return since
}
