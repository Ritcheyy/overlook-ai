/**
 * Turns whatever `claude -p` printed into a ReviewResult. Accepts the final
 * stream-json result envelope (object or JSON string), a bare review object,
 * or free text with the JSON somewhere inside it.
 */
import type { RawFinding } from '../domain'
import type { ReviewResult } from '../ports'
import { normaliseReview, type ReviewOutput } from './schema'

export const NO_FINDINGS_SUMMARY = 'The reviewer returned no parseable findings.'
const FALLBACK_SUMMARY_CHARS = 2000
const MAX_RAW_OUTPUT_CHARS = 100_000
const FINAL_MESSAGE_CHARS = 200

export interface ParseOptions {
  /**
   * Throw instead of returning a findings-free result when no review can be
   * found. The CLI runner asks for this: it requested a schema, so a missing
   * payload means the review never happened, not that the change was clean.
   */
  strict?: boolean
}

/** Cost and duration ride along so a failed round can still account for the money spent. */
export class MissingFindingsError extends Error {
  costUsd?: number
  durationMs?: number

  constructor(message: string, meta: { costUsd?: number; durationMs?: number } = {}) {
    super(message)
    this.name = 'MissingFindingsError'
    if (meta.costUsd !== undefined) this.costUsd = meta.costUsd
    if (meta.durationMs !== undefined) this.durationMs = meta.durationMs
  }
}

export interface ResultEnvelope {
  type?: unknown
  subtype?: unknown
  is_error?: unknown
  result?: unknown
  structured_output?: unknown
  total_cost_usd?: unknown
  duration_ms?: unknown
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function looksLikeEnvelope(value: Record<string, unknown>): boolean {
  return (
    value['type'] === 'result' ||
    'structured_output' in value ||
    'is_error' in value ||
    (typeof value['result'] === 'string' && !('findings' in value))
  )
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}\n… (truncated)` : text
}

/** Caps what is stored as a round's raw output. */
export function truncateRawOutput(text: string): string {
  return truncate(text, MAX_RAW_OUTPUT_CHARS)
}

/** structured_output is normally an object, but a JSON string of it must not lose the review. */
function structuredRecord(value: unknown): Record<string, unknown> | undefined {
  if (isRecord(value)) return value
  if (typeof value !== 'string') return undefined
  try {
    const parsed: unknown = JSON.parse(value)
    return isRecord(parsed) ? parsed : undefined
  } catch {
    return undefined
  }
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

/** The cost and duration a result envelope reports. */
export function envelopeMeta(envelope: ResultEnvelope): { costUsd?: number; durationMs?: number } {
  const meta: { costUsd?: number; durationMs?: number } = {}
  const costUsd = numberOrUndefined(envelope.total_cost_usd)
  const durationMs = numberOrUndefined(envelope.duration_ms)
  if (costUsd !== undefined) meta.costUsd = costUsd
  if (durationMs !== undefined) meta.durationMs = durationMs
  return meta
}

function finishBrace(text: string, start: number): number {
  let depth = 0
  let inString = false
  for (let i = start; i < text.length; i++) {
    const c = text[i]
    if (inString) {
      if (c === '\\') i++
      else if (c === '"') inString = false
      continue
    }
    if (c === '"') inString = true
    else if (c === '{') depth++
    else if (c === '}') {
      depth--
      if (depth === 0) return i
    }
  }
  return -1
}

function* jsonCandidates(text: string): Generator<string> {
  const fence = /```(?:json|JSON)?[ \t]*\r?\n([\s\S]*?)```/g
  let m: RegExpExecArray | null
  while ((m = fence.exec(text)) !== null) yield m[1].trim()

  let i = 0
  while ((i = text.indexOf('{', i)) !== -1) {
    const end = finishBrace(text, i)
    if (end !== -1) yield text.slice(i, end + 1)
    i++
  }
}

/** Finds the first JSON object in free text that validates as a review. */
export function extractReviewFromText(text: string): ReviewOutput | undefined {
  for (const candidate of jsonCandidates(text)) {
    let parsed: unknown
    try {
      parsed = JSON.parse(candidate)
    } catch {
      continue
    }
    const review = normaliseReview(parsed)
    if (review) return review
  }
  return undefined
}

function defaultSummary(findings: RawFinding[]): string {
  if (findings.length === 0) return 'No summary provided; the reviewer reported no findings.'
  return `No summary provided; the reviewer reported ${findings.length} finding${findings.length === 1 ? '' : 's'}.`
}

interface Meta {
  rawOutput?: string
  costUsd?: number
  durationMs?: number
}

function toResult(review: ReviewOutput, meta: Meta): ReviewResult {
  const result: ReviewResult = {
    findings: review.findings,
    summary: review.summary || defaultSummary(review.findings),
    verdict: review.verdict
  }
  if (review.briefing) result.briefing = review.briefing
  if (meta.rawOutput !== undefined) result.rawOutput = meta.rawOutput
  if (meta.costUsd !== undefined) result.costUsd = meta.costUsd
  if (meta.durationMs !== undefined) result.durationMs = meta.durationMs
  return result
}

function missingFindings(text: string, meta: Meta): MissingFindingsError {
  const trimmed = text.trim()
  const quoted = trimmed
    ? `Its final message was: "${trimmed.length > FINAL_MESSAGE_CHARS ? `${trimmed.slice(0, FINAL_MESSAGE_CHARS)}…` : trimmed}".`
    : 'Its final message was empty.'
  const cost = meta.costUsd !== undefined ? ` Estimated cost $${meta.costUsd.toFixed(2)}.` : ''
  return new MissingFindingsError(
    `Claude finished without a findings payload. ${quoted} A slash command that runs its own flow does this; use the plain prompt for this loadout.${cost}`,
    meta
  )
}

function fallback(text: string, meta: Meta, strict: boolean): ReviewResult {
  if (strict) throw missingFindings(text, meta)
  const trimmed = text.trim()
  return toResult(
    {
      findings: [],
      summary: trimmed.length > 0 ? trimmed.slice(0, FALLBACK_SUMMARY_CHARS) : NO_FINDINGS_SUMMARY,
      verdict: 'comment'
    },
    meta
  )
}

function parseEnvelope(envelope: ResultEnvelope, strict: boolean): ReviewResult {
  const subtype = typeof envelope.subtype === 'string' ? envelope.subtype : ''
  const resultText = typeof envelope.result === 'string' ? envelope.result : ''
  if (envelope.is_error === true || subtype.startsWith('error')) {
    throw new Error(resultText.trim() || `claude failed${subtype ? ` (${subtype})` : ''}`)
  }

  const structured = structuredRecord(envelope.structured_output)
  const meta: Meta = envelopeMeta(envelope)
  const structuredJson = structured ? JSON.stringify(structured, null, 2) : ''

  if (structured) {
    const review = normaliseReview(structured)
    // In structured mode the result text is usually a one-line sign-off; the JSON is the review.
    if (review) return toResult(review, { ...meta, rawOutput: truncate(structuredJson, MAX_RAW_OUTPUT_CHARS) })
  }
  meta.rawOutput = truncate(resultText.trim() || structuredJson, MAX_RAW_OUTPUT_CHARS)
  if (!meta.rawOutput) delete meta.rawOutput

  const fromText = extractReviewFromText(resultText)
  if (fromText) return toResult(fromText, meta)
  return fallback(resultText, meta, strict)
}

export function parseReviewOutput(input: string | object, options: ParseOptions = {}): ReviewResult {
  const strict = options.strict === true
  if (typeof input === 'string') {
    let parsed: unknown
    try {
      parsed = JSON.parse(input)
    } catch {
      parsed = undefined
    }
    if (isRecord(parsed)) return parseReviewOutput(parsed, options)
    const fromText = extractReviewFromText(input)
    const meta: Meta = { rawOutput: truncate(input.trim(), MAX_RAW_OUTPUT_CHARS) }
    return fromText ? toResult(fromText, meta) : fallback(input, meta, strict)
  }

  if (!isRecord(input)) {
    return fallback('', { rawOutput: truncate(JSON.stringify(input) ?? '', MAX_RAW_OUTPUT_CHARS) }, strict)
  }
  if (looksLikeEnvelope(input)) return parseEnvelope(input as ResultEnvelope, strict)

  const rawOutput = truncate(JSON.stringify(input, null, 2), MAX_RAW_OUTPUT_CHARS)
  const review = normaliseReview(input)
  return review ? toResult(review, { rawOutput }) : fallback(rawOutput, { rawOutput }, strict)
}
