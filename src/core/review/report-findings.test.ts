import { describe, expect, it } from 'vitest'
import { carriesFindings, reviewFromReportFindings } from './report-findings'

const collision = {
  file: './src/refunds/refund.service.ts',
  line: 48,
  summary: 'Two refunds of the same amount collide on the idempotency key.',
  failure_scenario: 'Retry a refund with a different reason: the second one is silently dropped.',
  category: 'correctness',
  short_summary: 'Refund key collision',
  verdict: 'CONFIRMED'
}

describe('reviewFromReportFindings', () => {
  it('maps a skill finding onto the app shape', () => {
    const out = reviewFromReportFindings({ findings: [collision] }, { costUsd: 1.73, durationMs: 277_000 })
    expect(out.findings).toEqual([
      {
        severity: 'major',
        category: 'correctness',
        title: 'Refund key collision',
        body: 'Two refunds of the same amount collide on the idempotency key.\n\nFailure scenario: Retry a refund with a different reason: the second one is silently dropped.',
        file: 'src/refunds/refund.service.ts',
        line: 48
      }
    ])
    expect(out.summary).toBe("1 finding reported by Claude Code's review skill.")
    expect(out.verdict).toBe('request_changes')
    expect(out.rawOutput).toBe(JSON.stringify({ findings: [collision] }, null, 2))
    expect(out.costUsd).toBe(1.73)
    expect(out.durationMs).toBe(277_000)
    expect(out).not.toHaveProperty('briefing')
  })

  it('derives the title from the summary when there is no short one, and the body without a scenario', () => {
    const long = 'A'.repeat(100)
    const out = reviewFromReportFindings({ findings: [{ summary: long, category: 'security' }, { summary: 'Short.', line: 3 }] })
    expect(out.findings[0]).toEqual({ severity: 'minor', category: 'security', title: `${'A'.repeat(77)}...`, body: long })
    expect(out.findings[1]).toEqual({ severity: 'minor', category: 'other', title: 'Short.', body: 'Short.', line: 3 })
  })

  it('maps the skill categories and verdicts', () => {
    const items = [
      ['correctness', 'correctness'],
      ['security', 'security'],
      ['efficiency', 'performance'],
      ['performance', 'performance'],
      ['simplification', 'maintainability'],
      ['maintainability', 'maintainability'],
      ['reuse', 'maintainability'],
      ['test-coverage', 'testing'],
      ['testing', 'testing'],
      ['Docs', 'other'],
      [undefined, 'other']
    ] as const
    const out = reviewFromReportFindings({ findings: items.map(([category]) => ({ summary: 's', category })) })
    expect(out.findings.map((f) => f.category)).toEqual(items.map(([, expected]) => expected))

    const verdicts = reviewFromReportFindings({
      findings: [{ summary: 's', verdict: 'CONFIRMED' }, { summary: 's', verdict: 'plausible' }, { summary: 's' }, { summary: 's', verdict: 'weird' }]
    })
    expect(verdicts.findings.map((f) => f.severity)).toEqual(['major', 'minor', 'minor', 'minor'])
  })

  it('keeps only positive integer lines and drops items without text', () => {
    const out = reviewFromReportFindings({
      findings: [{ summary: 's', line: 0 }, { summary: 's', line: -4 }, { summary: 's', line: '12' }, { file: 'x.ts' }, 'nope', null]
    })
    expect(out.findings.map((f) => f.line)).toEqual([undefined, undefined, 12])
    expect(out.findings).toHaveLength(3)
  })

  it('reports a clean review as a comment', () => {
    const out = reviewFromReportFindings({ findings: [] })
    expect(out).toMatchObject({ findings: [], summary: "0 findings reported by Claude Code's review skill.", verdict: 'comment' })
    expect(reviewFromReportFindings({}).findings).toEqual([])
  })

  it('accepts a StructuredOutput payload already in the app shape', () => {
    const out = reviewFromReportFindings({
      summary: 'Two issues.',
      verdict: 'approve',
      briefing: 'Adds keys.',
      findings: [{ severity: 'nit', category: 'style', title: 'Naming', body: 'Meh.', file: './a.ts', line: '7' }, collision]
    })
    expect(out.summary).toBe('Two issues.')
    expect(out.verdict).toBe('approve')
    expect(out.briefing).toBe('Adds keys.')
    expect(out.findings[0]).toEqual({ severity: 'nit', category: 'style', title: 'Naming', body: 'Meh.', file: 'a.ts', line: 7 })
    expect(out.findings[1].title).toBe('Refund key collision')
  })
})

describe('carriesFindings', () => {
  it('accepts ReportFindings and a StructuredOutput with findings, nothing else', () => {
    expect(carriesFindings('ReportFindings', { findings: [] })).toBe(true)
    expect(carriesFindings('ReportFindings', {})).toBe(true)
    expect(carriesFindings('ReportFindings', 'text')).toBe(false)
    expect(carriesFindings('StructuredOutput', { findings: [], summary: 'x' })).toBe(true)
    expect(carriesFindings('StructuredOutput', { summary: 'x' })).toBe(false)
    expect(carriesFindings('Read', { findings: [] })).toBe(false)
  })
})
