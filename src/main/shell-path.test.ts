import { describe, expect, it } from 'vitest'
import type { ExecFn, ExecOptions } from './adapters/exec'
import { LOGIN_SHELL_TIMEOUT_MS, importLoginShellPath, knownBinDirs, loginShellPath, mergePath, userLoginShell } from './shell-path'

function fakeExec(stdout: string, code = 0): { exec: ExecFn; calls: { cmd: string; args: string[]; opts?: ExecOptions }[] } {
  const calls: { cmd: string; args: string[]; opts?: ExecOptions }[] = []
  return {
    calls,
    exec: async (cmd, args, opts) => {
      calls.push({ cmd, args, opts })
      return { stdout, stderr: '', code }
    }
  }
}

describe('loginShellPath', () => {
  it('asks the login shell for its PATH with a timeout', async () => {
    const { exec, calls } = fakeExec('/opt/homebrew/bin:/usr/bin:/bin')
    expect(await loginShellPath({ SHELL: '/bin/zsh', PATH: '/usr/bin' }, exec)).toBe('/opt/homebrew/bin:/usr/bin:/bin')
    expect(calls).toHaveLength(1)
    expect(calls[0].cmd).toBe('/bin/zsh')
    expect(calls[0].args).toEqual(['-lc', 'printf "%s" "$PATH"'])
    expect(calls[0].opts?.timeoutMs).toBe(LOGIN_SHELL_TIMEOUT_MS)
  })

  it('takes the last line so profile banners do not pollute the result', async () => {
    const { exec } = fakeExec('Welcome back!\n\n/Users/demo/.local/bin:/usr/bin\n')
    expect(await loginShellPath({ SHELL: '/bin/zsh' }, exec)).toBe('/Users/demo/.local/bin:/usr/bin')
  })

  it('asks Directory Services for the login shell when the env has none', async () => {
    const calls: { cmd: string; args: string[] }[] = []
    const exec: ExecFn = async (cmd, args) => {
      calls.push({ cmd, args })
      if (cmd === 'dscl') return { stdout: 'UserShell: /bin/zsh\n', stderr: '', code: 0 }
      return { stdout: '/opt/homebrew/bin:/usr/bin', stderr: '', code: 0 }
    }
    expect(await loginShellPath({ USER: 'demo' }, exec, () => true)).toBe('/opt/homebrew/bin:/usr/bin')
    expect(calls[0]).toEqual({ cmd: 'dscl', args: ['.', '-read', '/Users/demo', 'UserShell'] })
    expect(calls[1].cmd).toBe('/bin/zsh')
  })

  it('prefers zsh over sh when nothing else is known', async () => {
    expect(await userLoginShell({}, fakeExec('', 1).exec, (p) => p === '/bin/zsh')).toBe('/bin/zsh')
    expect(await userLoginShell({}, fakeExec('', 1).exec, () => false)).toBe('/bin/sh')
  })

  it('falls back to /bin/sh and gives up on failures', async () => {
    const failing = fakeExec('', 1)
    expect(await loginShellPath({}, failing.exec, () => false)).toBeUndefined()
    expect(failing.calls[0].cmd).toBe('/bin/sh')
    const throwing: ExecFn = async () => {
      throw new Error('spawn ENOENT')
    }
    expect(await loginShellPath({ SHELL: '/nope' }, throwing)).toBeUndefined()
    expect(await loginShellPath({}, fakeExec('not a path').exec)).toBeUndefined()
  })
})

describe('mergePath', () => {
  it('puts login entries first and drops duplicates and blanks', () => {
    expect(mergePath('/a:/b::/c', '/b:/d:')).toBe('/a:/b:/c:/d')
    expect(mergePath(undefined, '/x')).toBe('/x')
  })
})

describe('importLoginShellPath', () => {
  it('puts the login PATH first, then the app PATH, then the known tool directories', async () => {
    const env: NodeJS.ProcessEnv = { SHELL: '/bin/zsh', PATH: '/usr/bin:/bin' }
    expect(await importLoginShellPath(env, fakeExec('/opt/homebrew/bin:/usr/bin').exec, ['/Users/demo/.local/bin'])).toBe(
      '/opt/homebrew/bin:/usr/bin:/bin:/Users/demo/.local/bin'
    )
    expect(env['PATH']).toBe('/opt/homebrew/bin:/usr/bin:/bin:/Users/demo/.local/bin')
  })

  it('still adds the known tool directories when the shell cannot be asked', async () => {
    const env: NodeJS.ProcessEnv = { SHELL: '/bin/zsh', PATH: '/usr/bin' }
    expect(await importLoginShellPath(env, fakeExec('', 1).exec, ['/opt/homebrew/bin'])).toBe('/usr/bin:/opt/homebrew/bin')
    const untouched: NodeJS.ProcessEnv = { SHELL: '/bin/zsh', PATH: '/usr/bin' }
    expect(await importLoginShellPath(untouched, fakeExec('', 1).exec, [])).toBeUndefined()
    expect(untouched['PATH']).toBe('/usr/bin')
  })
})

describe('knownBinDirs', () => {
  it('expands ~ and keeps only directories that exist', () => {
    expect(knownBinDirs('/Users/demo', (p) => p !== '/usr/local/bin')).toEqual(['/Users/demo/.local/bin', '/opt/homebrew/bin'])
  })
})
