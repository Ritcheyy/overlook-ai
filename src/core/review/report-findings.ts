/**
 * Claude Code's built-in code-review skill hands its findings to the host
 * through a `ReportFindings` tool call, which an interactive session shows in
 * a panel. Headless, that call's input is the only copy of the review when
 * the final result carries no structured output, so it is rebuilt from here.
 */
import type { FindingCategory, FindingSeverity, RawFinding } from '../domain'
import type { ReviewResult } from '../ports'
import { truncateRawOutput } from './parse'
import { coerceFile, coerceLine, coerceVerdict, firstLine, normaliseFinding } from './schema'

export const REPORT_FINDINGS_TOOL = 'ReportFindings'

const CATEGORY_BY_SLUG: Record<string, FindingCategory> = {
  correctness: 'correctness',
  security: 'security',
  efficiency: 'performance',
  performance: 'performance',
  simplification: 'maintainability',
  maintainability: 'maintainability',
  reuse: 'maintainability',
  'test-coverage': 'testing',
  testing: 'testing'
}

const SEVERITY_BY_VERDICT: Record<string, FindingSeverity> = {
  confirmed: 'major',
  plausible: 'minor'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

/** Whether a tool call's input can stand in for a missing structured output. */
export function carriesFindings(name: string, input: unknown): input is Record<string, unknown> {
  if (!isRecord(input)) return false
  if (name === REPORT_FINDINGS_TOOL) return true
  return name === 'StructuredOutput' && Array.isArray(input['findings'])
}

function fromSkillItem(item: Record<string, unknown>): RawFinding | undefined {
  const summary = text(item['summary'])
  const short = text(item['short_summary'])
  if (!summary && !short) return undefined
  const scenario = text(item['failure_scenario'])
  const finding: RawFinding = {
    severity: SEVERITY_BY_VERDICT[text(item['verdict']).toLowerCase()] ?? 'minor',
    category: CATEGORY_BY_SLUG[text(item['category']).toLowerCase()] ?? 'other',
    title: short || firstLine(summary),
    body: `${summary || short}${scenario ? `\n\nFailure scenario: ${scenario}` : ''}`
  }
  const file = coerceFile(item['file'])
  const line = coerceLine(item['line'])
  if (file) finding.file = file
  if (line !== undefined) finding.line = line
  return finding
}

function toFinding(item: unknown): RawFinding | undefined {
  if (!isRecord(item)) return undefined
  // A StructuredOutput call already uses the app's own schema.
  if ('title' in item || 'body' in item) return normaliseFinding(item)
  return fromSkillItem(item)
}

export function reviewFromReportFindings(
  input: Record<string, unknown>,
  meta: { costUsd?: number; durationMs?: number } = {}
): ReviewResult {
  const items = Array.isArray(input['findings']) ? input['findings'] : []
  const findings = items.map(toFinding).filter((f): f is RawFinding => f !== undefined)
  const ownSummary = text(input['summary'])
  const result: ReviewResult = {
    findings,
    summary: ownSummary || `${findings.length} finding${findings.length === 1 ? '' : 's'} reported by Claude Code's review skill.`,
    verdict: typeof input['verdict'] === 'string' ? coerceVerdict(input['verdict']) : findings.length > 0 ? 'request_changes' : 'comment',
    rawOutput: truncateRawOutput(JSON.stringify(input, null, 2))
  }
  const briefing = text(input['briefing'])
  if (briefing) result.briefing = briefing
  if (meta.costUsd !== undefined) result.costUsd = meta.costUsd
  if (meta.durationMs !== undefined) result.durationMs = meta.durationMs
  return result
}
