import { describe, expect, it, vi } from 'vitest'
import type { AppSnapshot, Mission, MissionEvent } from '@core/domain'
import { defaultSettings } from '@core/loadouts'
import { seedPullRequests } from '@core/demo/seed'

vi.mock('@/lib/api', () => ({ api: {}, onPush: vi.fn(() => () => {}), isElectron: false }))

import { selectActivityFor, selectInbox, selectMissions, selectMissionsInState, selectQueue, selectSlots, useAppStore } from './store'

const prs = seedPullRequests(new Date('2026-09-13T12:00:00Z'))
const settings = defaultSettings()

function mission(id: string, prIndex: number, state: Mission['state'], createdAt: string, timeline: MissionEvent[], rounds = 0): Mission {
  const pr = prs[prIndex]
  return {
    id,
    prId: pr.id,
    pr,
    loadoutId: 'blind',
    state,
    rounds: Array.from({ length: rounds }, (_, i) => ({ id: `${id}-r${i}`, index: i + 1, headSha: pr.headSha, startedAt: createdAt, findings: [], summary: '', verdict: 'comment' as const })),
    stale: false,
    autoPost: false,
    createdAt,
    updatedAt: createdAt,
    timeline
  }
}

const snapshot: AppSnapshot = {
  inbox: prs,
  missions: [
    mission('first', 0, 'queued', '2026-09-13T12:00:00Z', [{ at: '2026-09-13T12:00:00Z', to: 'queued' }]),
    // Created earlier than 'first' but re-queued later (a retry), so it goes after it.
    mission('second', 1, 'queued', '2026-09-13T11:30:00Z', [
      { at: '2026-09-13T11:30:00Z', to: 'queued' },
      { at: '2026-09-13T11:31:00Z', from: 'queued', to: 'failed' },
      { at: '2026-09-13T12:01:00Z', from: 'failed', to: 'queued', note: 'retry' }
    ]),
    mission('follow-up', 2, 'queued', '2026-09-13T11:00:00Z', [
      { at: '2026-09-13T11:00:00Z', to: 'queued' },
      { at: '2026-09-13T11:20:00Z', from: 'posting', to: 'watching' },
      { at: '2026-09-13T12:05:00Z', from: 'watching', to: 'queued', note: 'new push' }
    ], 1),
    mission('watched', 3, 'watching', '2026-09-13T10:00:00Z', [{ at: '2026-09-13T10:00:00Z', to: 'queued' }], 1)
  ],
  slots: settings.slots,
  settings,
  localRepos: [],
  version: 'test'
}

describe('store selectors', () => {
  it('returns stable empty references without a snapshot or activity', () => {
    useAppStore.setState({ snapshot: null, activity: {} })
    const s = useAppStore.getState()
    expect(selectSlots(s)).toBe(selectSlots(s))
    expect(selectMissions(s)).toBe(selectMissions(s))
    expect(selectInbox(s)).toBe(selectInbox(s))
    expect(selectQueue(s)).toBe(selectQueue(s))
    expect(selectMissionsInState('watching')(s)).toBe(selectMissionsInState('watching')(s))
    expect(selectActivityFor('m-1')(s)).toBe(selectActivityFor('m-2')(s))
    expect(selectActivityFor(undefined)(s)).toBe(selectActivityFor('m-1')(s))
  })

  it('memoises derived lists per snapshot and orders the queue like the scheduler', () => {
    useAppStore.setState({ snapshot, activity: {} })
    const s = useAppStore.getState()
    const queue = selectQueue(s)
    expect(selectQueue(s)).toBe(queue)
    expect(queue.map((m) => m.id)).toEqual(['follow-up', 'first', 'second'])
    const watching = selectMissionsInState('watching')(s)
    expect(selectMissionsInState('watching')(s)).toBe(watching)
    expect(watching.map((m) => m.id)).toEqual(['watched'])
    expect(selectMissionsInState('queued', 'watching')(s)).toHaveLength(4)

    useAppStore.setState({ snapshot: structuredClone(snapshot) })
    expect(selectQueue(useAppStore.getState())).not.toBe(queue)
    expect(selectQueue(useAppStore.getState()).map((m) => m.id)).toEqual(queue.map((m) => m.id))
  })

  it('keeps the selected mission when navigating without one', () => {
    useAppStore.setState({ screen: 'floor', selectedMissionId: 'first' })
    useAppStore.getState().navigate('log')
    expect(useAppStore.getState()).toMatchObject({ screen: 'log', selectedMissionId: 'first' })
    useAppStore.getState().navigate('triage', { missionId: 'second' })
    expect(useAppStore.getState().selectedMissionId).toBe('second')
  })
})
