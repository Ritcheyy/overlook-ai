// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import type { Activity, AppSnapshot, Mission } from '@core/domain'
import { defaultSettings } from '@core/loadouts'
import { seedPullRequests } from '@core/demo/seed'

vi.mock('@/lib/api', () => ({
  api: {
    openExternal: vi.fn(async () => {}),
    openPath: vi.fn(async () => {})
  },
  onPush: vi.fn(() => () => {}),
  isElectron: false
}))

import { useAppStore } from '@/state/store'
import { FailedPane } from './panes'

const NOW = new Date('2026-09-13T12:00:00Z')
const at = NOW.toISOString()
const prs = seedPullRequests(NOW)
const settings = defaultSettings()
const ERROR = 'Claude finished without a findings payload. Its final message was: "Command completed".'

const stored: Activity[] = [
  { missionId: 'm-412', at, kind: 'reading', text: 'src/refunds/refund.service.ts' },
  { missionId: 'm-412', at, kind: 'error', text: ERROR }
]

function failedMission(): Mission {
  const pr = prs[0]
  return {
    id: 'm-412',
    prId: pr.id,
    pr,
    loadoutId: 'blind',
    state: 'failed',
    preferredSlotId: 'slot-1',
    rounds: [
      {
        id: 'r1',
        index: 1,
        headSha: pr.headSha,
        startedAt: at,
        finishedAt: at,
        findings: [],
        summary: '',
        verdict: 'comment',
        error: ERROR,
        costUsd: 1.73,
        durationMs: 277_000,
        activity: stored
      }
    ],
    stale: false,
    autoPost: false,
    error: ERROR,
    createdAt: at,
    updatedAt: at,
    timeline: [
      { at, to: 'queued' },
      { at, from: 'reviewing', to: 'failed', note: ERROR }
    ]
  }
}

const snapshot: AppSnapshot = { inbox: prs, missions: [], slots: settings.slots, settings, localRepos: [], version: 'test' }

beforeEach(() => {
  useAppStore.setState({ snapshot, loading: false, activity: {}, toasts: [] })
})
afterEach(cleanup)

describe('FailedPane', () => {
  it('falls back to the activity stored on the round and shows what the round cost', () => {
    render(<FailedPane mission={failedMission()} slot={settings.slots[0]} loadout={settings.loadouts[0]} />)
    expect(screen.getByRole('alert').textContent).toContain(ERROR)
    expect(screen.getByText('Cost $1.73 · took 4m 37s')).toBeTruthy()
    const log = screen.getByRole('log')
    expect(within(log).getByText('src/refunds/refund.service.ts')).toBeTruthy()
    expect(within(log).getByText(ERROR)).toBeTruthy()
  })

  it('prefers the live activity of this session', () => {
    useAppStore.setState({ activity: { 'm-412': [{ missionId: 'm-412', at, kind: 'thinking', text: 'Starting Claude Code' }] } })
    render(<FailedPane mission={failedMission()} slot={settings.slots[0]} loadout={settings.loadouts[0]} />)
    const log = screen.getByRole('log')
    expect(within(log).getByText('Starting Claude Code')).toBeTruthy()
    expect(within(log).queryByText('src/refunds/refund.service.ts')).toBeNull()
  })

  it('says so when neither the session nor the round has activity', () => {
    const mission = failedMission()
    delete mission.rounds[0].activity
    render(<FailedPane mission={mission} slot={settings.slots[0]} loadout={settings.loadouts[0]} />)
    expect(within(screen.getByRole('log')).getByText('No activity recorded in this session.')).toBeTruthy()
  })
})
