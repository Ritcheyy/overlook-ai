// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { MISSION_STATES, MISSION_STATE_META, StateChip } from './StateChip'

afterEach(cleanup)

describe('StateChip', () => {
  it('maps every mission state to a label and tone', () => {
    expect(MISSION_STATE_META.queued).toMatchObject({ label: 'Queued', tone: 'muted' })
    expect(MISSION_STATE_META.preparing).toMatchObject({ label: 'Preparing', tone: 'accent' })
    expect(MISSION_STATE_META.reviewing).toMatchObject({ label: 'Reviewing', tone: 'accent', pulse: true })
    expect(MISSION_STATE_META.needs_you).toMatchObject({ label: 'Needs you', tone: 'amber' })
    expect(MISSION_STATE_META.posting).toMatchObject({ label: 'Posting', tone: 'accent' })
    expect(MISSION_STATE_META.watching).toMatchObject({ label: 'Watching', tone: 'teal' })
    expect(MISSION_STATE_META.failed).toMatchObject({ label: 'Failed', tone: 'rose' })
    expect(MISSION_STATE_META.closed).toMatchObject({ label: 'Closed', tone: 'faint' })
    for (const s of MISSION_STATES) expect(MISSION_STATE_META[s].label.length).toBeGreaterThan(0)
  })

  it('renders a plain chip, or a button when clickable', () => {
    const { rerender } = render(<StateChip state="needs_you" />)
    expect(screen.getByText('Needs you').closest('button')).toBeNull()
    rerender(<StateChip state="failed" onClick={() => {}} />)
    expect(screen.getByRole('button', { name: 'Failed' })).toBeTruthy()
  })
})
