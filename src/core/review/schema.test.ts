import { describe, expect, it } from 'vitest'
import {
  CATEGORIES,
  REVIEW_JSON_SCHEMA,
  SEVERITIES,
  VERDICTS,
  coerceFile,
  coerceLine,
  coerceSeverity,
  coerceCategory,
  coerceVerdict,
  coerceRelatedPr,
  normaliseFindings,
  normaliseReview,
  reviewOutputSchema
} from './schema'

describe('REVIEW_JSON_SCHEMA', () => {
  it('describes the review shape with the domain enums', () => {
    expect(REVIEW_JSON_SCHEMA.type).toBe('object')
    expect(REVIEW_JSON_SCHEMA.required).toEqual(['summary', 'verdict', 'findings', 'briefing'])
    expect(REVIEW_JSON_SCHEMA.properties.briefing.type).toBe('string')
    expect(REVIEW_JSON_SCHEMA.properties.verdict.enum).toEqual(VERDICTS)
    const item = REVIEW_JSON_SCHEMA.properties.findings.items
    expect(item.required).toEqual(['severity', 'category', 'title', 'body'])
    expect(item.properties.severity.enum).toEqual(SEVERITIES)
    expect(item.properties.category.enum).toEqual(CATEGORIES)
    expect(CATEGORIES).toContain('integration')
    expect(item.properties.line.type).toBe('integer')
    expect(item.properties.related_pr.type).toBe('string')
    expect(item.required).not.toContain('related_pr')
  })

  it('serialises to JSON for the --json-schema flag', () => {
    const json = JSON.stringify(REVIEW_JSON_SCHEMA)
    expect(JSON.parse(json)).toEqual(REVIEW_JSON_SCHEMA)
  })

  it('uses only keywords that structured outputs accept', () => {
    const rejected = ['minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf', 'minLength', 'maxLength', 'pattern', 'format', 'minItems', 'maxItems', 'uniqueItems', '$ref']
    const keys = new Set<string>()
    const walk = (node: unknown): void => {
      if (Array.isArray(node)) node.forEach(walk)
      else if (node && typeof node === 'object') {
        for (const [k, v] of Object.entries(node)) {
          keys.add(k)
          walk(v)
        }
      }
    }
    walk(REVIEW_JSON_SCHEMA)
    expect(rejected.filter((k) => keys.has(k))).toEqual([])
  })
})

describe('coercions', () => {
  it('lowercases known severities and maps unknown ones to minor', () => {
    expect(coerceSeverity('BLOCKER')).toBe('blocker')
    expect(coerceSeverity(' Nit ')).toBe('nit')
    expect(coerceSeverity('critical')).toBe('blocker')
    expect(coerceSeverity('weird')).toBe('minor')
    expect(coerceSeverity(undefined)).toBe('minor')
    expect(coerceSeverity(3)).toBe('minor')
  })

  it('lowercases known categories and maps unknown ones to other', () => {
    expect(coerceCategory('Security')).toBe('security')
    expect(coerceCategory('perf')).toBe('performance')
    expect(coerceCategory('banana')).toBe('other')
    expect(coerceCategory(null)).toBe('other')
  })

  it('normalises verdict spellings and falls back to comment', () => {
    expect(coerceVerdict('APPROVE')).toBe('approve')
    expect(coerceVerdict('Request Changes')).toBe('request_changes')
    expect(coerceVerdict('changes-requested')).toBe('request_changes')
    expect(coerceVerdict('whatever')).toBe('comment')
    expect(coerceVerdict(undefined)).toBe('comment')
  })

  it('coerces line to a positive integer or drops it', () => {
    expect(coerceLine(42)).toBe(42)
    expect(coerceLine(12.7)).toBe(12)
    expect(coerceLine('17')).toBe(17)
    expect(coerceLine('L9')).toBe(9)
    expect(coerceLine('48-52')).toBe(48)
    expect(coerceLine(0)).toBeUndefined()
    expect(coerceLine(-3)).toBeUndefined()
    expect(coerceLine('abc')).toBeUndefined()
    expect(coerceLine(null)).toBeUndefined()
    expect(coerceLine(Number.NaN)).toBeUndefined()
  })

  it('strips a leading ./ from file and drops empty paths', () => {
    expect(coerceFile('./src/a.ts')).toBe('src/a.ts')
    expect(coerceFile('././src/a.ts')).toBe('src/a.ts')
    expect(coerceFile('  src/b.ts ')).toBe('src/b.ts')
    expect(coerceFile('')).toBeUndefined()
    expect(coerceFile(42)).toBeUndefined()
  })
})

describe('normaliseFindings', () => {
  it('returns RawFinding[] with coerced fields and no undefined keys', () => {
    const out = normaliseFindings([
      {
        severity: 'Major',
        category: 'Testing',
        title: 'No retry test',
        body: 'The retry path is untested.',
        file: './src/a.spec.ts',
        line: '112',
        suggestion: '  add a case  '
      }
    ])
    expect(out).toEqual([
      {
        severity: 'major',
        category: 'testing',
        title: 'No retry test',
        body: 'The retry path is untested.',
        file: 'src/a.spec.ts',
        line: 112,
        suggestion: 'add a case'
      }
    ])
    expect(Object.keys(out[0])).not.toContain('dropReason')
  })

  it('omits file, line and suggestion when absent or invalid', () => {
    const [f] = normaliseFindings([{ severity: 'nit', category: 'style', title: 'T', body: 'B', line: 0, suggestion: '' }])
    expect(f).toEqual({ severity: 'nit', category: 'style', title: 'T', body: 'B' })
    expect('file' in f).toBe(false)
    expect('line' in f).toBe(false)
  })

  it('splits a file:line path when line is missing', () => {
    const [f] = normaliseFindings([{ title: 'T', body: 'B', file: 'src/a.ts:48' }])
    expect(f.file).toBe('src/a.ts')
    expect(f.line).toBe(48)
  })

  it('derives a title from the body and drops entries with neither', () => {
    const out = normaliseFindings([
      { body: 'First line is the title\nMore detail.' },
      { severity: 'major' },
      'not an object',
      null
    ])
    expect(out).toHaveLength(1)
    expect(out[0].title).toBe('First line is the title')
    expect(out[0].body).toBe('First line is the title\nMore detail.')
  })

  it('returns an empty array for non-arrays', () => {
    expect(normaliseFindings(undefined)).toEqual([])
    expect(normaliseFindings('none')).toEqual([])
  })

  it('keeps related_pr only when it names a PR as owner/name#number', () => {
    expect(coerceRelatedPr(' acme/checkout-api#419 ')).toBe('acme/checkout-api#419')
    expect(coerceRelatedPr('acme/check.out-api_v2#7')).toBe('acme/check.out-api_v2#7')
    expect(coerceRelatedPr('#419')).toBeUndefined()
    expect(coerceRelatedPr('acme/checkout-api')).toBeUndefined()
    expect(coerceRelatedPr('https://github.com/acme/checkout-api/pull/419')).toBeUndefined()
    expect(coerceRelatedPr('acme/checkout-api#419 and more')).toBeUndefined()
    expect(coerceRelatedPr(419)).toBeUndefined()

    const out = normaliseFindings([
      { title: 'A', body: 'B', category: 'integration', related_pr: 'acme/checkout-api#419' },
      { title: 'C', body: 'D', relatedPr: 'acme/checkout-api#420' },
      { title: 'E', body: 'F', related_pr: 'not a pr' }
    ])
    expect(out[0]).toMatchObject({ category: 'integration', relatedPr: 'acme/checkout-api#419' })
    expect(out[1].relatedPr).toBe('acme/checkout-api#420')
    expect('relatedPr' in out[2]).toBe(false)
  })

  it('maps cross-repo wording to integration', () => {
    expect(coerceCategory('Integration')).toBe('integration')
    expect(coerceCategory('cross-repo')).toBe('integration')
    expect(coerceCategory('compatibility')).toBe('integration')
  })
})

describe('reviewOutputSchema', () => {
  it('parses a well-formed review', () => {
    const out = reviewOutputSchema.parse({
      summary: ' Fine. ',
      verdict: 'approve',
      findings: [{ severity: 'praise', category: 'testing', title: 'Nice', body: 'Good tests.' }]
    })
    expect(out.summary).toBe('Fine.')
    expect(out.verdict).toBe('approve')
    expect(out.findings).toHaveLength(1)
  })

  it('trims the briefing and omits it when missing or blank', () => {
    const withBriefing = normaliseReview({ summary: 'Clean.', verdict: 'approve', findings: [], briefing: '  - Adds a flag.\n- No migrations.  ' })
    expect(withBriefing?.briefing).toBe('- Adds a flag.\n- No migrations.')
    expect(normaliseReview({ summary: 'Clean.', verdict: 'approve', findings: [] })).not.toHaveProperty('briefing')
    expect(normaliseReview({ summary: 'Clean.', verdict: 'approve', findings: [], briefing: '   ' })).not.toHaveProperty('briefing')
    expect(normaliseReview({ summary: 'Clean.', verdict: 'approve', findings: [], briefing: { text: 'x' } })).not.toHaveProperty('briefing')
  })

  it('tolerates a missing findings array when a summary exists', () => {
    const out = normaliseReview({ summary: 'Clean.', verdict: 'approve' })
    expect(out).toEqual({ summary: 'Clean.', verdict: 'approve', findings: [] })
  })

  it('rejects objects that are neither a summary nor findings', () => {
    expect(normaliseReview({})).toBeUndefined()
    expect(normaliseReview({ foo: 1 })).toBeUndefined()
    expect(normaliseReview('nope')).toBeUndefined()
    expect(normaliseReview(null)).toBeUndefined()
  })
})
