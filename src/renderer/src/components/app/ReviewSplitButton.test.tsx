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

async function submitWith(scopeChoice: boolean, whole?: boolean): Promise<ReviewStart> {
  const starts: ReviewStart[] = []
  render(<ReviewSplitButton label="Re-run" loadoutId="blind" autoPost={false} scopeChoice={scopeChoice} onStart={(s) => void starts.push(s)} />)
  fireEvent.click(screen.getByRole('button', { name: 'Review options' }))
  const box = screen.queryByLabelText('Read the whole PR')
  if (scopeChoice) expect((box as HTMLInputElement).checked).toBe(false)
  else expect(box).toBeNull()
  if (whole) fireEvent.click(box!)
  fireEvent.click(screen.getByRole('button', { name: 'Start review' }))
  await waitFor(() => expect(starts).toHaveLength(1))
  return starts[0]
}

describe('ReviewSplitButton scope', () => {
  it('offers Read the whole PR only for follow-ups, unticked, and passes it as a run option', async () => {
    expect((await submitWith(true, true)).options).toEqual({ scope: 'whole' })
    cleanup()
    expect((await submitWith(true)).options).toBeUndefined()
    cleanup()
    expect((await submitWith(false)).options).toBeUndefined()
  })
})
