// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { AppSnapshot, PendingNotification } from '@core/domain'
import { seedPullRequests } from '@core/demo/seed'
import { defaultSettings } from '@core/loadouts'
import { makeMission } from '@core/review/test-helpers'

vi.mock('@/lib/api', () => ({
  api: {
    dispatch: vi.fn(async ({ prId }: { prId: string }) => makeMission({ id: 'm-new', prId })),
    ignorePullRequest: vi.fn(async () => {}),
    rerunMission: vi.fn(async () => {}),
    retryMission: vi.fn(async () => {}),
    dismissNotification: vi.fn(async () => {})
  },
  onPush: vi.fn(() => () => {}),
  isElectron: false
}))

import { api } from '@/lib/api'
import { useAppStore } from '@/state/store'
import { ToastHost } from './ToastHost'

const NOW = new Date('2026-09-13T12:00:00Z')
const pr = seedPullRequests(NOW)[0]

const newPr: PendingNotification = {
  id: 'n-1',
  at: NOW.toISOString(),
  title: `New PR: checkout-api #${pr.number}`,
  body: pr.title,
  prId: pr.id,
  actions: [
    { id: 'review', label: 'Review now' },
    { id: 'ignore', label: 'Ignore' },
    { id: 'open', label: 'Open' }
  ]
}

function snapshot(notifications: PendingNotification[]): AppSnapshot {
  const settings = defaultSettings()
  return { inbox: [pr], ignoredPrs: {}, notifications, missions: [], slots: settings.slots, settings, localRepos: [], version: 'test' }
}

function show(notifications: PendingNotification[]) {
  useAppStore.setState({ snapshot: snapshot(notifications), loading: false, screen: 'inbox', toasts: [], selectedPrId: undefined, selectedMissionId: undefined })
}

beforeEach(() => vi.clearAllMocks())
afterEach(cleanup)

describe('ToastHost', () => {
  it('shows a pending notification with its buttons except Open; Review now starts the review, opens the PR and dismisses it', async () => {
    show([newPr])
    render(<ToastHost />)
    expect(screen.queryByRole('button', { name: 'Open' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Ignore' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Review now' }))
    await waitFor(() => expect(api.dispatch).toHaveBeenCalledWith({ prId: pr.id }))
    await waitFor(() => expect(useAppStore.getState().screen).toBe('triage'))
    expect(useAppStore.getState().selectedPrId).toBe(pr.id)
    expect(api.dismissNotification).toHaveBeenCalledWith('n-1')
  })

  it('ignores without leaving the screen, dismisses on the X, and reports a failed action as a toast', async () => {
    show([newPr, { id: 'n-2', at: NOW.toISOString(), title: 'Review failed: #412', body: 'boom', missionId: 'm-1', actions: [{ id: 'retry', label: 'Retry' }] }])
    render(<ToastHost />)
    fireEvent.click(screen.getByRole('button', { name: 'Ignore' }))
    await waitFor(() => expect(api.ignorePullRequest).toHaveBeenCalledWith(pr.id))
    expect(useAppStore.getState().screen).toBe('inbox')

    fireEvent.click(screen.getAllByRole('button', { name: 'Dismiss notification' })[1])
    expect(api.dismissNotification).toHaveBeenCalledWith('n-2')

    vi.mocked(api.retryMission).mockRejectedValueOnce(new Error('Review not found'))
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Retry failed'))
  })

  it('keeps the newest four on screen and counts the rest', () => {
    const many = Array.from({ length: 6 }, (_, i) => ({ ...newPr, id: `n-${i}`, title: `Notice ${i}` }))
    show(many)
    render(<ToastHost />)
    expect(screen.getAllByRole('status')).toHaveLength(4)
    expect(screen.getByText('Notice 5')).toBeTruthy()
    expect(screen.queryByText('Notice 1')).toBeNull()
    expect(screen.getByText('2 more waiting')).toBeTruthy()
    act(() => useAppStore.setState({ snapshot: snapshot([]) }))
    expect(screen.queryAllByRole('status')).toHaveLength(0)
  })
})
