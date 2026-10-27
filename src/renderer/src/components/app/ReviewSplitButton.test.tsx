// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { AppSnapshot } from '@core/domain'
import { defaultSettings } from '@core/loadouts'
import type { ReviewStart } from './ReviewSplitButton'

vi.mock('@/lib/api', () => ({ api: {}, onPush: vi.fn(() => () => {}), isElectron: false }))

import { useAppStore } from '@/state/store'
import { ReviewSplitButton } from './ReviewSplitButton'

const settings = defaultSettings()
const snapshot: AppSnapshot = { inbox: [], ignoredPrs: {}, missions: [], slots: settings.slots, settings, localRepos: [], version: 'test' }

beforeEach(() => useAppStore.setState({ snapshot, loading: false }))
afterEach(cleanup)

async function submitWith(scopeChoice: boolean, pick?: string): Promise<ReviewStart> {
  const starts: ReviewStart[] = []
  render(<ReviewSplitButton label="Re-run" loadoutId="blind" autoPost={false} scopeChoice={scopeChoice} onStart={(s) => void starts.push(s)} />)
  fireEvent.click(screen.getByRole('button', { name: 'Review options' }))
  const scope = screen.queryByLabelText('Scope')
  if (pick) fireEvent.change(scope!, { target: { value: pick } })
  else expect(scope).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Start review' }))
  await waitFor(() => expect(starts).toHaveLength(1))
  return starts[0]
}

describe('ReviewSplitButton scope', () => {
  it('offers the scope only for follow-ups and passes the choice as a run option', async () => {
    expect((await submitWith(true, 'whole')).options).toEqual({ scope: 'whole' })
    cleanup()
    expect((await submitWith(true, 'delta')).options).toEqual({ scope: 'delta' })
    cleanup()
    expect((await submitWith(false)).options).toBeUndefined()
  })
})
