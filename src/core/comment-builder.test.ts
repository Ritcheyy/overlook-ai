import { describe, expect, it } from 'vitest'
import { buildComment } from './comment-builder'
import { defaultSettings } from './loadouts'
import { HEAD_SHA, PREV_SHA, makeFinding, makeMission, makeRound } from './review/test-helpers'

const settings = defaultSettings({ signature: '', replyRequest: '' })
const mission = makeMission()
const blob = (file: string, line?: number) =>
  `https://github.com/acme/checkout-api/blob/${HEAD_SHA}/${file}${line ? `#L${line}` : ''}`

describe('buildComment', () => {
  it('renders header, verdict, summary and one finding with a line link', () => {
    const round = makeRound({
      summary: 'One real bug.',
      verdict: 'request_changes',
      findings: [
        makeFinding({
          severity: 'blocker',
          category: 'correctness',
          title: 'Key collision',
          body: 'Two refunds collide.',
          file: 'src/refunds/refund.service.ts',
          line: 48,
          suggestion: '```ts\nconst key = sha256(orderId + amount + reason)\n```'
        })
      ]
    })
    const out = buildComment({ mission, round, settings })
    expect(out).toBe(
      [
        '### Review of a1b2c3d',
        '**Request changes** · 1 finding',
        '',
        'One real bug.',
        '',
        '#### 1. Key collision',
        `**Blocker** · correctness · [src/refunds/refund.service.ts:48](${blob('src/refunds/refund.service.ts', 48)})`,
        '',
        'Two refunds collide.',
        '',
        '<details>',
        '<summary>Suggestion</summary>',
        '',
        '```ts',
        'const key = sha256(orderId + amount + reason)',
        '```',
        '',
        '</details>',
        ''
      ].join('\n')
    )
  })

  it('names the related PR after the location so GitHub links it', () => {
    const round = makeRound({
      findings: [
        makeFinding({ severity: 'major', category: 'integration', title: 'Promo re-apply assumes seconds', body: 'Breaks once #419 merges.', file: 'src/cart/usePromoCode.ts', line: 41, relatedPr: 'acme/checkout-api#419' }),
        makeFinding({ severity: 'minor', category: 'integration', title: 'No location', body: 'Body.', relatedPr: 'acme/checkout-api#420' })
      ]
    })
    const out = buildComment({ mission, round, settings })
    expect(out).toContain(`#### 1. Promo re-apply assumes seconds\n**Major** · integration · [src/cart/usePromoCode.ts:41](${blob('src/cart/usePromoCode.ts', 41)}) · relates to acme/checkout-api#419`)
    expect(out).toContain('#### 2. No location\n**Minor** · integration · relates to acme/checkout-api#420')
  })

  it('never includes the briefing', () => {
    const briefing = '- Adds an idempotency_key column to refunds.\n- Migration must run before deploy.'
    const round = makeRound({ briefing, findings: [makeFinding({ title: 'Key collision', body: 'Two refunds collide.' })] })
    const out = buildComment({ mission, round, settings: defaultSettings() })
    expect(out).not.toContain('idempotency_key')
    expect(out).not.toContain('Migration must run')
    expect(out).toContain('Key collision')
  })

  it('orders approved findings by severity then file and omits dropped ones', () => {
    const round = makeRound({
      findings: [
        makeFinding({ severity: 'nit', title: 'Nit B', file: 'b.ts' }),
        makeFinding({ severity: 'major', title: 'Major dropped', file: 'a.ts', decision: 'dropped', dropReason: 'false_positive' }),
        makeFinding({ severity: 'major', title: 'Major Z', file: 'z.ts' }),
        makeFinding({ severity: 'blocker', title: 'Blocker pending', decision: 'pending' }),
        makeFinding({ severity: 'major', title: 'Major A', file: 'a.ts' }),
        makeFinding({ severity: 'major', title: 'Major no file' }),
        makeFinding({ severity: 'blocker', title: 'Blocker', file: 'm.ts' }),
        makeFinding({ severity: 'praise', title: 'Praise' })
      ]
    })
    const out = buildComment({ mission, round, settings })
    const titles = [...out.matchAll(/^#### (\d+)\. (.+)$/gm)].map((m) => `${m[1]} ${m[2]}`)
    expect(titles).toEqual(['1 Blocker', '2 Major A', '3 Major Z', '4 Major no file', '5 Nit B', '6 Praise'])
    expect(out).not.toContain('Major dropped')
    expect(out).not.toContain('Blocker pending')
    expect(out).toContain('· 6 findings')
  })

  it('omits the link when there is no file and #L when there is no line', () => {
    const round = makeRound({
      verdict: 'comment',
      findings: [
        makeFinding({ severity: 'minor', category: 'product', title: 'Whole file', file: 'src/x.ts' }),
        makeFinding({ severity: 'minor', category: 'other', title: 'Nowhere' })
      ]
    })
    const out = buildComment({ mission, round, settings })
    expect(out).toContain('**Comments** · 2 findings')
    expect(out).toContain(`#### 1. Whole file\n**Minor** · product · [src/x.ts](${blob('src/x.ts')})`)
    expect(out).toContain('#### 2. Nowhere\n**Minor** · other')
    expect(out).not.toContain('#L')
  })

  it('says so when there are no approved findings', () => {
    const round = makeRound({
      verdict: 'approve',
      summary: 'Clean.',
      findings: [makeFinding({ decision: 'dropped', dropReason: 'not_worth_it' })]
    })
    const out = buildComment({ mission, round, settings })
    expect(out).toBe('### Review of a1b2c3d\n**Looks good** · 0 findings\n\nClean.\n\nNo findings to report.\n')
  })

  it('appends the signature after a rule, separated by a blank line', () => {
    const round = makeRound({ verdict: 'approve', summary: 'Clean.' })
    const out = buildComment({ mission, round, settings: defaultSettings({ signature: 'Reviewed with Claude Code' }) })
    expect(out.endsWith('No findings to report.\n\n---\nReviewed with Claude Code\n')).toBe(true)
    expect(buildComment({ mission, round, settings: defaultSettings({ signature: '   ' }) })).not.toContain('---')
  })

  it('renders the default signature template from the loadout, character and login', () => {
    const round = makeRound({ verdict: 'approve', summary: 'Clean.' })
    const out = buildComment({ mission: makeMission({ slotId: 'slot-1' }), round, settings: defaultSettings(), login: 'ritchey' })
    expect(out.endsWith('\n\n---\nBlind review · Reviewed by Vhagar · Findings approved by ritchey\n')).toBe(true)
  })

  it('says the comment was posted automatically for auto-post missions', () => {
    const round = makeRound({ verdict: 'approve', summary: 'Clean.' })
    const out = buildComment({ mission: makeMission({ preferredSlotId: 'slot-2', autoPost: true }), round, settings: defaultSettings(), login: 'ritchey' })
    expect(out.endsWith('---\nBlind review · Reviewed by Nova · Posted automatically\n')).toBe(true)
  })

  it('credits the person who approved when an auto-post mission is posted by hand', () => {
    const round = makeRound({ verdict: 'approve', summary: 'Clean.' })
    const out = buildComment({ mission: makeMission({ preferredSlotId: 'slot-2', autoPost: true }), round, settings: defaultSettings(), login: 'ritchey', autoPosted: false })
    expect(out.endsWith('---\nBlind review · Reviewed by Nova · Findings approved by ritchey\n')).toBe(true)
  })

  it('falls back to "you" and "a reviewer" when the login and slot are unknown', () => {
    const round = makeRound({ verdict: 'approve', summary: 'Clean.' })
    const out = buildComment({ mission, round, settings: defaultSettings() })
    expect(out.endsWith('---\nBlind review · Reviewed by a reviewer · Findings approved by you\n')).toBe(true)
  })

  it('fills every placeholder and blanks unknown ones', () => {
    const round = makeRound({ id: 'round-2', index: 2, previousHeadSha: PREV_SHA, verdict: 'approve', summary: 'Clean.' })
    const template = '{round}/{sha}/{login}/{type}/{reviewer}/{loadout}/{character}/{approval}/{nope}/{}'
    const out = buildComment({ mission: makeMission({ slotId: 'slot-1' }), round, settings: defaultSettings({ signature: template }), login: 'ritchey' })
    expect(out.endsWith('---\n2/a1b2c3d/ritchey/Blind review/Vhagar/Blind review/Vhagar/Findings approved by ritchey//{}\n')).toBe(true)
    expect(buildComment({ mission, round, settings: defaultSettings({ signature: ' {nope} ' }) })).not.toContain('---')
  })

  it('marks follow-up rounds in the header and under the summary', () => {
    const round = makeRound({ id: 'round-2', index: 2, previousHeadSha: PREV_SHA, verdict: 'approve', summary: 'All fixed.' })
    const out = buildComment({ mission, round, settings })
    expect(out.startsWith('### Review of a1b2c3d · round 2\n**Looks good** · 0 findings\n\nAll fixed.\n\nFollow-up on 9f8e7d6 → a1b2c3d.\n')).toBe(
      true
    )
  })

  it('URL-encodes file paths in links', () => {
    const round = makeRound({ findings: [makeFinding({ file: 'docs/my file.md', line: 3 })] })
    const out = buildComment({ mission, round, settings })
    expect(out).toContain(`[docs/my file.md:3](${blob('docs/my%20file.md', 3)})`)
  })

  it('asks for a disposition reply with a copyable table when it posts findings', () => {
    const round = makeRound({
      findings: [
        makeFinding({ severity: 'praise', title: 'Nice guard' }),
        makeFinding({ severity: 'major', title: 'Key | collision', file: 'a.ts', line: 3 }),
        makeFinding({ severity: 'minor', title: 'Dropped one', decision: 'dropped' })
      ]
    })
    const out = buildComment({ mission, round, settings: defaultSettings({ signature: 'Sig', replyRequest: 'Reply with a disposition.' }) })
    expect(out).toContain(
      [
        '',
        'Reply with a disposition.',
        '',
        '<details>',
        '<summary>Reply template</summary>',
        '',
        '```markdown',
        '### Round 1 findings: disposition',
        '',
        '| # | Finding | Outcome |',
        '| --- | --- | --- |',
        '| 1 | Key \\| collision |  |',
        '| 2 | Nice guard | — |',
        '```',
        '',
        '</details>',
        '',
        '---',
        'Sig',
        ''
      ].join('\n')
    )
    expect(out).not.toContain('Dropped one')
  })

  it('leaves the reply request out when nothing needs an answer or it is switched off', () => {
    const praiseOnly = makeRound({ findings: [makeFinding({ severity: 'praise', title: 'Nice guard' })] })
    expect(buildComment({ mission, round: praiseOnly, settings: defaultSettings() })).not.toContain('Reply template')
    const clean = makeRound({ verdict: 'approve', summary: 'Clean.' })
    expect(buildComment({ mission, round: clean, settings: defaultSettings() })).not.toContain('Reply template')
    const withFinding = makeRound({ findings: [makeFinding({ title: 'Key collision' })] })
    expect(buildComment({ mission, round: withFinding, settings: defaultSettings() })).toContain('Reply template')
    expect(buildComment({ mission, round: withFinding, settings: defaultSettings({ replyRequest: '  ' }) })).not.toContain('Reply template')
  })
})
