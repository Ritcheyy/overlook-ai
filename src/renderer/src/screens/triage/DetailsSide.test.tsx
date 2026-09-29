// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import type { Mission, ReviewRound } from '@core/domain'
import { defaultSettings } from '@core/loadouts'
import { makeMission, makePr, makeRound } from '@core/review/test-helpers'

vi.mock('@/lib/api', () => ({
  api: { openPath: vi.fn(async () => {}) },
  onPush: vi.fn(() => () => {}),
  isElectron: false
}))

import { DetailsSide } from './DetailsSide'

afterEach(cleanup)

const settings = defaultSettings({ claudeModel: 'opus', claudeEffort: 'max' })
const first = makeRound({ id: 'r1', index: 1, model: 'claude-opus-5', effort: 'max' })
const second = makeRound({ id: 'r2', index: 2, model: 'claude-opus-5-5', effort: 'high' })

function modelFact(mission: Mission, round?: ReviewRound): string | null | undefined {
  render(<DetailsSide pr={makePr()} mission={mission} round={round} settings={settings} slots={settings.slots} now={Date.parse('2026-09-13T12:00:00Z')} />)
  return screen.queryByText('Model')?.nextElementSibling?.textContent
}

describe('DetailsSide model fact', () => {
  it('names the model and effort of the round the tabs show, and which round when it is not the latest', () => {
    const mission = makeMission({ rounds: [first, second] })
    expect(modelFact(mission, second)).toBe('claude-opus-5-5 · effort high')
    cleanup()
    expect(modelFact(mission, first)).toBe('claude-opus-5 · effort max · round 1')
  })

  it('shows what the first run will ask for before there is a round', () => {
    expect(modelFact(makeMission({ rounds: [], runOptions: { model: 'sonnet' } }))).toBe('sonnet · effort max')
    cleanup()
    expect(modelFact(makeMission({ rounds: [], runOptions: { model: '', effort: '' } }))).toBe('default · effort default')
  })

  it('leaves the fact out for a round saved before models were recorded', () => {
    expect(modelFact(makeMission({ rounds: [makeRound()] }), makeRound())).toBeUndefined()
  })
})
