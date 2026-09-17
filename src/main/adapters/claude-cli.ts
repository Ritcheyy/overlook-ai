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
import { MAX_INLINE_DIFF_CHARS, buildReviewPrompt } from '@core/review/prompt'
import { MissingFindingsError, envelopeMeta, parseReviewOutput } from '@core/review/parse'
import { REPORT_FINDINGS_TOOL, carriesFindings, reviewFromReportFindings } from '@core/review/report-findings'
import { REVIEW_JSON_SCHEMA } from '@core/review/schema'
import { resolveClaudePath } from '../environment'
import { exec as defaultExec } from './exec'
import type { ExecFn } from './exec'

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

export const REVIEW_TIMEOUT_MS = 30 * 60_000
export const KILL_GRACE_MS = 5_000
export const DELTA_DIFF_TIMEOUT_MS = 20_000
const STDERR_TAIL_LINES = 20
const GIT_ENV = { GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' }
const THINKING_PREVIEW_CHARS = 100

export interface SpawnOpts {
  cwd: string
  env: NodeJS.ProcessEnv
  stdio: 'pipe'
  windowsHide: boolean
}

/** The slice of ChildProcess the runner relies on; fakes implement just this. */
export interface ChildLike {
  pid?: number
  stdin: NodeJS.WritableStream | null
  stdout: NodeJS.ReadableStream | null
  stderr: NodeJS.ReadableStream | null
  kill(signal?: NodeJS.Signals): boolean
  on(event: 'close', listener: (code: number | null, signal: NodeJS.Signals | null) => void): this
  on(event: 'error', listener: (err: Error) => void): this
}

export type SpawnFn = (command: string, args: string[], opts: SpawnOpts) => ChildLike

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

export function renderSlashCommand(command: string, prNumber: number): string {
  return command.replaceAll('{number}', String(prNumber)).trim()
}

export function buildClaudeArgs(settings: Settings, appendSystemPrompt?: string, workspace?: WorkspaceContext): string[] {
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
    JSON.stringify(REVIEW_JSON_SCHEMA)
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

function relativeTo(root: string, path: string): string {
  const base = root.endsWith('/') ? root : `${root}/`
  return path.startsWith(base) ? path.slice(base.length) : path
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
    const diff = req.diff.trim() ? req.diff : await this.deltaDiff(req)
    const reviewPrompt = buildReviewPrompt({ ...req, diff })
    const slash = req.loadout.slashCommand ? renderSlashCommand(req.loadout.slashCommand, req.mission.pr.number) : ''
    const prompt = slash || reviewPrompt
    const args = buildClaudeArgs(req.settings, slash ? `${HEADLESS_PREAMBLE}\n\n${reviewPrompt}` : undefined, req.workspace)
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

  /** The changes since the previous round, or '' when git cannot produce them or they are too big to inline. */
  private async deltaDiff(req: ReviewRequest): Promise<string> {
    const previous = req.previousRound?.headSha
    if (!previous) return ''
    try {
      const res = await this.exec('git', ['-C', req.worktreePath, 'diff', `${previous}..HEAD`], {
        env: GIT_ENV,
        signal: req.signal,
        timeoutMs: DELTA_DIFF_TIMEOUT_MS
      })
      if (res.code !== 0 || res.stdout.length >= MAX_INLINE_DIFF_CHARS) return ''
      return res.stdout
    } catch {
      return ''
    }
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

  private drive(child: ChildLike, req: ReviewRequest, prompt: string, command: string): Promise<ReviewResult> {
    return new Promise<ReviewResult>((resolve, reject) => {
      let settled = false
      let aborted = false
      let timedOut = false
      let outcome: { ok: ReviewResult } | { err: Error } | undefined
      let reported: Record<string, unknown> | undefined
      let model: string | undefined
      let stdoutRest = ''
      const stderrTail: string[] = []
      let killTimer: NodeJS.Timeout | undefined

      const emit = (a: ActivityLite) => req.onActivity?.(a)

      const kill = () => {
        child.kill('SIGTERM')
        killTimer = setTimeout(() => child.kill('SIGKILL'), this.killGraceMs)
      }
      const onAbort = () => {
        aborted = true
        kill()
      }
      const timeout = setTimeout(() => {
        timedOut = true
        kill()
      }, this.timeoutMs)
      req.signal?.addEventListener('abort', onAbort, { once: true })

      const cleanup = () => {
        clearTimeout(timeout)
        if (killTimer) clearTimeout(killTimer)
        req.signal?.removeEventListener('abort', onAbort)
      }
      const finish = (fn: () => void) => {
        if (settled) return
        settled = true
        cleanup()
        fn()
      }

      const handleLine = (line: string) => {
        const trimmed = line.trim()
        if (!trimmed) return
        let event: unknown
        try {
          event = JSON.parse(trimmed)
        } catch {
          return
        }
        if (!isRecord(event)) return
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
        model ??= initModel(event)
        reported = findingsToolInput(event) ?? reported
        for (const a of activitiesFromEvent(event, req.worktreePath)) emit(a)
      }
      const flushStdout = () => {
        let nl: number
        while ((nl = stdoutRest.indexOf('\n')) !== -1) {
          handleLine(stdoutRest.slice(0, nl))
          stdoutRest = stdoutRest.slice(nl + 1)
        }
      }

      child.stdout?.setEncoding('utf8')
      child.stdout?.on('data', (chunk: string | Buffer) => {
        stdoutRest += chunk.toString()
        flushStdout()
      })
      child.stderr?.setEncoding('utf8')
      child.stderr?.on('data', (chunk: string | Buffer) => {
        for (const line of chunk.toString().split('\n')) {
          if (!line.trim()) continue
          stderrTail.push(line.trimEnd())
          if (stderrTail.length > STDERR_TAIL_LINES) stderrTail.shift()
        }
      })

      child.on('error', (err) => {
        finish(() => reject(new Error(`Could not start ${command}: ${err.message}`)))
      })
      child.on('close', (code, signal) => {
        flushStdout()
        if (stdoutRest.trim()) {
          handleLine(stdoutRest)
          stdoutRest = ''
        }
        finish(() => {
          if (aborted) return reject(new Error('Cancelled'))
          if (timedOut) return reject(new Error(`Review timed out after ${Math.round(this.timeoutMs / 60_000)} minutes`))
          const tail = stderrTail.join('\n').trim()
          if (outcome && 'err' in outcome) {
            if (tail) outcome.err.message += `\n\nLast stderr lines:\n${tail}`
            return reject(outcome.err)
          }
          if (outcome) return resolve(outcome.ok)
          const how = code === 0 ? 'without a result' : signal ? `with signal ${signal}` : `with code ${code}`
          reject(new Error(`claude exited ${how}${tail ? `: ${tail}` : ''}`))
        })
      })

      const stdin = child.stdin
      if (stdin) {
        // EPIPE when the CLI dies before reading the prompt; the close handler reports that.
        stdin.on('error', () => undefined)
        stdin.write(prompt)
        stdin.end()
      }
      emit({ kind: 'thinking', text: 'Starting Claude Code' })
    })
  }
}
