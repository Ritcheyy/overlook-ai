// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import type { AppSnapshot, Mission, MissionState } from '@core/domain'
import { defaultSettings } from '@core/loadouts'
import { seedPullRequests } from '@core/demo/seed'

vi.mock('@/lib/api', () => ({
  api: {
    cancelMission: vi.fn(async () => {})
  },
  onPush: vi.fn(() => () => {}),
  isElectron: false
}))

import { api } from '@/lib/api'
import { useAppStore } from '@/state/store'
import { FloorHud, ShelfList } from './Hud'

const NOW = new Date('2026-09-13T12:00:00Z')
const at = NOW.toISOString()
const prs = seedPullRequests(NOW)
const settings = defaultSettings()

function mission(prIndex: number, state: MissionState, extra: Partial<Mission> = {}): Mission {
  const pr = prs[prIndex]
  return {
    id: `m-${pr.number}`,
    prId: pr.id,
    pr,
    loadoutId: settings.defaultLoadoutId,
    state,
    rounds: [],
    stale: false,
    autoPost: false,
    createdAt: at,
    updatedAt: at,
    timeline: [{ at, to: 'queued' }],
    ...extra
  }
}

function snapshotWith(missions: Mission[]): AppSnapshot {
  return { inbox: prs, missions, slots: settings.slots, settings, localRepos: [], version: 'test' }
}

const loadoutName = settings.loadouts.find((l) => l.id === settings.defaultLoadoutId)!.name

beforeEach(() => {
  useAppStore.setState({ snapshot: snapshotWith([]), loading: false, screen: 'floor', selectedMissionId: undefined, selectedPrId: undefined, activity: {}, toasts: [] })
  vi.clearAllMocks()
})
afterEach(cleanup)

describe('ShelfList', () => {
  it('renders nothing while the queue is empty', () => {
    useAppStore.setState({ snapshot: snapshotWith([mission(0, 'reviewing', { slotId: 'slot-1' }), mission(1, 'watching')]) })
    const { container } = render(<ShelfList />)
    expect(container.innerHTML).toBe('')
  })

  it('lists queued reviews in scheduler order with their review type and follow-up round', () => {
    const followUp = mission(1, 'queued', {
      rounds: [{ id: 'r1', index: 1, headSha: 'abc', startedAt: at, findings: [], summary: '', verdict: 'comment' }],
      timeline: [{ at: '2026-09-13T12:05:00Z', to: 'queued' }]
    })
    useAppStore.setState({ snapshot: snapshotWith([mission(0, 'queued'), followUp]) })
    render(<ShelfList />)
    const rows = within(screen.getByRole('region', { name: 'Queued' })).getAllByRole('listitem')
    expect(rows).toHaveLength(2)
    expect(rows[0].textContent).toContain(`#${prs[1].number}`)
    expect(rows[0].textContent).toContain('round 2')
    expect(rows[1].textContent).toContain(`#${prs[0].number}`)
    expect(rows[1].textContent).toContain(loadoutName)
    expect(rows[1].textContent).not.toContain('round')
  })

  it('opens the details of the clicked review', () => {
    useAppStore.setState({ snapshot: snapshotWith([mission(0, 'queued')]) })
    render(<ShelfList />)
    fireEvent.click(screen.getByRole('button', { name: new RegExp(`^#${prs[0].number} `) }))
    expect(useAppStore.getState().screen).toBe('triage')
    expect(useAppStore.getState().selectedMissionId).toBe(`m-${prs[0].number}`)
  })

  it('cancels only after the inline confirmation', () => {
    useAppStore.setState({ snapshot: snapshotWith([mission(0, 'queued')]) })
    render(<ShelfList />)
    const cancel = screen.getByRole('button', { name: `Cancel #${prs[0].number}` })
    fireEvent.click(cancel)
    expect(api.cancelMission).not.toHaveBeenCalled()
    expect(cancel.textContent).toContain('Cancel?')
    fireEvent.click(cancel)
    expect(api.cancelMission).toHaveBeenCalledWith(`m-${prs[0].number}`)
  })
})

describe('updates', () => {
  it('counts pushes and replies in amber, tags them on the HUD card and lists watched reviews with updates first', () => {
    const reply = { url: 'https://github.com/x/y/pull/1#issuecomment-2', author: 'dami-codes', body: 'Fixed', createdAt: at }
    useAppStore.setState({
      snapshot: snapshotWith([
        mission(1, 'watching', { updatedAt: '2026-09-13T12:30:00Z' }),
        mission(0, 'watching', { stale: true }),
        mission(3, 'watching', { authorReplies: [reply] }),
        mission(2, 'needs_you', { slotId: 'slot-1', stale: true })
      ])
    })
    const { container } = render(<FloorHud variant="static" />)
    const counter = screen.getAllByText('updates').find((el) => el.textContent === '3 updates')!
    expect(counter.className).toContain('text-amber')
    expect(container.textContent).toContain('3 watching')
    const rows = within(screen.getByRole('region', { name: 'Watching' })).getAllByRole('listitem')
    expect(rows).toHaveLength(3)
    expect(within(rows[0]).queryByText('new push') ?? within(rows[0]).queryByText('replied')).toBeTruthy()
    expect(within(rows[1]).queryByText('new push') ?? within(rows[1]).queryByText('replied')).toBeTruthy()
    expect(rows[2].textContent).toContain(`#${prs[1].number}`)
    expect(within(container.querySelector('[data-slot="slot-1"]')!).getByText('new push')).toBeTruthy()
    expect(within(container.querySelector('[data-slot="slot-2"]')!).queryByText('new push')).toBeNull()
    fireEvent.click(within(rows[2]).getByRole('button'))
    expect(useAppStore.getState().screen).toBe('triage')
    expect(useAppStore.getState().selectedMissionId).toBe(`m-${prs[1].number}`)
  })

  it('reads zero in muted when nothing changed and leaves the watched list to the 3D scene', () => {
    useAppStore.setState({ snapshot: snapshotWith([mission(1, 'watching')]) })
    render(<FloorHud variant="overlay" />)
    const counter = screen.getAllByText('updates').find((el) => el.textContent === '0 updates')!
    expect(counter.className).toContain('text-muted')
    expect(screen.queryByRole('region', { name: 'Watching' })).toBeNull()
  })

  it('says what a waiting review needs instead of an empty activity log, and prints a failure once', () => {
    useAppStore.setState({
      snapshot: snapshotWith([
        mission(0, 'needs_you', { slotId: 'slot-1', rounds: [{ id: 'r1', index: 1, headSha: 'abc', startedAt: at, finishedAt: at, findings: [], summary: '', verdict: 'comment' }] }),
        mission(1, 'failed', { preferredSlotId: 'slot-2', error: 'git fetch failed' })
      ]),
      activity: { [`m-${prs[1].number}`]: [{ missionId: `m-${prs[1].number}`, at, kind: 'error', text: 'git fetch failed' }] }
    })
    const { container } = render(<FloorHud variant="static" />)
    const waiting = container.querySelector('[data-slot="slot-1"]')!
    expect(waiting.textContent).toContain('No findings; the summary is ready to post.')
    expect(waiting.textContent).not.toContain('waiting for activity')
    const failed = container.querySelector('[data-slot="slot-2"]')!
    expect(within(failed as HTMLElement).getAllByText('git fetch failed')).toHaveLength(1)
  })
})

describe('FloorHud', () => {
  it('shows the queue in both the overlay and the static layout', () => {
    useAppStore.setState({ snapshot: snapshotWith([mission(0, 'queued')]) })
    const overlay = render(<FloorHud variant="overlay" />)
    expect(within(overlay.container).getByRole('region', { name: 'Queued' })).toBeTruthy()
    cleanup()
    const fallback = render(<FloorHud variant="static" />)
    expect(within(fallback.container).getByRole('region', { name: 'Queued' })).toBeTruthy()
    expect(fallback.container.textContent).toContain('1 queued')
  })
})
