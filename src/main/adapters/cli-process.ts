/**
 * Drives a headless CLI that prints one JSON event per line: writes the
 * prompt to stdin, hands each event to the caller, keeps the stderr tail for
 * error reports, and kills the process on abort or timeout. Both reviewer
 * CLIs speak this shape.
 */
import type { ReviewRequest } from '@core/ports'
import { MAX_INLINE_DIFF_CHARS } from '@core/review/prompt'
import type { ExecFn } from './exec'

export const REVIEW_TIMEOUT_MS = 30 * 60_000
export const KILL_GRACE_MS = 5_000
export const DELTA_DIFF_TIMEOUT_MS = 20_000
const STDERR_TAIL_LINES = 20
const GIT_ENV = { GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' }

export interface SpawnOpts {
  cwd: string
  env: NodeJS.ProcessEnv
  stdio: 'pipe'
  windowsHide: boolean
}

/** The slice of ChildProcess the runners rely on; fakes implement just this. */
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

export interface StreamJsonOptions {
  /** Named in the error when the process cannot start. */
  command: string
  prompt: string
  signal?: AbortSignal
  timeoutMs: number
  killGraceMs: number
  /** Every JSON object line, in order; lines that are not JSON are skipped. */
  onEvent: (event: Record<string, unknown>) => void
}

export interface StreamJsonExit {
  code: number | null
  signal: NodeJS.Signals | null
  /** The last stderr lines, joined with newlines. */
  stderrTail: string
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function str(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

export function relativeTo(root: string, path: string): string {
  const base = root.endsWith('/') ? root : `${root}/`
  return path.startsWith(base) ? path.slice(base.length) : path
}

/** Resolves when the process closes; rejects on abort, timeout, a failed start, or an event handler that threw. */
export function driveStreamJson(child: ChildLike, opts: StreamJsonOptions): Promise<StreamJsonExit> {
  return new Promise<StreamJsonExit>((resolve, reject) => {
    let settled = false
    let aborted = false
    let timedOut = false
    let handlerError: Error | undefined
    let stdoutRest = ''
    const stderrTail: string[] = []
    let killTimer: NodeJS.Timeout | undefined

    const kill = () => {
      child.kill('SIGTERM')
      killTimer = setTimeout(() => child.kill('SIGKILL'), opts.killGraceMs)
    }
    const onAbort = () => {
      aborted = true
      kill()
    }
    const timeout = setTimeout(() => {
      timedOut = true
      kill()
    }, opts.timeoutMs)
    opts.signal?.addEventListener('abort', onAbort, { once: true })

    const cleanup = () => {
      clearTimeout(timeout)
      if (killTimer) clearTimeout(killTimer)
      opts.signal?.removeEventListener('abort', onAbort)
    }
    const finish = (fn: () => void) => {
      if (settled) return
      settled = true
      cleanup()
      fn()
    }

    const handleLine = (line: string) => {
      const trimmed = line.trim()
      if (!trimmed || handlerError) return
      let event: unknown
      try {
        event = JSON.parse(trimmed)
      } catch {
        return
      }
      if (!isRecord(event)) return
      try {
        opts.onEvent(event)
      } catch (e) {
        handlerError = e instanceof Error ? e : new Error(String(e))
        kill()
      }
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
      finish(() => reject(new Error(`Could not start ${opts.command}: ${err.message}`)))
    })
    child.on('close', (code, signal) => {
      flushStdout()
      if (stdoutRest.trim()) {
        handleLine(stdoutRest)
        stdoutRest = ''
      }
      finish(() => {
        if (aborted) return reject(new Error('Cancelled'))
        if (timedOut) return reject(new Error(`Review timed out after ${Math.round(opts.timeoutMs / 60_000)} minutes`))
        if (handlerError) return reject(handlerError)
        resolve({ code, signal, stderrTail: stderrTail.join('\n').trim() })
      })
    })

    const stdin = child.stdin
    if (stdin) {
      // EPIPE when the CLI dies before reading the prompt; the close handler reports that.
      stdin.on('error', () => undefined)
      stdin.write(opts.prompt)
      stdin.end()
    }
  })
}

/** How a process ended, for the error when it produced no result. */
export function describeExit(exit: StreamJsonExit): string {
  return exit.code === 0 ? 'without a result' : exit.signal ? `with signal ${exit.signal}` : `with code ${exit.code}`
}

/** The changes since the previous round, or '' when git cannot produce them or they are too big to inline. */
export async function deltaDiff(exec: ExecFn, req: ReviewRequest): Promise<string> {
  const previous = req.previousRound?.headSha
  if (!previous) return ''
  try {
    const res = await exec('git', ['-C', req.worktreePath, 'diff', `${previous}..HEAD`], {
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
