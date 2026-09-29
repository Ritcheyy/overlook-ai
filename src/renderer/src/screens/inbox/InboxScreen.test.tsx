// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { AppSnapshot, Mission } from '@core/domain'
import { defaultSettings } from '@core/loadouts'
import { seedPullRequests } from '@core/demo/seed'

vi.mock('@/lib/api', () => ({
  api: {
    dispatch: vi.fn(async () => ({})),
    openExternal: vi.fn(async () => {}),
    refreshInbox: vi.fn(async () => ({}))
  },
  onPush: vi.fn(() => () => {}),
  isElectron: false
}))

import { api } from '@/lib/api'
import { useAppStore } from '@/state/store'
import { InboxScreen } from './InboxScreen'

const NOW = new Date('2026-09-13T12:00:00Z')

function buildSnapshot(): AppSnapshot {
  const inbox = seedPullRequests(NOW)
  const settings = defaultSettings()
  const at = NOW.toISOString()
  const mission: Mission = {
    id: 'm-412',
    prId: inbox[0].id,
    pr: inbox[0],
    loadoutId: 'blind',
    state: 'needs_you',
    slotId: 'slot-1',
    rounds: [],
    stale: false,
    autoPost: false,
    createdAt: at,
    updatedAt: at,
    timeline: []
  }
  return {
    inbox,
    missions: [mission],
    slots: settings.slots,
    settings,
    localRepos: [],
    lastPollAt: at,
    githubLogin: 'ritchey',
    version: 'test'
  }
}

beforeEach(() => {
  useAppStore.setState({ snapshot: buildSnapshot(), loading: false, screen: 'inbox' })
  vi.mocked(api.dispatch).mockClear()
})
afterEach(cleanup)

describe('InboxScreen', () => {
  it('renders one row per pull request, grouped by repo', () => {
    render(<InboxScreen />)
    expect(screen.getAllByRole('listitem')).toHaveLength(6)
    expect(screen.getAllByRole('region').map((r) => r.getAttribute('aria-label'))).toEqual([
      'acme/checkout-api',
      'acme/mobile-app',
      'acme/notifications-service',
      'acme/storefront-web'
    ])
    const checkout = screen.getByRole('region', { name: 'acme/checkout-api' })
    expect(within(checkout).getByRole('heading', { level: 2 }).textContent).toBe('acme/checkout-api2')
    expect(within(checkout).getAllByRole('listitem')).toHaveLength(2)
    expect(screen.getByText('fix(refunds): make refund creation idempotent per order')).toBeTruthy()
    expect(screen.getByText('DRAFT')).toBeTruthy()
  })

  it('fades draft pull requests', () => {
    render(<InboxScreen />)
    const draft = screen.getByText('DRAFT').closest('li')!
    expect(draft.className).toContain('opacity-60')
    const other = screen.getByText('fix(refunds): make refund creation idempotent per order').closest('li')!
    expect(other.className).not.toContain('opacity-60')
  })

  it('shows the review state for PRs under review and a Review button otherwise', () => {
    render(<InboxScreen />)
    expect(screen.getByText('Needs you')).toBeTruthy()
    expect(screen.getAllByRole('button', { name: 'Review' })).toHaveLength(5)
  })

  it('reviews with the default type on Review without opening the details', async () => {
    render(<InboxScreen />)
    const row = screen.getByText('feat(cart): persist promo code across sessions').closest('li')!
    await act(async () => {
      fireEvent.click(within(row).getByRole('button', { name: 'Review' }))
    })
    expect(api.dispatch).toHaveBeenCalledWith({ prId: 'acme/storefront-web#1203', loadoutId: 'blind', options: undefined })
    expect(useAppStore.getState().screen).toBe('inbox')
  })

  it('counts everyone else\'s PRs as To review so the filters add up', () => {
    render(<InboxScreen />)
    const all = Number(screen.getByRole('button', { name: /^All/ }).textContent?.replace(/\D/g, ''))
    const others = Number(screen.getByRole('button', { name: /^To review/ }).textContent?.replace(/\D/g, ''))
    const mine = Number(screen.getByRole('button', { name: /^Mine/ }).textContent?.replace(/\D/g, ''))
    expect(others + mine).toBe(all)
  })

  it('filters to my own pull requests', () => {
    render(<InboxScreen />)
    fireEvent.click(screen.getByRole('button', { name: /^Mine/ }))
    expect(screen.getAllByRole('listitem')).toHaveLength(2)
  })

  it('reports a failed manual poll as a toast', async () => {
    useAppStore.setState({ snapshot: { ...buildSnapshot(), inbox: [] }, toasts: [] })
    vi.mocked(api.refreshInbox).mockRejectedValueOnce(new Error('gh: not logged in'))
    render(<InboxScreen />)
    fireEvent.click(screen.getByRole('button', { name: 'Poll GitHub now' }))
    await waitFor(() => expect(useAppStore.getState().toasts.some((t) => t.kind === 'error' && t.body === 'gh: not logged in')).toBe(true))
  })
})
