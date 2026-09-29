/**
 * Turns a triaged round into the single markdown comment posted to the PR.
 * Only approved findings are included, ordered by severity and then file.
 */
import type { Finding, FindingSeverity, Mission, ReviewRound, Settings, Verdict } from './domain'
import { SEVERITY_ORDER, shortSha } from './domain'

export interface BuildCommentArgs {
  mission: Mission
  round: ReviewRound
  settings: Settings
  /** GitHub login of the person triaging; absent until the first poll. */
  login?: string
  /** The comment goes out without a triage stop; defaults to the mission's own setting. */
  autoPosted?: boolean
}

const SEVERITY_LABELS: Record<FindingSeverity, string> = {
  blocker: 'Blocker',
  major: 'Major',
  minor: 'Minor',
  nit: 'Nit',
  praise: 'Praise'
}

const VERDICT_LABELS: Record<Verdict, string> = {
  request_changes: '**Request changes**',
  approve: '**Looks good**',
  comment: '**Comments**'
}

function compareFindings(a: Finding, b: Finding): number {
  const bySeverity = SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity)
  if (bySeverity !== 0) return bySeverity
  if (a.file !== b.file) {
    if (a.file === undefined) return 1
    if (b.file === undefined) return -1
    return a.file.localeCompare(b.file)
  }
  return (a.line ?? Number.MAX_SAFE_INTEGER) - (b.line ?? Number.MAX_SAFE_INTEGER)
}

/** Approved findings in the order the comment numbers them, which is also how the author's reply refers to them. */
export function postedFindings(round: ReviewRound): Finding[] {
  return round.findings.filter((f) => f.decision === 'approved').sort(compareFindings)
}

function blobUrl(mission: Mission, headSha: string, file: string, line?: number): string {
  const { owner, name } = mission.pr.repo
  const path = file.split('/').map(encodeURIComponent).join('/')
  return `https://github.com/${owner}/${name}/blob/${headSha}/${path}${line ? `#L${line}` : ''}`
}

function findingMeta(mission: Mission, round: ReviewRound, f: Finding): string {
  const parts = [`**${SEVERITY_LABELS[f.severity]}**`, f.category]
  if (f.file) {
    const label = f.line ? `${f.file}:${f.line}` : f.file
    parts.push(`[${label}](${blobUrl(mission, round.headSha, f.file, f.line)})`)
  }
  // GitHub links `owner/name#123` on its own.
  if (f.relatedPr) parts.push(`relates to ${f.relatedPr}`)
  return parts.join(' · ')
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

function renderFinding(mission: Mission, round: ReviewRound, f: Finding, n: number): string[] {
  const lines = [`#### ${n}. ${oneLine(f.title)}`, findingMeta(mission, round, f), '', f.body.trim()]
  if (f.suggestion?.trim()) {
    lines.push('', '<details>', '<summary>Suggestion</summary>', '', f.suggestion.trim(), '', '</details>')
  }
  return lines
}

/** A table the author can copy into their reply, one row per numbered finding. */
function replyTemplate(round: ReviewRound, findings: Finding[]): string[] {
  const cell = (text: string) => oneLine(text).replace(/\|/g, '\\|')
  return [
    '<details>',
    '<summary>Reply template</summary>',
    '',
    '```markdown',
    `### Round ${round.index} findings: disposition`,
    '',
    '| # | Finding | Outcome |',
    '| --- | --- | --- |',
    ...findings.map((f, i) => `| ${i + 1} | ${cell(f.title)} | ${f.severity === 'praise' ? '—' : ''} |`),
    '```',
    '',
    '</details>'
  ]
}

/** Fills the signature template; unknown placeholders render as empty. */
export function renderSignature({ mission, round, settings, login, autoPosted }: BuildCommentArgs): string {
  const loadout = settings.loadouts.find((l) => l.id === mission.loadoutId)?.name ?? mission.loadoutId
  const slotId = mission.slotId ?? mission.preferredSlotId
  const reviewer = (slotId && settings.slots.find((s) => s.id === slotId)?.name) || 'a reviewer'
  const values: Record<string, string> = {
    type: loadout,
    loadout,
    reviewer,
    character: reviewer,
    login: login ?? '',
    approval: (autoPosted ?? mission.autoPost) ? 'Posted automatically' : `Findings approved by ${login ?? 'you'}`,
    round: String(round.index),
    sha: shortSha(round.headSha)
  }
  return settings.signature.replace(/\{(\w+)\}/g, (_, key: string) => values[key] ?? '').trim()
}

export function buildComment(args: BuildCommentArgs): string {
  const { mission, round, settings } = args
  const approved = postedFindings(round)
  const head = shortSha(round.headSha)
  const count = approved.length

  const lines: string[] = []
  lines.push(`### Review of ${head}${round.index > 1 ? ` · round ${round.index}` : ''}`)
  lines.push(`${VERDICT_LABELS[round.verdict]} · ${count} finding${count === 1 ? '' : 's'}`)
  lines.push('')
  lines.push(round.summary.trim())
  if (round.previousHeadSha) {
    lines.push('', `Follow-up on ${shortSha(round.previousHeadSha)} → ${head}.`)
  }

  if (count === 0) {
    lines.push('', 'No findings to report.')
  } else {
    approved.forEach((f, i) => lines.push('', ...renderFinding(mission, round, f, i + 1)))
  }

  const request = settings.replyRequest?.trim()
  if (request && approved.some((f) => f.severity !== 'praise')) {
    lines.push('', request, '', ...replyTemplate(round, approved))
  }

  const signature = renderSignature(args)
  // The blank line keeps '---' a rule rather than turning the line above into a heading.
  if (signature) lines.push('', '---', signature)

  return lines.join('\n') + '\n'
}
