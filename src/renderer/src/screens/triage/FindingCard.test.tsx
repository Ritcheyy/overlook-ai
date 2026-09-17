// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { Finding } from '@core/domain'

vi.mock('@/lib/api', () => ({
  api: { openExternal: vi.fn(async () => {}) },
  onPush: vi.fn(() => () => {}),
  isElectron: false
}))

import { api } from '@/lib/api'
import { FindingCard } from './FindingCard'

afterEach(cleanup)

const finding: Finding = {
  id: 'f-1',
  severity: 'major',
  category: 'integration',
  title: 'Promo re-apply assumes sessionExpiresIn is seconds',
  body: 'checkout-api#419 changes the field to seconds.',
  file: 'src/cart/usePromoCode.ts',
  line: 41,
  relatedPr: 'acme/checkout-api#419',
  decision: 'pending'
}

describe('FindingCard', () => {
  it('colours the integration category and opens the related PR from its chip', () => {
    render(
      <ol>
        <FindingCard finding={finding} onDecision={() => undefined} />
      </ol>
    )
    expect(screen.getByText('integration').className).toContain('text-teal')
    const chip = screen.getByRole('button', { name: 'depends on acme/checkout-api#419' })
    fireEvent.click(chip)
    expect(api.openExternal).toHaveBeenCalledWith('https://github.com/acme/checkout-api/pull/419')
  })

  it('shows a plain category and no chip without a related PR', () => {
    const { relatedPr: _none, ...plain } = finding
    render(
      <ol>
        <FindingCard finding={{ ...plain, category: 'correctness' }} onDecision={() => undefined} />
      </ol>
    )
    expect(screen.queryByRole('button', { name: /depends on/ })).toBeNull()
    expect(screen.getByText('correctness').className).toContain('text-muted')
  })
})
