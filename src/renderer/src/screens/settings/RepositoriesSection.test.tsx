// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import type { AppSnapshot, Settings, Workspace } from '@core/domain'
import { defaultSettings } from '@core/loadouts'
import { seedPullRequests } from '@core/demo/seed'

vi.mock('@/lib/api', () => ({
  api: {
    discoverRepos: vi.fn(async () => []),
    openPath: vi.fn(async () => {}),
    updateSettings: vi.fn(async () => ({}))
  },
  onPush: vi.fn(() => () => {}),
  isElectron: false
}))

import { useAppStore } from '@/state/store'
import { RepositoriesSection } from './RepositoriesSection'

const NOW = new Date('2026-09-13T12:00:00Z')

function buildSnapshot(settings: Settings): AppSnapshot {
  return {
    inbox: seedPullRequests(NOW),
    missions: [],
    slots: settings.slots,
    settings,
    localRepos: [
      { fullName: 'acme/checkout-api', path: '/Users/demo/Projects/checkout-api', defaultBranch: 'main' },
      { fullName: 'acme/legacy', path: '/Users/demo/Projects/legacy', defaultBranch: 'master' }
    ],
    githubLogin: 'ritchey',
    version: 'test'
  }
}

function renderSection(overrides: Partial<Settings> = {}) {
  const settings = defaultSettings(overrides)
  useAppStore.setState({ snapshot: buildSnapshot(settings), loading: false, screen: 'settings' })
  const save = vi.fn(async () => {})
  render(<RepositoriesSection settings={settings} save={save} />)
  return { save }
}

const table = () => screen.getByRole('table')

beforeEach(() => useAppStore.setState({ toasts: [] }))
afterEach(cleanup)

describe('RepositoriesSection', () => {
  it('lists local checkouts and inbox repos once each, sorted, with a switch per row', () => {
    renderSection({ inactiveRepos: ['acme/legacy', 'acme/mobile-app'] })
    const rows = within(table()).getAllByRole('switch')
    expect(rows.map((r) => r.getAttribute('aria-label'))).toEqual([
      'acme/checkout-api active',
      'acme/legacy active',
      'acme/mobile-app active',
      'acme/notifications-service active',
      'acme/storefront-web active'
    ])
    expect(rows.map((r) => r.getAttribute('aria-checked'))).toEqual(['true', 'false', 'false', 'true', 'true'])
    expect(screen.getByTestId('active-repos-caption').textContent).toBe('3 of 5 active')
    expect(screen.getAllByText('not found locally')).toHaveLength(3)
    expect(screen.getByRole('button', { name: 'Reveal acme/legacy in Finder' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Reveal acme/mobile-app in Finder' })).toBeNull()
  })

  it('saves the opt-out list when a switch is flipped either way', () => {
    const { save } = renderSection({ inactiveRepos: ['acme/legacy'] })
    fireEvent.click(screen.getByRole('switch', { name: 'acme/storefront-web active' }))
    expect(save).toHaveBeenLastCalledWith({ inactiveRepos: ['acme/legacy', 'acme/storefront-web'] })
    fireEvent.click(screen.getByRole('switch', { name: 'acme/legacy active' }))
    expect(save).toHaveBeenLastCalledWith({ inactiveRepos: [] })
  })

  it('turns every listed repo off or on in one save, leaving unlisted repos alone', () => {
    const { save } = renderSection({ inactiveRepos: ['other/hidden'] })
    fireEvent.click(screen.getByRole('button', { name: 'Turn all off' }))
    expect(save).toHaveBeenLastCalledWith({
      inactiveRepos: ['other/hidden', 'acme/checkout-api', 'acme/legacy', 'acme/mobile-app', 'acme/notifications-service', 'acme/storefront-web']
    })
    expect(screen.getByRole('button', { name: 'Turn all on' })).toHaveProperty('disabled', true)

    cleanup()
    const second = renderSection({ inactiveRepos: ['other/hidden', 'acme/checkout-api', 'acme/legacy'] })
    fireEvent.click(screen.getByRole('button', { name: 'Turn all on' }))
    expect(second.save).toHaveBeenLastCalledWith({ inactiveRepos: ['other/hidden'] })
  })
})

const ACME: Workspace = {
  id: 'ws-acme',
  name: 'acme',
  rootPath: '/Users/demo/Projects/acme',
  repos: ['acme/checkout-api', 'acme/storefront-web'],
  enabled: false,
  source: 'detected',
  includeNotes: true
}
const MINE: Workspace = { id: 'ws-mine', name: 'Mine', repos: ['acme/legacy'], enabled: true, source: 'manual', includeNotes: false }

describe('RepositoriesSection workspaces', () => {
  it('shows a card per workspace and saves the enabled and notes switches', () => {
    const { save } = renderSection({ workspaces: [ACME, MINE] })
    const acme = screen.getByRole('group', { name: 'Workspace acme' })
    expect(within(acme).getByText('detected')).toBeTruthy()
    expect(within(acme).getByText('/Users/demo/Projects/acme')).toBeTruthy()
    expect(within(acme).getByText('acme/storefront-web')).toBeTruthy()
    expect(within(acme).getByText('Detected because the folder holds several repos; turn on if they ship together.')).toBeTruthy()
    expect(within(acme).queryByRole('button', { name: /Delete workspace/ })).toBeNull()

    const enabled = screen.getByRole('switch', { name: 'acme enabled' })
    expect(enabled.getAttribute('aria-checked')).toBe('false')
    fireEvent.click(enabled)
    expect(save).toHaveBeenLastCalledWith({ workspaces: [{ ...ACME, enabled: true }, MINE] })
    const notes = screen.getByRole('switch', { name: 'Share acme notes with reviews' })
    expect(notes.getAttribute('aria-checked')).toBe('true')
    fireEvent.click(notes)
    expect(save).toHaveBeenLastCalledWith({ workspaces: [{ ...ACME, includeNotes: false }, MINE] })

    const mine = screen.getByRole('group', { name: 'Workspace Mine' })
    expect(within(mine).getByText('manual')).toBeTruthy()
    expect(within(mine).getByRole('switch', { name: 'Mine enabled' }).getAttribute('aria-checked')).toBe('true')
    expect(within(mine).queryByRole('switch', { name: /notes/ })).toBeNull()
    expect(within(mine).queryByText('Detected because the folder holds several repos; turn on if they ship together.')).toBeNull()
  })

  it('creates, renames, edits the repos of and deletes a manual workspace', () => {
    const { save } = renderSection({ workspaces: [MINE] })
    fireEvent.click(screen.getByRole('button', { name: 'New workspace' }))
    expect(save).toHaveBeenLastCalledWith({
      workspaces: [MINE, { id: 'ws-workspace', name: 'New workspace', repos: [], enabled: true, source: 'manual', includeNotes: false }]
    })

    fireEvent.click(screen.getByRole('button', { name: 'Edit repos' }))
    const list = screen.getByRole('list', { name: 'Repos in Mine' })
    expect(within(list).getAllByRole('checkbox').map((c) => (c as HTMLInputElement).checked)).toEqual([false, true])
    fireEvent.click(within(list).getByLabelText('acme/checkout-api'))
    expect(save).toHaveBeenLastCalledWith({ workspaces: [{ ...MINE, repos: ['acme/legacy', 'acme/checkout-api'] }] })
    fireEvent.click(within(list).getByLabelText('acme/legacy'))
    expect(save).toHaveBeenLastCalledWith({ workspaces: [{ ...MINE, repos: [] }] })

    const name = screen.getByRole('textbox', { name: 'Workspace name' })
    fireEvent.change(name, { target: { value: 'Apps' } })
    fireEvent.blur(name)
    expect(save).toHaveBeenLastCalledWith({ workspaces: [{ ...MINE, name: 'Apps' }] })

    fireEvent.click(screen.getByRole('button', { name: 'Delete workspace Mine' }))
    expect(save).toHaveBeenLastCalledWith({ workspaces: [] })
  })

  it('says so when there are no workspaces', () => {
    renderSection()
    expect(screen.getByText(/None yet\. A scan finds folders/)).toBeTruthy()
  })
})
