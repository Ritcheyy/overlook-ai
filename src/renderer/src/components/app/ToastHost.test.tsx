// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { AppSnapshot } from '@core/domain'
import { seedPullRequests } from '@core/demo/seed'
import { defaultSettings } from '@core/loadouts'
import { makeMission } from '@core/review/test-helpers'

vi.mock('@/lib/api', () => ({
  api: {
    dispatch: vi.fn(async ({ prId }: { prId: string }) => makeMission({ id: 'm-new', prId })),
    ignorePullRequest: vi.fn(async () => {}),
    rerunMission: vi.fn(async () => {}),
    retryMission: vi.fn(async () => {})
  },
  onPush: vi.fn(() => () => {}),
  isElectron: false
}))

import { api } from '@/lib/api'
import { useAppStore } from '@/state/store'
import { ToastHost } from './ToastHost'

const NOW = new Date('2026-09-13T12:00:00Z')
const pr = seedPullRequests(NOW)[0]

function snapshot(): AppSnapshot {
  const settings = defaultSettings()
  return { inbox: [pr], ignoredPrs: {}, missions: [], slots: settings.slots, settings, localRepos: [], version: 'test' }
}

const newPrToast = {
  kind: 'info' as const,
  title: `New PR: checkout-api #${pr.number}`,
  body: pr.title,
  prId: pr.id,
  actions: [
    { id: 'review' as const, label: 'Review now' },
    { id: 'ignore' as const, label: 'Ignore' },
    { id: 'open' as const, label: 'Open' }
  ]
}

beforeEach(() => {
  vi.clearAllMocks()
  useAppStore.setState({ snapshot: snapshot(), loading: false, screen: 'inbox', toasts: [], selectedPrId: undefined, selectedMissionId: undefined })
})
afterEach(cleanup)

describe('ToastHost', () => {
  it('shows the notification buttons except Open, and Review now starts the review and opens the PR', async () => {
    act(() => useAppStore.getState().pushToast(newPrToast))
    render(<ToastHost />)
    expect(screen.queryByRole('button', { name: 'Open' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Ignore' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Review now' }))
    await waitFor(() => expect(api.dispatch).toHaveBeenCalledWith({ prId: pr.id }))
    await waitFor(() => expect(useAppStore.getState().screen).toBe('triage'))
    expect(useAppStore.getState().selectedPrId).toBe(pr.id)
    expect(useAppStore.getState().toasts).toHaveLength(0)
  })

  it('ignores from the toast without leaving the screen, and reports a failed action', async () => {
    act(() => useAppStore.getState().pushToast(newPrToast))
    render(<ToastHost />)
    fireEvent.click(screen.getByRole('button', { name: 'Ignore' }))
    await waitFor(() => expect(api.ignorePullRequest).toHaveBeenCalledWith(pr.id))
    expect(useAppStore.getState().screen).toBe('inbox')
    expect(useAppStore.getState().toasts).toHaveLength(0)

    vi.mocked(api.retryMission).mockRejectedValueOnce(new Error('Review not found'))
    act(() => useAppStore.getState().pushToast({ kind: 'info', title: 'Review failed: #412', body: 'boom', missionId: 'm-1', actions: [{ id: 'retry', label: 'Retry' }] }))
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Retry failed'))
  })
})
