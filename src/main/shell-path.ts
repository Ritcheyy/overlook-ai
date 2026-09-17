/**
 * A Finder-launched app inherits launchd's minimal PATH, which hides Homebrew,
 * ~/.local/bin and version managers, so gh, git and claude spawn as if they
 * were not installed. The user's login shell knows the PATH their terminal has.
 */
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { exec as defaultExec } from './adapters/exec'
import type { ExecFn } from './adapters/exec'

export const LOGIN_SHELL_TIMEOUT_MS = 10_000

/** Where Homebrew, pipx-style installs and version managers put binaries. */
export const KNOWN_BIN_DIRS: readonly string[] = ['~/.local/bin', '/opt/homebrew/bin', '/usr/local/bin']

/**
 * launchd hands GUI apps no SHELL at all, and /bin/sh's login PATH omits
 * Homebrew, so the account's real login shell (from Directory Services) is
 * what knows the PATH the user sees in a terminal.
 */
export async function userLoginShell(env: NodeJS.ProcessEnv = process.env, exec: ExecFn = defaultExec, exists = existsSync): Promise<string> {
  if (env['SHELL']) return env['SHELL']
  const user = env['USER'] || env['LOGNAME']
  if (user) {
    try {
      const res = await exec('dscl', ['.', '-read', `/Users/${user}`, 'UserShell'], { env, timeoutMs: 5_000 })
      const found = res.stdout.match(/UserShell:\s*(\S+)/)?.[1]
      if (res.code === 0 && found && exists(found)) return found
    } catch {
      // Directory Services unavailable; fall through.
    }
  }
  return exists('/bin/zsh') ? '/bin/zsh' : '/bin/sh'
}

export async function loginShellPath(env: NodeJS.ProcessEnv = process.env, exec: ExecFn = defaultExec, exists = existsSync): Promise<string | undefined> {
  const shell = await userLoginShell(env, exec, exists)
  try {
    const res = await exec(shell, ['-lc', 'printf "%s" "$PATH"'], { env, timeoutMs: LOGIN_SHELL_TIMEOUT_MS })
    if (res.code !== 0) return undefined
    // Profiles may print banners before the PATH; it is the last non-empty line.
    const path = res.stdout.split('\n').map((l) => l.trim()).filter(Boolean).pop()
    return path?.includes('/') ? path : undefined
  } catch {
    return undefined
  }
}

/** Login-shell entries first (the profile's order wins), then whatever the app already had. */
export function mergePath(loginPath: string | undefined, currentPath: string | undefined): string {
  const seen = new Set<string>()
  const merged: string[] = []
  for (const entry of [...(loginPath ?? '').split(':'), ...(currentPath ?? '').split(':')]) {
    if (!entry || seen.has(entry)) continue
    seen.add(entry)
    merged.push(entry)
  }
  return merged.join(':')
}

/** The known tool directories that exist on this machine, so gh and claude resolve even when the shell cannot be asked. */
export function knownBinDirs(home: string = homedir(), exists = existsSync): string[] {
  return KNOWN_BIN_DIRS.map((d) => (d.startsWith('~') ? home + d.slice(1) : d)).filter((d) => exists(d))
}

/** Best effort: the login shell's PATH first, then the app's own, then the known tool directories. */
export async function importLoginShellPath(
  env: NodeJS.ProcessEnv = process.env,
  exec: ExecFn = defaultExec,
  extraDirs: string[] = knownBinDirs()
): Promise<string | undefined> {
  const login = await loginShellPath(env, exec)
  const merged = mergePath(login, mergePath(env['PATH'], extraDirs.join(':')))
  if (!login && extraDirs.length === 0) return undefined
  env['PATH'] = merged
  return env['PATH']
}
