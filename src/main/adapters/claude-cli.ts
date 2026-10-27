/**
 * Runs `claude -p` inside the PR worktree and streams its progress into
 * activity events. The CLI is spawned through an injectable function so tests
 * never touch the real binary.
 */
import { spawn as nodeSpawn } from 'node:child_process'
import { homedir } from 'node:os'
import { isAbsolute } from 'node:path'
import type { Activity, Settings } from '@core/domain'
import { expandHome } from '@core/engine/paths'
import type { ReviewRequest, ReviewResult, RunnerPort, WorkspaceContext } from '@core/ports'
import { approachChecked, buildReviewPrompt } from '@core/review/prompt'
import { MissingFindingsError, envelopeMeta, parseReviewOutput } from '@core/review/parse'
import { REPORT_FINDINGS_TOOL, carriesFindings, reviewFromReportFindings } from '@core/review/report-findings'
import { reviewJsonSchema } from '@core/review/schema'
import { resolveClaudePath } from '../environment'
import { KILL_GRACE_MS, REVIEW_TIMEOUT_MS, deltaDiff, describeExit, driveStreamJson, isRecord, relativeTo, str, type ChildLike, type SpawnFn } from './cli-process'
import { exec as defaultExec } from './exec'
import type { ExecFn } from './exec'

export { DELTA_DIFF_TIMEOUT_MS, KILL_GRACE_MS, REVIEW_TIMEOUT_MS } from './cli-process'
export type { ChildLike, SpawnFn, SpawnOpts } from './cli-process'

export const ALLOWED_TOOLS: readonly string[] = [
  'Read',
  'Grep',
  'Glob',
  'LS',
  'Bash(git diff:*)',
  'Bash(git log:*)',
  'Bash(git show:*)',
  'Bash(git blame:*)',
  'Bash(git status:*)',
  'Bash(gh pr diff:*)',
  'Bash(gh pr view:*)'
]

/** Git the reviewer may run against a sibling checkout; fetch only touches remote-tracking refs. */
export const SIBLING_GIT_COMMANDS: readonly string[] = ['fetch', 'show', 'log', 'diff', 'grep', 'ls-files']

/** What a workspace review may use on top of ALLOWED_TOOLS: PR listing and git on each sibling checkout. */
export function workspaceTools(workspace?: WorkspaceContext): string[] {
  if (!workspace) return []
  const tools = ['Bash(gh pr list:*)']
  for (const sibling of workspace.siblings) {
    if (!sibling.path) continue
    for (const command of SIBLING_GIT_COMMANDS) tools.push(`Bash(git -C ${sibling.path} ${command}:*)`)
  }
  return tools
}

/** Precedes the review prompt when a loadout overrides the message, which is usually written for an interactive session. */
export const HEADLESS_PREAMBLE =
  'You are being run headless by a desktop app. Do not post to GitHub, do not use --comment or --fix, do not edit files. When the skill finishes, return the findings through the structured output schema. If you use a skill, run it inside this conversation and, when it is done, return the review through the structured output; the ReportFindings tool is optional and the app will read it if you call it.'

const THINKING_PREVIEW_CHARS = 100

export interface ClaudeCliRunnerOptions {
  spawn?: SpawnFn
  /** Runs git for follow-up deltas and the lookups that resolve a bare claudePath. */
  exec?: ExecFn
  /** Base environment for the child; defaults to process.env. */
  env?: NodeJS.ProcessEnv
  timeoutMs?: number
  killGraceMs?: number
}

type ActivityLite = Omit<Activity, 'missionId' | 'at'>

export function renderSlashCommand(command: string, prNumber: number): string {
  return command.replaceAll('{number}', String(prNumber)).trim()
}

export interface ClaudeArgsOptions {
  appendSystemPrompt?: string
  workspace?: WorkspaceContext
  /** Whether this run judges the approach, which puts the verdict into the schema. */
  approach: boolean
}

export function buildClaudeArgs(settings: Settings, { appendSystemPrompt, workspace, approach }: ClaudeArgsOptions): string[] {
  const args = [
    '-p',
    '--output-format',
    'stream-json',
    '--verbose',
    '--no-session-persistence',
    // The PR branch is untrusted: its .claude/settings.json hooks and
    // permissions and its .mcp.json must never run. CLAUDE.md still loads.
    '--setting-sources',
    'user',
    '--strict-mcp-config',
    '--json-schema',
    JSON.stringify(reviewJsonSchema({ approach }))
  ]
  // The container holds the sibling checkouts and the cross-repo CLAUDE.md.
  if (workspace?.rootPath) args.push('--add-dir', workspace.rootPath)
  if (Number.isFinite(settings.maxBudgetUsdPerReview) && settings.maxBudgetUsdPerReview > 0) {
    args.push('--max-budget-usd', String(settings.maxBudgetUsdPerReview))
  }
  args.push('--allowedTools', ...ALLOWED_TOOLS, ...workspaceTools(workspace))
  if (settings.claudeModel) args.push('--model', settings.claudeModel)
  if (settings.claudeFallbackModel) args.push('--fallback-model', settings.claudeFallbackModel)
  if (settings.claudeEffort) args.push('--effort', settings.claudeEffort)
  if (appendSystemPrompt) args.push('--append-system-prompt', appendSystemPrompt)
  return args
}

/** The model id the CLI announces in its init event; undefined for any other event. */
export function initModel(event: Record<string, unknown>): string | undefined {
  if (event['type'] !== 'system' || event['subtype'] !== 'init') return undefined
  return str(event['model']) || undefined
}

/** The model a result event names: its `model` field, else the entry of `modelUsage` that carried the spend. */
export function resultModel(event: Record<string, unknown>): string | undefined {
  const named = str(event['model'])
  if (named) return named
  const usage = event['modelUsage']
  if (!isRecord(usage)) return undefined
  let best: string | undefined
  let bestCost = -1
  for (const [model, stats] of Object.entries(usage)) {
    const cost = isRecord(stats) && typeof stats['costUSD'] === 'number' ? stats['costUSD'] : 0
    if (cost > bestCost) {
      best = model
      bestCost = cost
    }
  }
  return best
}

function toolActivity(name: string, input: Record<string, unknown>, worktreePath: string): ActivityLite {
  switch (name) {
    case 'Read':
      return { kind: 'reading', text: relativeTo(worktreePath, str(input['file_path'])) || name }
    case 'Glob':
      return { kind: 'reading', text: str(input['pattern']) || name }
    case 'LS':
      return { kind: 'reading', text: relativeTo(worktreePath, str(input['path'])) || '.' }
    case 'Grep':
      return { kind: 'searching', text: str(input['pattern']) || name }
    case 'Bash':
      return { kind: 'running', text: str(input['command']) || name }
    case 'StructuredOutput':
      return { kind: 'writing', text: 'Writing findings' }
    case REPORT_FINDINGS_TOOL:
      return { kind: 'writing', text: 'Reporting findings' }
    default:
      return { kind: 'running', text: name }
  }
}

/** The input of a tool call whose payload can replace a missing structured output; undefined for other events. */
function findingsToolInput(event: Record<string, unknown>): Record<string, unknown> | undefined {
  if (event['type'] !== 'assistant') return undefined
  const message = event['message']
  if (!isRecord(message) || !Array.isArray(message['content'])) return undefined
  let found: Record<string, unknown> | undefined
  for (const block of message['content']) {
    if (isRecord(block) && block['type'] === 'tool_use' && typeof block['name'] === 'string' && carriesFindings(block['name'], block['input'])) {
      found = block['input']
    }
  }
  return found
}

/** Activities implied by one stream-json event; empty for events the HUD does not show. */
export function activitiesFromEvent(event: Record<string, unknown>, worktreePath: string): ActivityLite[] {
  if (event['type'] !== 'assistant') return []
  const message = event['message']
  if (!isRecord(message) || !Array.isArray(message['content'])) return []
  const out: ActivityLite[] = []
  for (const block of message['content']) {
    if (!isRecord(block)) continue
    if (block['type'] === 'text') {
      const text = str(block['text']).replace(/\s+/g, ' ').trim()
      if (text) out.push({ kind: 'thinking', text: text.slice(0, THINKING_PREVIEW_CHARS) })
    } else if (block['type'] === 'tool_use' && typeof block['name'] === 'string') {
      const input = block['input']
      out.push(toolActivity(block['name'], isRecord(input) ? input : {}, worktreePath))
    }
  }
  return out
}

export class ClaudeCliRunner implements RunnerPort {
  private readonly spawn: SpawnFn
  private readonly exec: ExecFn
  private readonly baseEnv: NodeJS.ProcessEnv
  private readonly timeoutMs: number
  private readonly killGraceMs: number

  constructor(opts: ClaudeCliRunnerOptions = {}) {
    this.spawn = opts.spawn ?? nodeSpawn
    this.exec = opts.exec ?? defaultExec
    this.baseEnv = opts.env ?? process.env
    this.timeoutMs = opts.timeoutMs ?? REVIEW_TIMEOUT_MS
    this.killGraceMs = opts.killGraceMs ?? KILL_GRACE_MS
  }

  async review(req: ReviewRequest): Promise<ReviewResult> {
    if (req.signal?.aborted) throw new Error('Cancelled')
    const diff = req.diff.trim() ? req.diff : await deltaDiff(this.exec, req)
    const reviewPrompt = buildReviewPrompt({ ...req, diff })
    const slash = req.loadout.slashCommand ? renderSlashCommand(req.loadout.slashCommand, req.mission.pr.number) : ''
    const prompt = slash || reviewPrompt
    const args = buildClaudeArgs(req.settings, { appendSystemPrompt: slash ? `${HEADLESS_PREAMBLE}\n\n${reviewPrompt}` : undefined, workspace: req.workspace, approach: approachChecked(req) })
    const env: NodeJS.ProcessEnv = { ...this.baseEnv }
    // The CLI refuses to run nested inside another Claude Code session.
    delete env['CLAUDECODE']
    delete env['CLAUDE_CODE_ENTRYPOINT']
    const command = await this.resolveCommand(req.settings.claudePath)
    if (req.signal?.aborted) throw new Error('Cancelled')
    const child = this.spawn(command, args, {
      cwd: req.worktreePath,
      env,
      stdio: 'pipe',
      windowsHide: true
    })
    return this.drive(child, req, prompt, command)
  }

  private async resolveCommand(claudePath: string): Promise<string> {
    const command = expandHome(claudePath, homedir())
    if (isAbsolute(command)) return command
    try {
      return await resolveClaudePath(command, { exec: this.exec, env: this.baseEnv })
    } catch {
      return command
    }
  }

  private async drive(child: ChildLike, req: ReviewRequest, prompt: string, command: string): Promise<ReviewResult> {
    let outcome: { ok: ReviewResult } | { err: Error } | undefined
    let reported: Record<string, unknown> | undefined
    let model: string | undefined
    const emit = (a: ActivityLite) => req.onActivity?.(a)

    const onEvent = (event: Record<string, unknown>) => {
      if (event['type'] === 'result') {
        try {
          outcome = { ok: parseReviewOutput(event, { strict: true }) }
        } catch (e) {
          // A skill that reported through ReportFindings leaves the result without a payload; the call is the review.
          if (e instanceof MissingFindingsError && reported) outcome = { ok: reviewFromReportFindings(reported, envelopeMeta(event)) }
          else outcome = { err: e instanceof Error ? e : new Error(String(e)) }
        }
        const resolved = model ?? resultModel(event)
        if (resolved && 'ok' in outcome) outcome.ok.model = resolved
        return
      }
      if (model === undefined) {
        model = initModel(event)
        if (model) req.onModel?.(model)
      }
      reported = findingsToolInput(event) ?? reported
      for (const a of activitiesFromEvent(event, req.worktreePath)) emit(a)
    }

    const run = driveStreamJson(child, { command, prompt, signal: req.signal, timeoutMs: this.timeoutMs, killGraceMs: this.killGraceMs, onEvent })
    emit({ kind: 'thinking', text: 'Starting Claude Code' })
    const exit = await run
    const tail = exit.stderrTail
    if (outcome && 'err' in outcome) {
      if (tail) outcome.err.message += `\n\nLast stderr lines:\n${tail}`
      throw outcome.err
    }
    if (outcome) return outcome.ok
    throw new Error(`claude exited ${describeExit(exit)}${tail ? `: ${tail}` : ''}`)
  }
}
