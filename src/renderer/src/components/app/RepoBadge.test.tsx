// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { repoRefFromFullName } from '@core/domain'
import { RepoBadge, repoHue } from './RepoBadge'

afterEach(cleanup)

describe('RepoBadge', () => {
  it('gives a repo the same colour everywhere and another repo a different one', () => {
    expect(repoHue('acme/checkout-api')).toBe(repoHue('acme/checkout-api'))
    expect(repoHue('acme/checkout-api')).not.toBe(repoHue('acme/storefront-web'))
  })

  it('shows the repo name and number, with the owner in the tooltip', () => {
    render(<RepoBadge repo={repoRefFromFullName('acme/checkout-api')} number={412} />)
    const badge = screen.getByTitle('acme/checkout-api#412')
    expect(badge.textContent).toBe('checkout-api#412')
    cleanup()
    render(<RepoBadge repo={repoRefFromFullName('acme/checkout-api')} number={412} name={false} />)
    expect(screen.getByTitle('acme/checkout-api#412').textContent).toBe('#412')
  })
})
