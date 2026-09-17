import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { Settings } from '@core/domain'
import { defaultSettings } from '@core/loadouts'
import type { ExecFn, ExecOptions, ExecResult } from './adapters/exec'
import { checkEnvironment, resolveClaudePath, type EnvironmentFs } from './environment'

interface Call {
  cmd: string
  args: string[]
  opts?: ExecOptions
}

/** Returns a result, or undefined to behave like a binary that is not installed. */
type Handler = (cmd: string, args: string[], opts?: ExecOptions) => ExecResult | undefined

const HOME = '/Users/demo'
const ENV = { PATH: '/usr/bin:/bin', SHELL: '/bin/zsh' }
const CLAUDE = '/Users/demo/.local/bin/claude'
const NOW = new Date('2026-09-13T12:00:00.000Z')
const LOGGED_IN = 'github.com\n  ✓ Logged in to github.com account ritchey (keyring)\n  - Active account: true\n'

function ok(stdout: string, stderr = ''): ExecResult {
  return { stdout, stderr, code: 0 }
}

function fail(code: number, stderr: string): ExecResult {
  return { stdout: '', stderr, code }
}

function enoent(what: string): NodeJS.ErrnoException {
  return Object.assign(new Error(`spawn ${what} ENOENT`), { code: 'ENOENT' })
}

function fakeExec(handler: Handler): { exec: ExecFn; calls: Call[] } {
  const calls: Call[] = []
  const exec: ExecFn = async (cmd, args, opts) => {
    calls.push({ cmd, args, opts })
    const res = handler(cmd, args, opts)
    if (!res) throw enoent(cmd)
    return res
  }
  return { exec, calls }
}

/** The name being looked up with `command -v` on the app's PATH, if this is that call. */
const commandV = (cmd: string, args: string[]): string | undefined =>
  cmd === 'sh' && args[0] === '-c' && args[1] === 'command -v -- "$1"' ? args[3] : undefined
const loginShell = (cmd: string, args: string[]): string | undefined => (cmd === '/bin/zsh' && args[0] === '-lc' ? args[1] : undefined)

const happy: Handler = (cmd, args) => {
  if (cmd === 'gh' && args[0] === 'auth') return ok(LOGGED_IN)
  if (commandV(cmd, args) === 'claude') return ok(`${CLAUDE}\n`)
  if (loginShell(cmd, args)) return fail(1, '')
  if (cmd === CLAUDE && args[0] === '--version') return ok('2.1.252 (Claude Code)\n')
  if (cmd === 'git' && args[0] === '--version') return ok('git version 2.50.1\n')
  return undefined
}

function fakeFs(opts: { executables?: string[]; mkdirError?: string } = {}): { fs: EnvironmentFs; ops: string[] } {
  const ops: string[] = []
  return {
    ops,
    fs: {
      async access(path) {
        if (!opts.executables?.includes(path)) throw enoent(path)
      },
      async mkdir(path) {
        ops.push(`mkdir ${path}`)
        if (opts.mkdirError) throw new Error(opts.mkdirError)
        return undefined
      },
      async writeFile(path) {
        ops.push(`write ${path}`)
      },
      async rm(path) {
        ops.push(`rm ${path}`)
      }
    }
  }
}

function check(handler: Handler, overrides: Partial<Settings> = {}, fsOpts: { executables?: string[]; mkdirError?: string } = {}) {
  const { exec, calls } = fakeExec(handler)
  const { fs: fakeFiles, ops } = fakeFs(fsOpts)
  const settings = defaultSettings({ demoMode: false, ...overrides })
  const run = () => checkEnvironment(settings, HOME, { exec, fs: fakeFiles, env: ENV, now: () => NOW })
  return { run, calls, ops }
}

describe('checkEnvironment', () => {
  it('reports every check ok with login, version, path and root details', async () => {
    const { run, calls, ops } = check(happy)
    const result = await run()

    expect(result.checkedAt).toBe('2026-09-13T12:00:00.000Z')
    expect(result.ok).toBe(true)
    expect(result.items).toEqual([
      { id: 'gh', label: 'GitHub CLI', ok: true, detail: 'Logged in to github.com account ritchey (keyring)' },
      { id: 'claude', label: 'Claude Code', ok: true, detail: `Claude Code 2.1.252 at ${CLAUDE}` },
      { id: 'git', label: 'Git', ok: true, detail: 'git version 2.50.1' },
      { id: 'worktreeRoot', label: 'Worktree root', ok: true, detail: '/Users/demo/.overlook/worktrees' }
    ])

    const gh = calls.find((c) => c.cmd === 'gh')!
    expect(gh.args).toEqual(['auth', 'status'])
    expect(gh.opts?.env).toMatchObject({ GH_NO_UPDATE_NOTIFIER: '1', GH_PROMPT_DISABLED: '1' })
    const lookup = calls.find((c) => c.cmd === 'sh')!
    expect(lookup.args).toEqual(['-c', 'command -v -- "$1"', 'sh', 'claude'])
    expect(lookup.opts?.env?.['PATH']).toBe('/usr/bin:/bin:/Users/demo/.local/bin:/opt/homebrew/bin:/usr/local/bin')
    expect(calls.some((c) => c.cmd === '/bin/zsh')).toBe(false)
    expect(calls.find((c) => c.cmd === CLAUDE)).toMatchObject({ args: ['--version'], opts: { timeoutMs: 15_000 } })

    expect(ops).toHaveLength(3)
    expect(ops[0]).toBe('mkdir /Users/demo/.overlook/worktrees')
    expect(ops[1]).toMatch(/^write \/Users\/demo\/\.overlook\/worktrees\/\.write-probe-\d+-\d+$/)
    expect(ops[2]).toBe(ops[1].replace('write', 'rm'))
  })

  it('falls back to a login shell when the app PATH lacks claude', async () => {
    const nvm = '/Users/demo/.nvm/versions/node/v22.0.0/bin/claude'
    const { run, calls } = check((cmd, args) => {
      if (commandV(cmd, args)) return fail(1, '')
      if (loginShell(cmd, args) === "command -v -- 'claude'") return ok(`${nvm}\n`)
      if (cmd === nvm && args[0] === '--version') return ok('2.1.252 (Claude Code)\n')
      return happy(cmd, args)
    })
    const result = await run()
    expect(result.items[1]).toMatchObject({ ok: true, detail: `Claude Code 2.1.252 at ${nvm}` })
    expect(calls.find((c) => c.cmd === '/bin/zsh')).toMatchObject({ args: ['-lc', "command -v -- 'claude'"], opts: { timeoutMs: 15_000 } })
  })

  it('names what was tried when claude cannot be found', async () => {
    const { run } = check((cmd, args) => (commandV(cmd, args) || loginShell(cmd, args) ? fail(1, '') : happy(cmd, args)))
    const result = await run()
    expect(result.ok).toBe(false)
    expect(result.items[1]).toEqual({
      id: 'claude',
      label: 'Claude Code',
      ok: false,
      detail:
        'Could not find "claude": tried the app\'s PATH plus /Users/demo/.local/bin, /opt/homebrew/bin, /usr/local/bin and a login shell (/bin/zsh -lc). Set the full path to the Claude Code CLI in Settings.'
    })
  })

  it('treats a login shell answer that is not a path as not found', async () => {
    const { run } = check((cmd, args) => {
      if (commandV(cmd, args)) return fail(1, '')
      if (loginShell(cmd, args)) return ok('claude: aliased to /Users/demo/.claude/local/claude\n')
      return happy(cmd, args)
    })
    expect((await run()).items[1]).toMatchObject({ ok: false, detail: expect.stringContaining('Could not find "claude"') })
  })

  it('checks an absolute claudePath for an executable file', async () => {
    const missing = check(happy, { claudePath: '/opt/bin/claude' })
    expect((await missing.run()).items[1]).toMatchObject({ ok: false, detail: '/opt/bin/claude does not exist or is not executable' })
    expect(missing.calls.some((c) => c.cmd === 'sh' || c.cmd === '/bin/zsh')).toBe(false)

    const present = check(
      (cmd, args) => (cmd === '/opt/bin/claude' && args[0] === '--version' ? ok('2.0.0 (Claude Code)') : happy(cmd, args)),
      { claudePath: '/opt/bin/claude' },
      { executables: ['/opt/bin/claude'] }
    )
    expect((await present.run()).items[1]).toMatchObject({ ok: true, detail: 'Claude Code 2.0.0 at /opt/bin/claude' })
  })

  it('expands ~ in claudePath', async () => {
    const { run } = check(happy, { claudePath: '~/.local/bin/claude' }, { executables: [CLAUDE] })
    expect((await run()).items[1]).toMatchObject({ ok: true, detail: `Claude Code 2.1.252 at ${CLAUDE}` })
  })

  it('reports a failing claude --version', async () => {
    const { run } = check((cmd, args) => (cmd === CLAUDE ? fail(1, 'node: bad option: --frozen\n') : happy(cmd, args)))
    expect((await run()).items[1]).toMatchObject({ ok: false, detail: `${CLAUDE} --version failed (exit 1): node: bad option: --frozen` })
  })

  it('explains a missing gh login and suggests the command', async () => {
    const notLoggedIn = check((cmd, args) =>
      cmd === 'gh' ? fail(1, 'You are not logged into any GitHub hosts. To log in, run:  gh auth login\n') : happy(cmd, args)
    )
    const result = await notLoggedIn.run()
    expect(result.ok).toBe(false)
    expect(result.items[0]).toMatchObject({ ok: false, detail: 'You are not logged into any GitHub hosts. To log in, run:  gh auth login' })

    const badToken = check((cmd, args) =>
      cmd === 'gh' ? fail(1, 'github.com\n  X Failed to log in to github.com account ritchey (keyring)\n  - The token in keyring is invalid.\n') : happy(cmd, args)
    )
    expect((await badToken.run()).items[0].detail).toBe(
      'github.com X Failed to log in to github.com account ritchey (keyring) - The token in keyring is invalid. Run: gh auth login'
    )
  })

  it('falls back to the account name when gh prints no logged-in line', async () => {
    const { run } = check((cmd, args) => (cmd === 'gh' ? ok('github.com\n  - Token: gho_****\n  - account: ritchey\n') : happy(cmd, args)))
    expect((await run()).items[0]).toMatchObject({ ok: true, detail: 'Logged in as ritchey' })
  })

  it('explains a missing gh binary', async () => {
    const { run } = check((cmd, args) => (cmd === 'gh' ? undefined : happy(cmd, args)))
    expect((await run()).items[0]).toMatchObject({
      ok: false,
      detail: 'gh was not found on PATH. Install GitHub CLI from https://cli.github.com and run: gh auth login'
    })
  })

  it('reports git problems', async () => {
    const missing = check((cmd, args) => (cmd === 'git' ? undefined : happy(cmd, args)))
    expect((await missing.run()).items[2]).toMatchObject({ ok: false, detail: 'git was not found on PATH. Install git (on macOS: xcode-select --install)' })

    const broken = check((cmd, args) => (cmd === 'git' ? fail(1, 'xcode-select: note: No developer tools were found\n') : happy(cmd, args)))
    expect((await broken.run()).items[2]).toMatchObject({ ok: false, detail: 'xcode-select: note: No developer tools were found' })
  })

  it('reports an unwritable worktree root and keeps the other checks', async () => {
    const { run, ops } = check(happy, { worktreeRoot: '/Volumes/ro/worktrees' }, { mkdirError: 'EACCES: permission denied, mkdir' })
    const result = await run()
    expect(result.ok).toBe(false)
    expect(result.items[3]).toEqual({
      id: 'worktreeRoot',
      label: 'Worktree root',
      ok: false,
      detail: '/Volumes/ro/worktrees is not writable: EACCES: permission denied, mkdir'
    })
    expect(result.items.slice(0, 3).every((i) => i.ok)).toBe(true)
    expect(ops).toEqual(['mkdir /Volumes/ro/worktrees'])
  })

  it('rejects an empty worktree root', async () => {
    const { run, ops } = check(happy, { worktreeRoot: '  ' })
    expect((await run()).items[3]).toMatchObject({ ok: false, detail: 'Worktree root is empty; set it in Settings' })
    expect(ops).toEqual([])
  })

  it('probes the worktree root on the real file system and leaves it clean', async () => {
    const tmp = await fs.mkdtemp(join(tmpdir(), 'prr-env-'))
    try {
      const root = join(tmp, 'nested', 'worktrees')
      const { exec } = fakeExec(happy)
      const result = await checkEnvironment(defaultSettings({ demoMode: false, worktreeRoot: root }), HOME, { exec, env: ENV })
      expect(result.items[3]).toEqual({ id: 'worktreeRoot', label: 'Worktree root', ok: true, detail: root })
      expect(await fs.readdir(root)).toEqual([])
      expect(Number.isNaN(Date.parse(result.checkedAt))).toBe(false)
    } finally {
      await fs.rm(tmp, { recursive: true, force: true })
    }
  })
})

describe('resolveClaudePath', () => {
  const deps = (exec: ExecFn) => ({ exec, env: ENV, homeDir: HOME })

  it('caches successful bare-name lookups per exec', async () => {
    const a = fakeExec(happy)
    expect(await resolveClaudePath('claude', deps(a.exec))).toBe(CLAUDE)
    expect(await resolveClaudePath('claude', deps(a.exec))).toBe(CLAUDE)
    expect(a.calls).toHaveLength(1)

    const b = fakeExec(happy)
    expect(await resolveClaudePath('claude', deps(b.exec))).toBe(CLAUDE)
    expect(b.calls).toHaveLength(1)
  })

  it('does not cache failures', async () => {
    let installed = false
    const { exec, calls } = fakeExec((cmd, args) => (installed ? happy(cmd, args) : fail(1, '')))
    await expect(resolveClaudePath('claude', deps(exec))).rejects.toThrow(/Could not find "claude"/)
    installed = true
    expect(await resolveClaudePath('claude', deps(exec))).toBe(CLAUDE)
    expect(calls.map((c) => c.cmd)).toEqual(['sh', '/bin/zsh', 'sh'])
  })

  it('uses /bin/sh as the login shell when SHELL is unset and quotes the name', async () => {
    const { exec, calls } = fakeExec((cmd, args) => (cmd === '/bin/sh' && args[0] === '-lc' ? ok('/opt/tools/my claude\n') : fail(1, '')))
    expect(await resolveClaudePath('my claude', { exec, env: { PATH: '/usr/bin' }, homeDir: HOME })).toBe('/opt/tools/my claude')
    expect(calls[1]).toMatchObject({ cmd: '/bin/sh', args: ['-lc', "command -v -- 'my claude'"] })
  })

  it('rejects an empty path', async () => {
    const { exec } = fakeExec(happy)
    await expect(resolveClaudePath('  ', deps(exec))).rejects.toThrow(/empty/)
  })
})
