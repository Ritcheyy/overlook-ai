/**
 * The shape the reviewer must produce. `REVIEW_JSON_SCHEMA` is handed to
 * `claude --json-schema` so the CLI enforces it; the zod schema re-validates
 * whatever comes back and coerces the sloppy variants a model still emits
 * (mixed-case enums, "./" paths, string line numbers). Structured outputs
 * reject range keywords (minimum, maxLength, pattern...), so limits live in
 * the descriptions and are enforced by the coercions below.
 */
import { z } from 'zod'
import type { FindingCategory, FindingSeverity, RawFinding, Verdict } from '../domain'

export const SEVERITIES: readonly FindingSeverity[] = ['blocker', 'major', 'minor', 'nit', 'praise']
export const CATEGORIES: readonly FindingCategory[] = [
  'correctness',
  'security',
  'performance',
  'maintainability',
  'testing',
  'product',
  'style',
  'integration',
  'other'
]
export const VERDICTS: readonly Verdict[] = ['approve', 'request_changes', 'comment']

export const REVIEW_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'verdict', 'findings', 'briefing'],
  properties: {
    summary: {
      type: 'string',
      description: 'Two or three sentences: the overall assessment and the most important issue, if any.'
    },
    briefing: {
      type: 'string',
      description:
        'Markdown, at most about 120 words, for a reviewer who has not read the PR: what it does and why, what it introduces or changes, the decisions made, and anything to know before merging. Not the findings.'
    },
    verdict: {
      type: 'string',
      enum: VERDICTS,
      description: 'request_changes when a blocker or major finding exists, approve when clean, comment otherwise.'
    },
    findings: {
      type: 'array',
      description: 'One entry per distinct problem. Empty when the change is clean.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['severity', 'category', 'title', 'body'],
        properties: {
          severity: { type: 'string', enum: SEVERITIES },
          category: { type: 'string', enum: CATEGORIES },
          title: { type: 'string', description: 'One line, under 80 characters.' },
          body: { type: 'string', description: 'Markdown. The why and the evidence. No headings.' },
          file: { type: 'string', description: 'Path relative to the repository root.' },
          line: { type: 'integer', description: '1-based line in the PR head; omit when unknown.' },
          suggestion: {
            type: 'string',
            description: 'Markdown, usually a fenced code block with the proposed change.'
          },
          related_pr: {
            type: 'string',
            description: 'owner/name#123 of an open pull request in another repository this finding depends on; omit otherwise.'
          }
        }
      }
    }
  }
}

export interface ReviewOutput {
  summary: string
  verdict: Verdict
  findings: RawFinding[]
  briefing?: string
}

const SEVERITY_ALIASES: Record<string, FindingSeverity> = {
  critical: 'blocker',
  blocking: 'blocker',
  high: 'major',
  important: 'major',
  medium: 'minor',
  moderate: 'minor',
  low: 'nit',
  trivial: 'nit',
  info: 'nit',
  suggestion: 'nit',
  kudos: 'praise',
  positive: 'praise'
}

const CATEGORY_ALIASES: Record<string, FindingCategory> = {
  bug: 'correctness',
  logic: 'correctness',
  perf: 'performance',
  test: 'testing',
  tests: 'testing',
  readability: 'maintainability',
  design: 'maintainability',
  architecture: 'maintainability',
  ux: 'product',
  cross_repo: 'integration',
  compatibility: 'integration',
  contract: 'integration',
  formatting: 'style',
  naming: 'style',
  docs: 'other',
  documentation: 'other'
}

const VERDICT_ALIASES: Record<string, Verdict> = {
  approved: 'approve',
  lgtm: 'approve',
  changes_requested: 'request_changes',
  request_change: 'request_changes',
  needs_changes: 'request_changes',
  comments: 'comment',
  neutral: 'comment'
}

function slug(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase().replace(/[\s-]+/g, '_') : ''
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function coerceSeverity(value: unknown): FindingSeverity {
  const s = slug(value)
  if ((SEVERITIES as readonly string[]).includes(s)) return s as FindingSeverity
  return SEVERITY_ALIASES[s] ?? 'minor'
}

export function coerceCategory(value: unknown): FindingCategory {
  const s = slug(value)
  if ((CATEGORIES as readonly string[]).includes(s)) return s as FindingCategory
  return CATEGORY_ALIASES[s] ?? 'other'
}

export function coerceVerdict(value: unknown): Verdict {
  const s = slug(value)
  if ((VERDICTS as readonly string[]).includes(s)) return s as Verdict
  return VERDICT_ALIASES[s] ?? 'comment'
}

export function coerceLine(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) && value >= 1 ? Math.trunc(value) : undefined
  if (typeof value === 'string') {
    const m = /^\s*L?(\d+)/.exec(value)
    if (m) {
      const n = Number(m[1])
      return n >= 1 ? n : undefined
    }
  }
  return undefined
}

export function coerceFile(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  let file = value.trim()
  while (file.startsWith('./')) file = file.slice(2)
  return file.length > 0 ? file : undefined
}

/** `owner/name#123`; anything else is dropped rather than posted as a broken link. */
export const RELATED_PR_PATTERN = /^[\w.-]+\/[\w.-]+#\d+$/

export function coerceRelatedPr(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const ref = value.trim()
  return RELATED_PR_PATTERN.test(ref) ? ref : undefined
}

function coerceText(value: unknown): string | undefined {
  if (typeof value === 'string') {
    const t = value.trim()
    return t.length > 0 ? t : undefined
  }
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return undefined
}

export function normaliseFinding(value: unknown): RawFinding | undefined {
  if (!isRecord(value)) return undefined
  const title = coerceText(value['title'])
  const body = coerceText(value['body']) ?? coerceText(value['description']) ?? coerceText(value['message'])
  if (!title && !body) return undefined

  let file = coerceFile(value['file'] ?? value['path'])
  let line = coerceLine(value['line'])
  // Models sometimes fold the line into the path ("src/a.ts:42").
  if (file && line === undefined) {
    const m = /^(.+?):(\d+)(?:[-:]\d+)?$/.exec(file)
    if (m) {
      file = m[1]
      line = coerceLine(m[2])
    }
  }

  const finding: RawFinding = {
    severity: coerceSeverity(value['severity']),
    category: coerceCategory(value['category']),
    title: title ?? firstLine(body ?? ''),
    body: body ?? ''
  }
  if (file) finding.file = file
  if (line !== undefined) finding.line = line
  const suggestion = coerceText(value['suggestion'])
  if (suggestion) finding.suggestion = suggestion
  const relatedPr = coerceRelatedPr(value['related_pr'] ?? value['relatedPr'])
  if (relatedPr) finding.relatedPr = relatedPr
  return finding
}

/** The first line of a body, cut to fit a finding title. */
export function firstLine(text: string): string {
  const line = text.split('\n')[0].trim()
  return line.length > 80 ? `${line.slice(0, 77)}...` : line
}

export function normaliseFindings(value: unknown): RawFinding[] {
  if (!Array.isArray(value)) return []
  return value.map(normaliseFinding).filter((f): f is RawFinding => f !== undefined)
}

export const reviewOutputSchema = z
  .object({
    summary: z.unknown(),
    verdict: z.unknown(),
    findings: z.unknown(),
    briefing: z.unknown()
  })
  .superRefine((v, ctx) => {
    if (typeof v.summary !== 'string' && !Array.isArray(v.findings)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'expected a summary string or a findings array' })
    }
  })
  .transform((v): ReviewOutput => {
    const out: ReviewOutput = {
      summary: coerceText(v.summary) ?? '',
      verdict: coerceVerdict(v.verdict),
      findings: normaliseFindings(v.findings)
    }
    const briefing = coerceText(v.briefing)
    if (briefing) out.briefing = briefing
    return out
  })

/** Validates and coerces a candidate review object; undefined when it is not one. */
export function normaliseReview(value: unknown): ReviewOutput | undefined {
  const result = reviewOutputSchema.safeParse(value)
  return result.success ? result.data : undefined
}
