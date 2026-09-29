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
import { FindingRow } from './FindingRow'

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
  decision: 'approved'
}

function row(props: Partial<Parameters<typeof FindingRow>[0]> = {}) {
  return render(
    <ol>
      <FindingRow finding={finding} triage={false} expanded={false} onToggle={() => undefined} {...props} />
    </ol>
  )
}

describe('FindingRow', () => {
  it('colours the integration category and opens the related PR from the expanded body', () => {
    row({ expanded: true, number: 2 })
    expect(screen.getAllByText('integration')[0].className).toContain('text-teal')
    expect(screen.getByText('2.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'depends on acme/checkout-api#419' }))
    expect(api.openExternal).toHaveBeenCalledWith('https://github.com/acme/checkout-api/pull/419')
  })

  it('shows how a posted round decided each finding instead of the decision control', () => {
    row()
    expect(screen.getByText('Posted')).toBeTruthy()
    expect(screen.queryByRole('group', { name: /Decision for/ })).toBeNull()
    cleanup()
    row({ finding: { ...finding, decision: 'dropped', dropReason: 'product_decision' } })
    expect(screen.getByText('Dropped · Product decision')).toBeTruthy()
  })

  it('opens the file in the editor, with GitHub beside it', () => {
    row({ links: { editor: 'vscode://file/w/src/cart/usePromoCode.ts:41', editorLabel: 'VS Code', github: 'https://github.com/acme/web/blob/abc/src/cart/usePromoCode.ts#L41' } })
    fireEvent.click(screen.getByRole('button', { name: 'Open src/cart/usePromoCode.ts:41 in VS Code' }))
    expect(api.openExternal).toHaveBeenLastCalledWith('vscode://file/w/src/cart/usePromoCode.ts:41')
    fireEvent.click(screen.getByRole('button', { name: 'Open src/cart/usePromoCode.ts:41 on GitHub' }))
    expect(api.openExternal).toHaveBeenLastCalledWith('https://github.com/acme/web/blob/abc/src/cart/usePromoCode.ts#L41')
  })
})
