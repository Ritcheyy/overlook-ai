import { spawn } from 'node:child_process'
import { constants as osConstants } from 'node:os'

export interface ExecOptions {
  cwd?: string
  /** Written to stdin, which is then closed. stdin is closed immediately when omitted. */
  input?: string
  signal?: AbortSignal
  /** Defaults to 10 minutes. 0 disables the timeout. */
  timeoutMs?: number
  /** Merged over `process.env`. */
  env?: Record<string, string | undefined>
  /** Receives each complete stdout line as it arrives. */
  onLine?: (line: string) => void
  /** Receives each complete stderr line as it arrives. */
  onErrorLine?: (line: string) => void
}

export interface ExecResult {
  stdout: string
  stderr: string
  /** Exit code, or 128 + signal number when the process was killed (abort or timeout). */
  code: number
}

export type ExecFn = (cmd: string, args: string[], opts?: ExecOptions) => Promise<ExecResult>

export const DEFAULT_TIMEOUT_MS = 10 * 60_000
const KILL_GRACE_MS = 3000
/** How long after the process exits to keep reading stdio a grandchild may still hold open. */
const EXIT_DRAIN_GRACE_MS = 1000
/** Own process group (POSIX only), so abort and timeout reach grandchildren as well. */
const DETACHED = process.platform !== 'win32'

class LineSplitter {
  private rest = ''
  constructor(private readonly emit: (line: string) => void) {}

  push(chunk: string): void {
    this.rest += chunk
    let idx = this.rest.indexOf('\n')
    while (idx >= 0) {
      const line = this.rest.slice(0, idx)
      this.rest = this.rest.slice(idx + 1)
      this.emit(line.endsWith('\r') ? line.slice(0, -1) : line)
      idx = this.rest.indexOf('\n')
    }
  }

  flush(): void {
    if (!this.rest) return
    const line = this.rest
    this.rest = ''
    this.emit(line)
  }
}

function signalExitCode(sig: NodeJS.Signals | null): number {
  const n = sig ? osConstants.signals[sig] : undefined
  return 128 + (n ?? 0)
}

/**
 * Runs a command without a shell. Resolves with the exit code for any exit
 * (callers decide what non-zero means) and rejects only when the process could
 * not be spawned. Abort and timeout send SIGTERM, then SIGKILL after a grace
 * period, and note the reason at the end of stderr.
 */
export const exec: ExecFn = (cmd, args, opts = {}) =>
  new Promise<ExecResult>((resolve, reject) => {
    const { cwd, input, signal, timeoutMs = DEFAULT_TIMEOUT_MS, env, onLine, onErrorLine } = opts
    const child = spawn(cmd, args, {
      cwd,
      env: env ? { ...process.env, ...env } : process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: DETACHED,
      windowsHide: true
    })

    let stdout = ''
    let stderr = ''
    let settled = false
    let killReason: string | undefined
    let callbackError: unknown
    let killTimer: NodeJS.Timeout | undefined
    let timeoutTimer: NodeJS.Timeout | undefined
    let drainTimer: NodeJS.Timeout | undefined

    const signalTree = (sig: NodeJS.Signals): void => {
      if (DETACHED && child.pid) {
        try {
          process.kill(-child.pid, sig)
          return
        } catch {
          // The group is already gone; the direct kill below is a harmless no-op.
        }
      }
      child.kill(sig)
    }
    const kill = (reason: string): void => {
      if (settled || killReason) return
      killReason = reason
      signalTree('SIGTERM')
      killTimer = setTimeout(() => {
        if (!settled) signalTree('SIGKILL')
      }, KILL_GRACE_MS)
    }
    // A throwing line callback would otherwise surface as an uncaught exception inside a stream event.
    const guarded = (fn: (line: string) => void) => (line: string) => {
      try {
        fn(line)
      } catch (e) {
        if (callbackError === undefined) {
          callbackError = e
          kill('line callback threw')
        }
      }
    }
    const outLines = onLine ? new LineSplitter(guarded(onLine)) : undefined
    const errLines = onErrorLine ? new LineSplitter(guarded(onErrorLine)) : undefined
    const onAbort = (): void => kill('aborted')
    const cleanup = (): void => {
      if (killTimer) clearTimeout(killTimer)
      if (timeoutTimer) clearTimeout(timeoutTimer)
      if (drainTimer) clearTimeout(drainTimer)
      signal?.removeEventListener('abort', onAbort)
    }

    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk
      outLines?.push(chunk)
    })
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk
      errLines?.push(chunk)
    })
    // EPIPE when the child exits before draining its input; not an error for us.
    child.stdin.on('error', () => {})

    child.on('error', (err) => {
      if (settled) return
      settled = true
      cleanup()
      reject(err)
    })
    child.on('exit', () => {
      // 'close' waits for the pipes, which a grandchild that inherited them can hold open indefinitely.
      drainTimer = setTimeout(() => {
        child.stdout.destroy()
        child.stderr.destroy()
      }, EXIT_DRAIN_GRACE_MS)
    })
    child.on('close', (code, sig) => {
      if (settled) return
      settled = true
      cleanup()
      outLines?.flush()
      errLines?.flush()
      if (callbackError !== undefined) return reject(callbackError)
      if (killReason) {
        if (stderr && !stderr.endsWith('\n')) stderr += '\n'
        stderr += `${cmd}: ${killReason}\n`
      }
      resolve({ stdout, stderr, code: code ?? signalExitCode(sig) })
    })

    if (signal) {
      if (signal.aborted) kill('aborted')
      else signal.addEventListener('abort', onAbort, { once: true })
    }
    if (timeoutMs > 0) timeoutTimer = setTimeout(() => kill(`timed out after ${timeoutMs}ms`), timeoutMs)

    if (input !== undefined) child.stdin.end(input)
    else child.stdin.end()
  })

/** Throws the signal's abort reason (an AbortError by default) once it has been aborted. */
export function throwIfAborted(signal?: AbortSignal): void {
  signal?.throwIfAborted()
}
