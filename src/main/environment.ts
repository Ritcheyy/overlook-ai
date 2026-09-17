/**
 * Real-mode preflight: gh login, a runnable Claude Code CLI, git, and a
 * writable worktree root. Commands and the file system are injectable so the
 * checks run against fakes in tests.
 */
import { constants as fsConstants, promises as nodeFs } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import type { EnvironmentCheck, EnvironmentCheckId, EnvironmentCheckItem, Settings } from '@core/domain'
import { ENVIRONMENT_CHECK_LABELS } from '@core/domain'
import { expandHome } from '@core/engine/paths'
import { exec as defaultExec } from './adapters/exec'
import type { ExecFn, ExecResult } from './adapters/exec'
import { GH_ENV } from './adapters/gh-cli'

export interface EnvironmentFs {
  access(path: string, mode?: number): Promise<void>
  mkdir(path: string, opts: { recursive: boolean }): Promise<string | undefined>
  writeFile(path: string, data: string): Promise<void>
  rm(path: string, opts?: { force?: boolean }): Promise<void>
}

export interface ResolveClaudePathDeps {
  exec?: ExecFn
  fs?: Pick<EnvironmentFs, 'access'>
  /** Environment the lookups run in; defaults to process.env. */
  env?: NodeJS.ProcessEnv
  homeDir?: string
}

export interface EnvironmentDeps extends ResolveClaudePathDeps {
  fs?: EnvironmentFs
  now?: () => Date
}

export const PROBE_TIMEOUT_MS = 15_000
/** Install locations a Finder-launched app cannot see because launchd hands it a minimal PATH. */
export const KNOWN_BIN_DIRS: readonly string[] = ['~/.local/bin', '/opt/homebrew/bin', '/usr/local/bin']
const TAIL_LINES = 3

/** Successful bare-name lookups, keyed by the exec that produced them so fakes never share a cache with the real shell. */
const resolvedByExec = new WeakMap<ExecFn, Map<string, string>>()

function item(id: EnvironmentCheckId, ok: boolean, detail: string): EnvironmentCheckItem {
  return { id, label: ENVIRONMENT_CHECK_LABELS[id], ok, detail }
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

function isEnoent(e: unknown): boolean {
  return (e as NodeJS.ErrnoException | undefined)?.code === 'ENOENT'
}

function lines(text: string): string[] {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
}

function tail(text: string): string {
  return lines(text).slice(-TAIL_LINES).join(' ')
}

function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`
}

function foundPath(res: ExecResult): string | undefined {
  if (res.code !== 0) return undefined
  const first = lines(res.stdout)[0]
  return first && isAbsolute(first) ? first : undefined
}

/**
 * Turns the claudePath setting into something spawn can run. An absolute path
 * must be an executable file. A bare name is looked up on the app's PATH plus
 * the usual install dirs, then through a login shell, which sees the PATH the
 * user's profile builds (nvm, ~/.local/bin) and a Finder-launched app does not.
 */
export async function resolveClaudePath(claudePath: string, deps: ResolveClaudePathDeps = {}): Promise<string> {
  const exec = deps.exec ?? defaultExec
  const fs = deps.fs ?? nodeFs
  const env = deps.env ?? process.env
  const homeDir = deps.homeDir ?? homedir()
  const path = expandHome(claudePath.trim(), homeDir)
  if (!path) throw new Error('Claude Code path is empty; set it in Settings')

  if (isAbsolute(path)) {
    try {
      await fs.access(path, fsConstants.X_OK)
    } catch {
      throw new Error(`${path} does not exist or is not executable`)
    }
    return path
  }

  let cache = resolvedByExec.get(exec)
  if (!cache) {
    cache = new Map()
    resolvedByExec.set(exec, cache)
  }
  const cached = cache.get(path)
  if (cached) return cached

  const knownDirs = KNOWN_BIN_DIRS.map((d) => expandHome(d, homeDir))
  const searchPath = [env['PATH'], ...knownDirs].filter(Boolean).join(':')
  const shell = env['SHELL'] || '/bin/sh'
  const attempts: { tried: string; run: () => Promise<ExecResult> }[] = [
    {
      tried: `the app's PATH plus ${knownDirs.join(', ')}`,
      run: () => exec('sh', ['-c', 'command -v -- "$1"', 'sh', path], { env: { ...env, PATH: searchPath }, timeoutMs: PROBE_TIMEOUT_MS })
    },
    {
      tried: `a login shell (${shell} -lc)`,
      run: () => exec(shell, ['-lc', `command -v -- ${shellQuote(path)}`], { env, timeoutMs: PROBE_TIMEOUT_MS })
    }
  ]
  for (const attempt of attempts) {
    let found: string | undefined
    try {
      found = foundPath(await attempt.run())
    } catch {
      found = undefined
    }
    if (found) {
      cache.set(path, found)
      return found
    }
  }
  throw new Error(
    `Could not find "${path}": tried ${attempts.map((a) => a.tried).join(' and ')}. Set the full path to the Claude Code CLI in Settings.`
  )
}

async function checkGh(exec: ExecFn, env: NodeJS.ProcessEnv): Promise<EnvironmentCheckItem> {
  let res: ExecResult
  try {
    res = await exec('gh', ['auth', 'status'], { env: { ...env, ...GH_ENV }, timeoutMs: PROBE_TIMEOUT_MS })
  } catch (e) {
    if (isEnoent(e)) return item('gh', false, 'gh was not found on PATH. Install GitHub CLI from https://cli.github.com and run: gh auth login')
    return item('gh', false, `Could not run gh: ${message(e)}`)
  }
  const output = `${res.stdout}\n${res.stderr}`
  if (res.code === 0) {
    const loggedIn = lines(output).find((l) => /logged in/i.test(l))
    const account = /account:? (\S+)/i.exec(output)?.[1]
    return item('gh', true, loggedIn?.replace(/^[^A-Za-z]+/, '') ?? (account ? `Logged in as ${account}` : 'Logged in'))
  }
  let detail = tail(res.stderr) || tail(res.stdout) || `gh auth status exited with code ${res.code}`
  if (/log(?:ged)? ?in/i.test(detail) && !/gh auth login/.test(detail)) detail = `${detail.replace(/[.\s]+$/, '')}. Run: gh auth login`
  return item('gh', false, detail)
}

async function checkClaude(claudePath: string, deps: Required<ResolveClaudePathDeps>): Promise<EnvironmentCheckItem> {
  let path: string
  try {
    path = await resolveClaudePath(claudePath, deps)
  } catch (e) {
    return item('claude', false, message(e))
  }
  let res: ExecResult
  try {
    res = await deps.exec(path, ['--version'], { env: deps.env, timeoutMs: PROBE_TIMEOUT_MS })
  } catch (e) {
    return item('claude', false, `Could not run ${path}: ${message(e)}`)
  }
  if (res.code !== 0) {
    const why = tail(res.stderr) || tail(res.stdout)
    return item('claude', false, `${path} --version failed (exit ${res.code})${why ? `: ${why}` : ''}`)
  }
  const version = (lines(res.stdout)[0] ?? '').replace(/\(claude code\)/i, '').trim() || 'unknown version'
  return item('claude', true, `Claude Code ${version} at ${path}`)
}

async function checkGit(exec: ExecFn, env: NodeJS.ProcessEnv): Promise<EnvironmentCheckItem> {
  let res: ExecResult
  try {
    res = await exec('git', ['--version'], { env, timeoutMs: PROBE_TIMEOUT_MS })
  } catch (e) {
    if (isEnoent(e)) return item('git', false, 'git was not found on PATH. Install git (on macOS: xcode-select --install)')
    return item('git', false, `Could not run git: ${message(e)}`)
  }
  if (res.code !== 0) return item('git', false, tail(res.stderr) || tail(res.stdout) || `git --version exited with code ${res.code}`)
  return item('git', true, lines(res.stdout)[0] ?? 'git')
}

async function checkWorktreeRoot(worktreeRoot: string, homeDir: string, fs: EnvironmentFs): Promise<EnvironmentCheckItem> {
  const trimmed = worktreeRoot.trim()
  if (!trimmed) return item('worktreeRoot', false, 'Worktree root is empty; set it in Settings')
  const root = resolve(expandHome(trimmed, homeDir))
  const probe = join(root, `.write-probe-${process.pid}-${Date.now()}`)
  try {
    await fs.mkdir(root, { recursive: true })
    await fs.writeFile(probe, '')
    await fs.rm(probe, { force: true })
  } catch (e) {
    return item('worktreeRoot', false, `${root} is not writable: ${message(e)}`)
  }
  return item('worktreeRoot', true, root)
}

export async function checkEnvironment(settings: Settings, homeDir: string, deps: EnvironmentDeps = {}): Promise<EnvironmentCheck> {
  const exec = deps.exec ?? defaultExec
  const fs = deps.fs ?? nodeFs
  const env = deps.env ?? process.env
  const items = await Promise.all([
    checkGh(exec, env),
    checkClaude(settings.claudePath, { exec, fs, env, homeDir }),
    checkGit(exec, env),
    checkWorktreeRoot(settings.worktreeRoot, homeDir, fs)
  ])
  return { checkedAt: (deps.now?.() ?? new Date()).toISOString(), ok: items.every((i) => i.ok), items }
}
