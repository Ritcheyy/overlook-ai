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
  useAppStore.setState({ snapshot: snapshotWith([]), loading: false, screen: 'floor', selectedMissionId: undefined, toasts: [] })
  vi.clearAllMocks()
})
afterEach(cleanup)

describe('ShelfList', () => {
  it('renders nothing while the queue is empty', () => {
    useAppStore.setState({ snapshot: snapshotWith([mission(0, 'reviewing', { slotId: 'slot-1' }), mission(1, 'watching')]) })
    const { container } = render(<ShelfList />)
    expect(container.innerHTML).toBe('')
  })

  it('lists queued missions in scheduler order with their loadout and follow-up round', () => {
    const followUp = mission(1, 'queued', {
      rounds: [{ id: 'r1', index: 1, headSha: 'abc', startedAt: at, findings: [], summary: '', verdict: 'comment' }],
      timeline: [{ at: '2026-09-13T12:05:00Z', to: 'queued' }]
    })
    useAppStore.setState({ snapshot: snapshotWith([mission(0, 'queued'), followUp]) })
    render(<ShelfList />)
    const rows = within(screen.getByRole('region', { name: 'Shelf' })).getAllByRole('listitem')
    expect(rows).toHaveLength(2)
    expect(rows[0].textContent).toContain(`#${prs[1].number}`)
    expect(rows[0].textContent).toContain('round 2')
    expect(rows[1].textContent).toContain(`#${prs[0].number}`)
    expect(rows[1].textContent).toContain(loadoutName)
    expect(rows[1].textContent).not.toContain('round')
  })

  it('opens triage for the clicked mission', () => {
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

describe('new pushes', () => {
  it('counts unreviewed pushes in amber, tags them on the HUD card and lists watched missions in the static layout', () => {
    useAppStore.setState({
      snapshot: snapshotWith([mission(0, 'watching', { stale: true }), mission(1, 'watching'), mission(2, 'needs_you', { slotId: 'slot-1', stale: true })])
    })
    const { container } = render(<FloorHud variant="static" />)
    const counter = screen.getAllByText('new push').find((el) => el.textContent === '2 new push')!
    expect(counter.className).toContain('text-amber')
    expect(container.textContent).toContain('2 watching')
    const rows = within(screen.getByRole('region', { name: 'Corkboard' })).getAllByRole('listitem')
    expect(rows).toHaveLength(2)
    expect(rows[0].textContent).toContain(`#${prs[0].number}`)
    expect(within(rows[0]).getByText('new push')).toBeTruthy()
    expect(within(rows[1]).queryByText('new push')).toBeNull()
    expect(within(container.querySelector('[data-slot="slot-1"]')!).getByText('new push')).toBeTruthy()
    expect(within(container.querySelector('[data-slot="slot-2"]')!).queryByText('new push')).toBeNull()
    fireEvent.click(within(rows[0]).getByRole('button'))
    expect(useAppStore.getState().screen).toBe('triage')
    expect(useAppStore.getState().selectedMissionId).toBe(`m-${prs[0].number}`)
  })

  it('reads zero in muted when nothing new was pushed and leaves the corkboard list to the 3D scene', () => {
    useAppStore.setState({ snapshot: snapshotWith([mission(1, 'watching')]) })
    render(<FloorHud variant="overlay" />)
    const counter = screen.getAllByText('new push').find((el) => el.textContent === '0 new push')!
    expect(counter.className).toContain('text-muted')
    expect(screen.queryByRole('region', { name: 'Corkboard' })).toBeNull()
  })
})

describe('FloorHud', () => {
  it('shows the shelf in both the overlay and the static layout', () => {
    useAppStore.setState({ snapshot: snapshotWith([mission(0, 'queued')]) })
    const overlay = render(<FloorHud variant="overlay" />)
    expect(within(overlay.container).getByRole('region', { name: 'Shelf' })).toBeTruthy()
    cleanup()
    const fallback = render(<FloorHud variant="static" />)
    expect(within(fallback.container).getByRole('region', { name: 'Shelf' })).toBeTruthy()
    expect(fallback.container.textContent).toContain('1 queued')
  })
})
