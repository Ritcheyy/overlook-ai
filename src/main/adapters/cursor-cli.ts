/**
 * Runs the Cursor CLI (`agent -p`) inside the PR worktree and streams its
 * progress into activity events. Cursor has no tool allow-list flag, so the
 * run is kept read-only through a permissions file written into the worktree
 * for its duration; the PR branch's own .cursor folder is set aside meanwhile
 * so its hooks, rules and MCP config never run.
 */
import { spawn as nodeSpawn } from 'node:child_process'
import { promises as nodeFs } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import type { Activity, Settings } from '@core/domain'
import { expandHome } from '@core/engine/paths'
import type { ReviewRequest, ReviewResult, RunnerPort } from '@core/ports'
import { parseReviewOutput } from '@core/review/parse'
import { buildReviewPrompt } from '@core/review/prompt'
import { resolveCliPath } from '../environment'
import { KILL_GRACE_MS, REVIEW_TIMEOUT_MS, deltaDiff, describeExit, driveStreamJson, isRecord, relativeTo, str, type ChildLike, type SpawnFn } from './cli-process'
import { exec as defaultExec } from './exec'
import type { ExecFn } from './exec'

/** Mirrors the Claude allow-list: files in the workspace plus read-only git and gh. Anything else is rejected without --force. */
export const CURSOR_PERMISSIONS = {
  permissions: {
    allow: ['Read(**)', 'Shell(git diff)', 'Shell(git log)', 'Shell(git show)', 'Shell(git blame)', 'Shell(git status)', 'Shell(gh pr diff)', 'Shell(gh pr view)'],
    deny: ['Write(**)']
  }
}

export const CURSOR_CONFIG_DIR = '.cursor'
/** Where the branch's own .cursor folder waits while a review runs. */
export const CURSOR_ASIDE_DIR = '.cursor.overlook-aside'

const THINKING_PREVIEW_CHARS = 100
/** Reasoning streams in small deltas; a line goes out per stretch, or per this many characters of a long one. */
const THINKING_FLUSH_CHARS = 500

export interface CursorFs {
  access(path: string): Promise<void>
  rename(from: string, to: string): Promise<void>
  mkdir(path: string, opts: { recursive: boolean }): Promise<string | undefined>
  writeFile(path: string, data: string): Promise<void>
  rm(path: string, opts: { recursive: boolean; force: boolean }): Promise<void>
}

export interface CursorCliRunnerOptions {
  spawn?: SpawnFn
  /** Runs git for follow-up deltas and the lookups that resolve a bare cursorPath. */
  exec?: ExecFn
  fs?: CursorFs
  /** Base environment for the child; defaults to process.env. */
  env?: NodeJS.ProcessEnv
  timeoutMs?: number
  killGraceMs?: number
}

type ActivityLite = Omit<Activity, 'missionId' | 'at'>

export function buildCursorArgs(settings: Settings, worktreePath: string): string[] {
  const args = ['-p', '--output-format', 'stream-json', '--trust', '--workspace', worktreePath]
  if (settings.cursorModel) args.push('--model', settings.cursorModel)
  return args
}

/** The model name the CLI announces in its init event; undefined for any other event. */
export function cursorInitModel(event: Record<string, unknown>): string | undefined {
  if (event['type'] !== 'system' || event['subtype'] !== 'init') return undefined
  return str(event['model']) || undefined
}

/** The first argument a tool call names, as the HUD shows it: a path relative to the worktree, a pattern, or a command. */
function toolText(args: Record<string, unknown>, worktreePath: string): string {
  for (const key of ['command', 'pattern', 'query', 'path', 'directory', 'targetDirectory']) {
    const value = str(args[key])
    if (value) return relativeTo(worktreePath, value)
  }
  return ''
}

function toolActivity(name: string, args: Record<string, unknown>, worktreePath: string): ActivityLite {
  const text = toolText(args, worktreePath)
  const lower = name.toLowerCase()
  if (lower.includes('shell') || lower.includes('terminal') || lower.includes('command')) return { kind: 'running', text: text || name }
  if (lower.includes('grep') || lower.includes('search')) return { kind: 'searching', text: text || name }
  if (lower.includes('read') || lower.includes('glob') || lower.includes('list') || lower === 'ls') return { kind: 'reading', text: text || name }
  return { kind: 'running', text: text ? `${name} ${text}` : name }
}

/** Activities implied by one Cursor stream-json event; empty for events the HUD does not show. */
export function cursorActivities(event: Record<string, unknown>, worktreePath: string): ActivityLite[] {
  if (event['type'] === 'assistant') {
    const message = event['message']
    if (!isRecord(message) || !Array.isArray(message['content'])) return []
    const out: ActivityLite[] = []
    for (const block of message['content']) {
      if (!isRecord(block) || block['type'] !== 'text') continue
      const text = str(block['text']).replace(/\s+/g, ' ').trim()
      if (!text) continue
      // The final message is the review JSON itself, not something to narrate.
      if (text.startsWith('{') || text.startsWith('```')) out.push({ kind: 'writing', text: 'Writing findings' })
      else out.push({ kind: 'thinking', text: text.slice(0, THINKING_PREVIEW_CHARS) })
    }
    return out
  }
  if (event['type'] !== 'tool_call' || event['subtype'] !== 'started') return []
  const call = event['tool_call']
  if (!isRecord(call)) return []
  // The payload has one key named for the tool, e.g. readToolCall or shellToolCall.
  const key = Object.keys(call).find((k) => k.endsWith('ToolCall'))
  if (!key) return []
  const payload = call[key]
  const args = isRecord(payload) && isRecord(payload['args']) ? payload['args'] : {}
  return [toolActivity(key.slice(0, -'ToolCall'.length), args, worktreePath)]
}

/**
 * Turns the event stream into activity, joining the `thinking` deltas the
 * model emits while it reasons so a long stretch still moves the HUD.
 */
export class CursorActivityMapper {
  private thinking = ''

  constructor(private readonly worktreePath: string) {}

  activities(event: Record<string, unknown>): ActivityLite[] {
    if (event['type'] !== 'thinking') return cursorActivities(event, this.worktreePath)
    if (event['subtype'] === 'delta') {
      this.thinking += str(event['text'])
      return this.thinking.length >= THINKING_FLUSH_CHARS ? this.flush() : []
    }
    if (event['subtype'] === 'completed') return this.flush()
    return []
  }

  private flush(): ActivityLite[] {
    const text = this.thinking.replace(/\s+/g, ' ').trim()
    this.thinking = ''
    return text ? [{ kind: 'thinking', text: text.slice(0, THINKING_PREVIEW_CHARS) }] : []
  }
}

async function exists(fs: CursorFs, path: string): Promise<boolean> {
  try {
    await fs.access(path)
    return true
  } catch {
    return false
  }
}

/**
 * Replaces the worktree's .cursor folder with one holding only the review
 * permissions and returns the function that puts the branch's own back. A
 * folder already set aside by an interrupted run is kept as the original.
 */
export async function isolateCursorConfig(fs: CursorFs, worktreePath: string): Promise<() => Promise<void>> {
  const dir = join(worktreePath, CURSOR_CONFIG_DIR)
  const aside = join(worktreePath, CURSOR_ASIDE_DIR)
  if (await exists(fs, dir)) {
    if (await exists(fs, aside)) await fs.rm(dir, { recursive: true, force: true })
    else await fs.rename(dir, aside)
  }
  await fs.mkdir(dir, { recursive: true })
  await fs.writeFile(join(dir, 'cli.json'), `${JSON.stringify(CURSOR_PERMISSIONS, null, 2)}\n`)
  return async () => {
    await fs.rm(dir, { recursive: true, force: true })
    if (await exists(fs, aside)) await fs.rename(aside, dir)
  }
}

export class CursorCliRunner implements RunnerPort {
  private readonly spawn: SpawnFn
  private readonly exec: ExecFn
  private readonly fs: CursorFs
  private readonly baseEnv: NodeJS.ProcessEnv
  private readonly timeoutMs: number
  private readonly killGraceMs: number

  constructor(opts: CursorCliRunnerOptions = {}) {
    this.spawn = opts.spawn ?? nodeSpawn
    this.exec = opts.exec ?? defaultExec
    this.fs = opts.fs ?? nodeFs
    this.baseEnv = opts.env ?? process.env
    this.timeoutMs = opts.timeoutMs ?? REVIEW_TIMEOUT_MS
    this.killGraceMs = opts.killGraceMs ?? KILL_GRACE_MS
  }

  async review(req: ReviewRequest): Promise<ReviewResult> {
    if (req.signal?.aborted) throw new Error('Cancelled')
    const diff = req.diff.trim() ? req.diff : await deltaDiff(this.exec, req)
    // No --add-dir equivalent: sibling checkouts stay out of reach, so the prompt must not offer them.
    // Loadout messages invoke Claude Code skills, which Cursor does not have.
    const prompt = buildReviewPrompt({ ...req, diff, workspace: undefined })
    const command = await this.resolveCommand(req.settings.cursorPath)
    if (req.signal?.aborted) throw new Error('Cancelled')
    const restore = await isolateCursorConfig(this.fs, req.worktreePath)
    try {
      const child = this.spawn(command, buildCursorArgs(req.settings, req.worktreePath), {
        cwd: req.worktreePath,
        env: { ...this.baseEnv },
        stdio: 'pipe',
        windowsHide: true
      })
      return await this.drive(child, req, prompt, command)
    } finally {
      await restore().catch(() => undefined)
    }
  }

  private async resolveCommand(cursorPath: string): Promise<string> {
    const command = expandHome(cursorPath, homedir())
    if (isAbsolute(command)) return command
    try {
      return await resolveCliPath(command, 'Cursor', { exec: this.exec, env: this.baseEnv })
    } catch {
      return command
    }
  }

  private async drive(child: ChildLike, req: ReviewRequest, prompt: string, command: string): Promise<ReviewResult> {
    let outcome: { ok: ReviewResult } | { err: Error } | undefined
    let model: string | undefined
    const emit = (a: ActivityLite) => req.onActivity?.(a)
    const mapper = new CursorActivityMapper(req.worktreePath)

    const onEvent = (event: Record<string, unknown>) => {
      if (event['type'] === 'result') {
        try {
          // The result text is every assistant message joined; the review JSON is found inside it.
          outcome = { ok: parseReviewOutput(event, { strict: true }) }
        } catch (e) {
          outcome = { err: e instanceof Error ? e : new Error(String(e)) }
        }
        if (model && 'ok' in outcome) outcome.ok.model = model
        return
      }
      if (model === undefined) {
        model = cursorInitModel(event)
        if (model) req.onModel?.(model)
      }
      for (const a of mapper.activities(event)) emit(a)
    }

    const run = driveStreamJson(child, { command, prompt, signal: req.signal, timeoutMs: this.timeoutMs, killGraceMs: this.killGraceMs, onEvent })
    emit({ kind: 'thinking', text: 'Starting Cursor' })
    const exit = await run
    const tail = exit.stderrTail
    if (outcome && 'err' in outcome) {
      if (tail) outcome.err.message += `\n\nLast stderr lines:\n${tail}`
      throw outcome.err
    }
    if (outcome) return outcome.ok
    throw new Error(`agent exited ${describeExit(exit)}${tail ? `: ${tail}` : ''}`)
  }
}
