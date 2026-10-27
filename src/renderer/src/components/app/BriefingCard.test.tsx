// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import type { ReviewRound } from '@core/domain'
import { BriefingCard } from './BriefingCard'

afterEach(cleanup)

const round: ReviewRound = {
  id: 'round-1',
  index: 1,
  headSha: 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678',
  startedAt: '2026-09-13T10:05:00.000Z',
  findings: [],
  summary: 'One real bug.',
  verdict: 'request_changes'
}

describe('BriefingCard', () => {
  it('renders the briefing as markdown with the not-posted caption', () => {
    render(<BriefingCard round={{ ...round, briefing: '- Adds an `idempotency_key` column.\n- Migration must run first.' }} />)
    expect(screen.getByText('What this PR does')).toBeTruthy()
    expect(screen.getByText('for you, not posted')).toBeTruthy()
    expect(screen.getAllByRole('listitem')).toHaveLength(2)
    expect(screen.getByText('idempotency_key').tagName).toBe('CODE')
  })

  it('heads the briefing with the verdict on the approach, and shows it even without a briefing', () => {
    render(<BriefingCard round={{ ...round, briefing: 'Adds a column.', approach: { verdict: 'sound', note: 'Builds on the existing refund service.' } }} />)
    const sound = screen.getByText(/Approach: sound\./).closest('[data-approach]')
    expect(sound?.getAttribute('data-approach')).toBe('sound')
    expect(sound?.textContent).toContain('Builds on the existing refund service.')
    cleanup()
    render(<BriefingCard round={{ ...round, approach: { verdict: 'alternative', note: 'Reuse PaymentRetry instead of a new queue' } }} />)
    expect(screen.getByText(/Approach: alternative proposed\./).closest('[data-approach]')?.getAttribute('data-approach')).toBe('alternative')
  })

  it('renders nothing without a briefing', () => {
    expect(render(<BriefingCard round={round} />).container.innerHTML).toBe('')
    expect(render(<BriefingCard round={{ ...round, briefing: '   ' }} />).container.innerHTML).toBe('')
    expect(render(<BriefingCard round={undefined} />).container.innerHTML).toBe('')
  })
})
