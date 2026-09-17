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

function blobUrl(mission: Mission, headSha: string, file: string, line?: number): string {
  const { owner, name } = mission.pr.repo
  const path = file.split('/').map(encodeURIComponent).join('/')
  return `https://github.com/${owner}/${name}/blob/${headSha}/${path}${line ? `#L${line}` : ''}`
}

function findingHeader(mission: Mission, round: ReviewRound, f: Finding): string {
  const parts = [`**${SEVERITY_LABELS[f.severity]}**`, f.category]
  if (f.file) {
    const label = f.line ? `${f.file}:${f.line}` : f.file
    parts.push(`[${label}](${blobUrl(mission, round.headSha, f.file, f.line)})`)
  }
  // GitHub links `owner/name#123` on its own.
  if (f.relatedPr) parts.push(`relates to ${f.relatedPr}`)
  return parts.join(' · ')
}

function renderFinding(mission: Mission, round: ReviewRound, f: Finding): string[] {
  const lines = [findingHeader(mission, round, f), `**${f.title.trim()}**`, '', f.body.trim()]
  if (f.suggestion?.trim()) {
    lines.push('', '<details>', '<summary>Suggestion</summary>', '', f.suggestion.trim(), '', '</details>')
  }
  return lines
}

/** Fills the signature template; unknown placeholders render as empty. */
export function renderSignature({ mission, round, settings, login }: BuildCommentArgs): string {
  const loadout = settings.loadouts.find((l) => l.id === mission.loadoutId)?.name ?? mission.loadoutId
  const slotId = mission.slotId ?? mission.preferredSlotId
  const character = (slotId && settings.slots.find((s) => s.id === slotId)?.name) || 'a reviewer'
  const values: Record<string, string> = {
    loadout,
    character,
    login: login ?? '',
    approval: mission.autoPost ? 'Posted automatically' : `Findings approved by ${login ?? 'you'}`,
    round: String(round.index),
    sha: shortSha(round.headSha)
  }
  return settings.signature.replace(/\{(\w+)\}/g, (_, key: string) => values[key] ?? '').trim()
}

export function buildComment(args: BuildCommentArgs): string {
  const { mission, round } = args
  const approved = round.findings.filter((f) => f.decision === 'approved').sort(compareFindings)
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
    for (const f of approved) lines.push('', ...renderFinding(mission, round, f))
  }

  const signature = renderSignature(args)
  // The blank line keeps '---' a rule rather than turning the line above into a heading.
  if (signature) lines.push('', '---', signature)

  return lines.join('\n') + '\n'
}
