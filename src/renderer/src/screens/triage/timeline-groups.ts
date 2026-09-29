import type { Mission, MissionEvent } from '@core/domain'

export interface HistoryGroup {
  key: string
  label: string
  /** Why this attempt was queued: the rerun, retry or reply note. */
  reason?: string
  events: MissionEvent[]
}

/**
 * The timeline split into attempts: each starts where the review was queued,
 * and takes the name of the round it produced. Notes recorded while watching
 * (pushes, replies) stay with the round they followed.
 */
export function groupTimeline(mission: Pick<Mission, 'timeline' | 'rounds'>): HistoryGroup[] {
  const groups: HistoryGroup[] = []
  for (const event of mission.timeline) {
    if (event.to === 'queued' || groups.length === 0) {
      groups.push({ key: `${event.at}-${groups.length}`, label: '', reason: event.note, events: [event] })
    } else {
      groups[groups.length - 1].events.push(event)
    }
  }
  groups.forEach((group, i) => {
    const start = group.events[0].at
    const end = groups[i + 1]?.events[0].at
    const round = mission.rounds.find((r) => r.startedAt >= start && (end === undefined || r.startedAt < end))
    if (round) group.label = `Round ${round.index}`
    else if (group.events.some((e) => e.to === 'failed')) group.label = 'Failed before reviewing'
    else if (group.events.some((e) => e.to === 'closed')) group.label = 'Closed'
    else group.label = 'Waiting'
  })
  return groups
}
