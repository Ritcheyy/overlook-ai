import { describe, expect, it } from 'vitest'
import type { Mission, ReviewRound } from '@core/domain'
import { blobUrl, relatedPrUrl } from './shared'

const mission = { pr: { repo: { fullName: 'acme/checkout-api' } } } as Mission
const round = { headSha: 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678' } as ReviewRound
const base = 'https://github.com/acme/checkout-api/blob/a1b2c3d4e5f60718293a4b5c6d7e8f9012345678'

describe('blobUrl', () => {
  it('links to the round head sha with a line anchor', () => {
    expect(blobUrl(mission, round, 'src/refunds/refund.service.ts', 48)).toBe(`${base}/src/refunds/refund.service.ts#L48`)
    expect(blobUrl(mission, round, 'README.md')).toBe(`${base}/README.md`)
  })

  it('encodes path segments and drops a leading slash', () => {
    expect(blobUrl(mission, round, '/docs/release notes/v1#2.md')).toBe(`${base}/docs/release%20notes/v1%232.md`)
  })
})

describe('relatedPrUrl', () => {
  it('turns owner/name#number into the PR page', () => {
    expect(relatedPrUrl('acme/checkout-api#419')).toBe('https://github.com/acme/checkout-api/pull/419')
  })
})
