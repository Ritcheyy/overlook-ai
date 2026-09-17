import type { Loadout, Mission, ReviewRound, Settings, Slot } from '@core/domain'
import { elapsedSince } from '@/lib/format'

export function slotFor(mission: Mission, slots: Slot[]): Slot | undefined {
  const id = mission.slotId ?? mission.preferredSlotId
  return id ? slots.find((s) => s.id === id) : undefined
}

export function loadoutFor(mission: Mission, settings: Settings | undefined): Loadout | undefined {
  return settings?.loadouts.find((l) => l.id === mission.loadoutId)
}

export function roundElapsedMs(round: ReviewRound | undefined, now: number): number | undefined {
  if (!round) return undefined
  if (round.durationMs !== undefined) return round.durationMs
  if (round.finishedAt) return Math.max(0, new Date(round.finishedAt).getTime() - new Date(round.startedAt).getTime())
  return elapsedSince(round.startedAt, now)
}

export function blobUrl(mission: Mission, round: ReviewRound, file: string, line?: number): string {
  const path = file.replace(/^\/+/, '').split('/').map(encodeURIComponent).join('/')
  const base = `https://github.com/${mission.pr.repo.fullName}/blob/${round.headSha}/${path}`
  return line ? `${base}#L${line}` : base
}

/** `owner/name#123` -> the pull request page. */
export function relatedPrUrl(ref: string): string {
  const hash = ref.lastIndexOf('#')
  return `https://github.com/${ref.slice(0, hash)}/pull/${ref.slice(hash + 1)}`
}

/** Sum of the rounds' reported costs; undefined until any round reported one. */
export function missionCost(mission: Mission): number | undefined {
  const costs = mission.rounds.map((r) => r.costUsd).filter((c): c is number => typeof c === 'number')
  return costs.length ? costs.reduce((a, b) => a + b, 0) : undefined
}

export const byUpdatedDesc = (a: Mission, b: Mission) => b.updatedAt.localeCompare(a.updatedAt)
