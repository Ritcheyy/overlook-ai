// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { AppSnapshot, Settings } from '@core/domain'
import { defaultSettings } from '@core/loadouts'
import { seedPullRequests } from '@core/demo/seed'

vi.mock('@/lib/api', () => ({
  api: {
    updateSettings: vi.fn(async (patch: object) => patch),
    discoverRepos: vi.fn(async () => []),
    openPath: vi.fn(async () => {}),
    checkEnvironment: vi.fn(async () => ({ checkedAt: '', ok: true, items: [] })),
    relaunch: vi.fn(async () => {})
  },
  onPush: vi.fn(() => () => {}),
  isElectron: false
}))

import { api } from '@/lib/api'
import { useAppStore } from '@/state/store'
import { SettingsScreen } from './SettingsScreen'

const NOW = new Date('2026-09-13T12:00:00Z')

function snapshotWith(settings: Settings): AppSnapshot {
  return { inbox: seedPullRequests(NOW), missions: [], slots: settings.slots, settings, localRepos: [], githubLogin: 'ritchey', version: 'test' }
}

function renderSettings(overrides: Partial<Settings> = {}) {
  useAppStore.setState({ snapshot: snapshotWith(defaultSettings(overrides)), loading: false, screen: 'settings', toasts: [] })
  render(<SettingsScreen />)
}

/** Mirrors the engine pushing the saved settings back. */
function settingsArrive(overrides: Partial<Settings>) {
  act(() => useAppStore.setState({ snapshot: snapshotWith(defaultSettings(overrides)) }))
}

const modelSelect = () => screen.getByLabelText('Model') as HTMLSelectElement
const fallbackSelect = () => screen.getByLabelText('Fallback model') as HTMLSelectElement
const customInput = () => screen.queryByLabelText('Custom model id') as HTMLInputElement | null

beforeEach(() => vi.clearAllMocks())
afterEach(cleanup)

describe('SettingsScreen Claude section', () => {
  it('offers the model aliases and shows Custom with the id for anything else', () => {
    renderSettings({ claudeModel: 'claude-fable-5' })
    expect(Array.from(modelSelect().options).map((o) => [o.value, o.label])).toEqual([
      ['', 'CLI default'],
      ['fable', 'Fable (latest)'],
      ['opus', 'Opus (latest)'],
      ['sonnet', 'Sonnet (latest)'],
      ['custom', 'Custom model id…']
    ])
    expect(modelSelect().value).toBe('custom')
    expect(customInput()?.value).toBe('claude-fable-5')
    expect(screen.getByText('Aliases resolve to the latest model of that family on your account.')).toBeTruthy()
  })

  it('shows the saved alias without the id field', () => {
    renderSettings()
    expect(modelSelect().value).toBe('opus')
    expect(customInput()).toBeNull()
  })

  it('saves an alias and drops the id field once the setting comes back', () => {
    renderSettings({ claudeModel: 'claude-fable-5' })
    fireEvent.change(modelSelect(), { target: { value: 'opus' } })
    expect(api.updateSettings).toHaveBeenLastCalledWith({ claudeModel: 'opus' })
    settingsArrive({ claudeModel: 'opus' })
    expect(modelSelect().value).toBe('opus')
    expect(customInput()).toBeNull()
    fireEvent.change(modelSelect(), { target: { value: '' } })
    expect(api.updateSettings).toHaveBeenLastCalledWith({ claudeModel: '' })
  })

  it('reveals an empty id field for Custom and saves the trimmed id on blur', () => {
    renderSettings()
    fireEvent.change(modelSelect(), { target: { value: 'custom' } })
    expect(api.updateSettings).not.toHaveBeenCalled()
    expect(modelSelect().value).toBe('custom')
    const input = customInput()!
    expect(input.value).toBe('')
    fireEvent.change(input, { target: { value: '  claude-opus-4-1 ' } })
    fireEvent.blur(input)
    expect(api.updateSettings).toHaveBeenLastCalledWith({ claudeModel: 'claude-opus-4-1' })
  })

  it('treats a cleared custom id as the CLI default', () => {
    renderSettings({ claudeModel: 'claude-fable-5' })
    const input = customInput()!
    fireEvent.change(input, { target: { value: '' } })
    fireEvent.blur(input)
    expect(api.updateSettings).toHaveBeenLastCalledWith({ claudeModel: '' })
    settingsArrive({ claudeModel: '' })
    expect(modelSelect().value).toBe('')
    expect(customInput()).toBeNull()
  })

  it('offers None plus the aliases as the fallback model and saves it', () => {
    renderSettings()
    expect(Array.from(fallbackSelect().options).map((o) => [o.value, o.label])).toEqual([
      ['', 'None'],
      ['fable', 'Fable (latest)'],
      ['opus', 'Opus (latest)'],
      ['sonnet', 'Sonnet (latest)']
    ])
    expect(fallbackSelect().value).toBe('')
    expect(screen.getByText('Used automatically when the main model is overloaded or at its usage limit.')).toBeTruthy()
    fireEvent.change(fallbackSelect(), { target: { value: 'sonnet' } })
    expect(api.updateSettings).toHaveBeenLastCalledWith({ claudeFallbackModel: 'sonnet' })
    settingsArrive({ claudeFallbackModel: 'sonnet' })
    expect(fallbackSelect().value).toBe('sonnet')
    fireEvent.change(fallbackSelect(), { target: { value: '' } })
    expect(api.updateSettings).toHaveBeenLastCalledWith({ claudeFallbackModel: undefined })
  })

  it('lists a hand-edited fallback id so the select does not read None over it', () => {
    renderSettings({ claudeFallbackModel: 'claude-sonnet-5' })
    expect(fallbackSelect().value).toBe('claude-sonnet-5')
  })
})
