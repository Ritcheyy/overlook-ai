import { describe, expect, it } from 'vitest'
import { mapDetailToPullRequest, mapPrState, parsePrDetail, parseSearchResults, searchItemId } from './github-map'

const searchPayload = [
  {
    author: { id: 'MDQ6VXNlcjE=', is_bot: false, login: 'dami-codes', type: 'User', url: 'https://github.com/dami-codes' },
    createdAt: '2026-09-13T08:00:00Z',
    isDraft: false,
    labels: [
      { color: '0e8a16', description: '', id: 'LA_1', name: 'backend' },
      { color: '1d76db', description: '', id: 'LA_2', name: 'payments' }
    ],
    number: 412,
    repository: { name: 'checkout-api', nameWithOwner: 'acme/checkout-api' },
    state: 'open',
    title: 'fix(refunds): make refund creation idempotent per order',
    updatedAt: '2026-09-13T11:30:00Z',
    url: 'https://github.com/acme/checkout-api/pull/412'
  }
]

const detailPayload = {
  additions: 212,
  author: { id: 'MDQ6VXNlcjE=', is_bot: false, login: 'dami-codes', name: 'Dami' },
  baseRefName: 'main',
  body: 'Refunds could be created twice when the client retried.',
  changedFiles: 7,
  createdAt: '2026-09-13T08:00:00Z',
  deletions: 48,
  headRefName: 'fix/refund-idempotency',
  headRefOid: 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678',
  isDraft: false,
  labels: [
    { id: 'LA_1', name: 'backend', description: '', color: '0e8a16' },
    { id: 'LA_2', name: 'payments', description: '', color: '1d76db' }
  ],
  mergedAt: null,
  number: 412,
  reviewRequests: [
    { __typename: 'User', login: 'octo-reviewer' },
    { __typename: 'Team', name: 'backend', slug: 'backend' }
  ],
  state: 'OPEN',
  title: 'fix(refunds): make refund creation idempotent per order',
  updatedAt: '2026-09-13T11:30:00Z',
  url: 'https://github.com/acme/checkout-api/pull/412'
}

describe('parseSearchResults', () => {
  it('parses the gh search prs payload and identifies each PR', () => {
    const items = parseSearchResults(JSON.stringify(searchPayload))
    expect(items).toHaveLength(1)
    expect(searchItemId(items[0]!)).toBe('acme/checkout-api#412')
    expect(items[0]!.author?.login).toBe('dami-codes')
    expect(items[0]!.labels.map((l) => l.name)).toEqual(['backend', 'payments'])
  })

  it('treats empty output as no results', () => {
    expect(parseSearchResults('')).toEqual([])
    expect(parseSearchResults('  \n')).toEqual([])
  })

  it('rejects malformed JSON with a message naming the command', () => {
    expect(() => parseSearchResults('{not json')).toThrow(/gh search prs returned invalid JSON/)
  })

  it('rejects payloads missing required fields', () => {
    expect(() => parseSearchResults(JSON.stringify([{ number: 1 }]))).toThrow()
  })
})

describe('mapDetailToPullRequest', () => {
  it('maps the gh pr view payload into a PullRequest', () => {
    const detail = parsePrDetail(JSON.stringify(detailPayload))
    const pr = mapDetailToPullRequest('acme/checkout-api', detail, { me: 'octo-Reviewer' })
    expect(pr).toEqual({
      id: 'acme/checkout-api#412',
      repo: { host: 'github', owner: 'acme', name: 'checkout-api', fullName: 'acme/checkout-api' },
      number: 412,
      title: 'fix(refunds): make refund creation idempotent per order',
      body: 'Refunds could be created twice when the client retried.',
      author: 'dami-codes',
      url: 'https://github.com/acme/checkout-api/pull/412',
      headRef: 'fix/refund-idempotency',
      headSha: 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678',
      baseRef: 'main',
      isDraft: false,
      state: 'open',
      createdAt: '2026-09-13T08:00:00Z',
      updatedAt: '2026-09-13T11:30:00Z',
      additions: 212,
      deletions: 48,
      changedFiles: 7,
      labels: ['backend', 'payments'],
      reviewRequested: true,
      mine: false
    })
  })

  it('does not mark reviewRequested when only a team or someone else is requested', () => {
    const detail = parsePrDetail(JSON.stringify({ ...detailPayload, reviewRequests: [{ __typename: 'Team', name: 'backend', slug: 'backend' }, { login: 'someone' }] }))
    expect(mapDetailToPullRequest('acme/checkout-api', detail, { me: 'octo-reviewer' }).reviewRequested).toBe(false)
  })

  it('trusts the review-requested search over the detail payload', () => {
    const detail = parsePrDetail(JSON.stringify({ ...detailPayload, reviewRequests: [] }))
    expect(mapDetailToPullRequest('acme/checkout-api', detail, { me: 'octo-reviewer', reviewRequested: true }).reviewRequested).toBe(true)
  })

  it('marks PRs I authored as mine, ignoring login case', () => {
    const detail = parsePrDetail(JSON.stringify({ ...detailPayload, author: { login: 'octo-reviewer' }, reviewRequests: [] }))
    const pr = mapDetailToPullRequest('acme/checkout-api', detail, { me: 'octo-Reviewer' })
    expect(pr.mine).toBe(true)
    expect(pr.reviewRequested).toBe(false)
  })

  it('maps merged and closed states, preferring mergedAt', () => {
    expect(mapPrState('OPEN', null)).toBe('open')
    expect(mapPrState('CLOSED', null)).toBe('closed')
    expect(mapPrState('MERGED', null)).toBe('merged')
    expect(mapPrState('CLOSED', '2026-09-13T12:00:00Z')).toBe('merged')
    expect(mapPrState('open')).toBe('open')
  })

  it('handles a deleted author and an empty body', () => {
    const detail = parsePrDetail(JSON.stringify({ ...detailPayload, author: null, body: '' }))
    const pr = mapDetailToPullRequest('acme/checkout-api', detail, { me: 'octo-Reviewer' })
    expect(pr.author).toBe('ghost')
    expect(pr.body).toBeUndefined()
    expect(pr.mine).toBe(false)
  })
})
