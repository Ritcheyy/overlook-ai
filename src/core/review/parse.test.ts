import { describe, expect, it } from 'vitest'
import { MissingFindingsError, NO_FINDINGS_SUMMARY, extractReviewFromText, parseReviewOutput } from './parse'

const review = {
  summary: 'One real bug. Otherwise fine.',
  verdict: 'request_changes',
  findings: [
    {
      severity: 'Blocker',
      category: 'correctness',
      title: 'Key collision',
      body: 'Two refunds of the same amount collide.',
      file: './src/refunds/refund.service.ts',
      line: '48',
      suggestion: 'Include the reason in the key.'
    },
    { severity: 'praise', category: 'testing', title: 'Good coverage', body: 'Nice.' }
  ]
}

const expectedFindings = [
  {
    severity: 'blocker',
    category: 'correctness',
    title: 'Key collision',
    body: 'Two refunds of the same amount collide.',
    file: 'src/refunds/refund.service.ts',
    line: 48,
    suggestion: 'Include the reason in the key.'
  },
  { severity: 'praise', category: 'testing', title: 'Good coverage', body: 'Nice.' }
]

function envelope(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type: 'result',
    subtype: 'success',
    is_error: false,
    result: 'Here is my review.',
    total_cost_usd: 0.42,
    duration_ms: 12345,
    num_turns: 7,
    session_id: 'abc',
    ...overrides
  }
}

describe('parseReviewOutput', () => {
  it('prefers structured_output from the result envelope', () => {
    const out = parseReviewOutput(envelope({ structured_output: review }))
    expect(out.findings).toEqual(expectedFindings)
    expect(out.summary).toBe('One real bug. Otherwise fine.')
    expect(out.verdict).toBe('request_changes')
    expect(out.costUsd).toBe(0.42)
    expect(out.durationMs).toBe(12345)
    expect(out.rawOutput).toBe(JSON.stringify(review, null, 2))
  })

  it('accepts structured_output delivered as a JSON string', () => {
    const out = parseReviewOutput(envelope({ result: 'done', structured_output: JSON.stringify(review) }))
    expect(out.findings).toEqual(expectedFindings)
    expect(out.summary).toBe('One real bug. Otherwise fine.')
    expect(out.rawOutput).toBe(JSON.stringify(review, null, 2))
  })

  it('accepts the envelope as a JSON string', () => {
    const out = parseReviewOutput(JSON.stringify(envelope({ structured_output: review })))
    expect(out.findings).toEqual(expectedFindings)
    expect(out.costUsd).toBe(0.42)
  })

  it('falls back to a fenced json block in the result text', () => {
    const text = `Some preamble.\n\n\`\`\`json\n${JSON.stringify(review, null, 2)}\n\`\`\`\n\nDone.`
    const out = parseReviewOutput(envelope({ result: text }))
    expect(out.findings).toEqual(expectedFindings)
    expect(out.verdict).toBe('request_changes')
    expect(out.rawOutput).toBe(text)
  })

  it('finds the first balanced object in raw text', () => {
    const text = `I looked at {a few} things. ${JSON.stringify(review)} That is all.`
    const out = parseReviewOutput(envelope({ result: text }))
    expect(out.findings).toEqual(expectedFindings)
  })

  it('skips objects that are not reviews even when they parse', () => {
    const text = `Meta: {"note": "ignore me"} then ${JSON.stringify(review)}`
    const out = parseReviewOutput(text)
    expect(out.findings).toHaveLength(2)
    expect(out.summary).toBe('One real bug. Otherwise fine.')
  })

  it('handles braces inside JSON strings', () => {
    const tricky = { ...review, summary: 'Watch out for } and { in strings' }
    const out = parseReviewOutput(`Result: ${JSON.stringify(tricky)}`)
    expect(out.summary).toBe('Watch out for } and { in strings')
    expect(out.findings).toHaveLength(2)
  })

  it('accepts a bare review object', () => {
    const out = parseReviewOutput(review)
    expect(out.findings).toEqual(expectedFindings)
    expect(out.costUsd).toBeUndefined()
  })

  it('returns a comment-only result with the text as summary when nothing parses', () => {
    const text = 'I could not finish the review. '.repeat(100)
    const out = parseReviewOutput(envelope({ result: text }))
    expect(out.findings).toEqual([])
    expect(out.verdict).toBe('comment')
    expect(out.summary).toBe(text.trim().slice(0, 2000))
    expect(out.summary.length).toBe(2000)
    expect(out.rawOutput).toBe(text.trim())
    expect(out.costUsd).toBe(0.42)
  })

  it('uses the default summary when the output is empty', () => {
    const out = parseReviewOutput(envelope({ result: '' }))
    expect(out.summary).toBe(NO_FINDINGS_SUMMARY)
    expect(out.findings).toEqual([])
    expect(out.rawOutput).toBeUndefined()
  })

  it('treats a non-JSON string as raw text', () => {
    const out = parseReviewOutput('just some words')
    expect(out).toMatchObject({ findings: [], verdict: 'comment', summary: 'just some words', rawOutput: 'just some words' })
  })

  it('falls back to the result text when structured_output is unusable', () => {
    const out = parseReviewOutput(envelope({ structured_output: { nonsense: true }, result: JSON.stringify(review) }))
    expect(out.findings).toHaveLength(2)
    expect(out.rawOutput).toBe(JSON.stringify(review))
  })

  it('carries related_pr through as relatedPr and drops a malformed one', () => {
    const findings = [
      { severity: 'major', category: 'integration', title: 'T', body: 'B', related_pr: 'acme/checkout-api#419' },
      { severity: 'minor', category: 'correctness', title: 'U', body: 'C', related_pr: 'see PR 419' }
    ]
    const out = parseReviewOutput(envelope({ structured_output: { summary: 'S', verdict: 'comment', findings } }))
    expect(out.findings[0]).toEqual({ severity: 'major', category: 'integration', title: 'T', body: 'B', relatedPr: 'acme/checkout-api#419' })
    expect(out.findings[1]).toEqual({ severity: 'minor', category: 'correctness', title: 'U', body: 'C' })
  })

  it('carries the briefing through and leaves it out when absent', () => {
    const briefing = '- Adds idempotency keys to refunds.\n- Migration 0042 must run first.'
    const out = parseReviewOutput(envelope({ structured_output: { ...review, briefing: ` ${briefing} ` } }))
    expect(out.briefing).toBe(briefing)
    expect(parseReviewOutput(envelope({ structured_output: review }))).not.toHaveProperty('briefing')
    expect(parseReviewOutput(`Notes\n\n${JSON.stringify({ ...review, briefing })}`).briefing).toBe(briefing)
  })

  it('fills in a summary when the reviewer omitted one', () => {
    const out = parseReviewOutput({ findings: [{ title: 'T', body: 'B' }] })
    expect(out.summary).toMatch(/1 finding/)
  })

  it('throws with the result text on is_error envelopes', () => {
    expect(() => parseReviewOutput(envelope({ is_error: true, subtype: 'error_max_budget_usd', result: 'Budget of $3 exceeded' }))).toThrow(
      'Budget of $3 exceeded'
    )
  })

  it('throws on error subtypes even when is_error is missing', () => {
    expect(() => parseReviewOutput(JSON.stringify({ type: 'result', subtype: 'error_during_execution', result: '' }))).toThrow(
      /error_during_execution/
    )
  })
})

describe('parseReviewOutput in strict mode', () => {
  const strict = { strict: true }

  it('throws with the final message and the cost when the envelope has no findings payload', () => {
    expect(() => parseReviewOutput(envelope({ result: 'Command completed', structured_output: undefined }), strict)).toThrow(
      'Claude finished without a findings payload. Its final message was: "Command completed". A slash command that runs its own flow does this; use the plain prompt for this loadout. Estimated cost $0.42.'
    )
  })

  it('carries cost and duration on the error, truncates the quoted message and omits an unknown cost', () => {
    let thrown: unknown
    try {
      parseReviewOutput(envelope({ result: 'x'.repeat(300), structured_output: undefined, total_cost_usd: undefined }), strict)
    } catch (e) {
      thrown = e
    }
    expect(thrown).toBeInstanceOf(MissingFindingsError)
    const err = thrown as MissingFindingsError
    expect(err.message).toContain(`Its final message was: "${'x'.repeat(200)}…".`)
    expect(err.message).not.toContain('Estimated cost')
    expect(err.costUsd).toBeUndefined()
    expect(err.durationMs).toBe(12345)
    expect(() => parseReviewOutput(envelope({ result: '   ', structured_output: undefined }), strict)).toThrow('Its final message was empty.')
  })

  it('throws for bare text and non-review objects too', () => {
    expect(() => parseReviewOutput('just some words', strict)).toThrow(MissingFindingsError)
    expect(() => parseReviewOutput({ note: 'not a review' }, strict)).toThrow(MissingFindingsError)
  })

  it('still returns reviews found in structured_output or in the result text', () => {
    expect(parseReviewOutput(envelope({ structured_output: review }), strict).findings).toEqual(expectedFindings)
    expect(parseReviewOutput(envelope({ result: `Done.\n${JSON.stringify(review)}` }), strict).findings).toEqual(expectedFindings)
    expect(parseReviewOutput(review, strict).findings).toEqual(expectedFindings)
  })

  it('keeps error envelopes as plain errors and the non-strict fallback unchanged', () => {
    expect(() => parseReviewOutput(envelope({ is_error: true, subtype: 'error_max_budget_usd', result: 'Budget of $3 exceeded' }), strict)).toThrow(
      'Budget of $3 exceeded'
    )
    const lenient = parseReviewOutput(envelope({ result: 'Command completed', structured_output: undefined }))
    expect(lenient).toMatchObject({ findings: [], verdict: 'comment', summary: 'Command completed', costUsd: 0.42 })
  })
})

describe('extractReviewFromText', () => {
  it('returns undefined when there is no JSON', () => {
    expect(extractReviewFromText('nothing here')).toBeUndefined()
    expect(extractReviewFromText('{ unbalanced')).toBeUndefined()
  })

  it('reads an unlabelled fence', () => {
    const out = extractReviewFromText('```\n{"summary":"ok","verdict":"approve","findings":[]}\n```')
    expect(out).toEqual({ summary: 'ok', verdict: 'approve', findings: [] })
  })
})
