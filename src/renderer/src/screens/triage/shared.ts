import type { Loadout, Mission, Settings, Slot } from '@core/domain'

export function slotFor(mission: Mission, slots: Slot[]): Slot | undefined {
  const id = mission.slotId ?? mission.preferredSlotId
  return id ? slots.find((s) => s.id === id) : undefined
}

export function loadoutFor(mission: Mission, settings: Settings | undefined): Loadout | undefined {
  return settings?.loadouts.find((l) => l.id === mission.loadoutId)
}

/** Sum of the rounds' reported costs; undefined until any round reported one. */
export function missionCost(mission: Mission): number | undefined {
  const costs = mission.rounds.map((r) => r.costUsd).filter((c): c is number => typeof c === 'number')
  return costs.length ? costs.reduce((a, b) => a + b, 0) : undefined
}

