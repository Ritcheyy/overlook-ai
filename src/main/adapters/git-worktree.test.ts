import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { PullRequest } from '@core/domain'
import { prIdOf, repoRefFromFullName } from '@core/domain'
import { exec } from './exec'
import type { ExecFn } from './exec'
import { GitWorktree } from './git-worktree'

/** Keeps the user's global git config (signing, hooks, templates) out of the test repos. */
const GIT_TEST_ENV = {
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_AUTHOR_NAME: 'Test',
  GIT_AUTHOR_EMAIL: 'test@example.com',
  GIT_COMMITTER_NAME: 'Test',
  GIT_COMMITTER_EMAIL: 'test@example.com',
  GIT_TERMINAL_PROMPT: '0'
}

const isolatedExec: ExecFn = (cmd, args, opts) => exec(cmd, args, { ...opts, env: { ...GIT_TEST_ENV, ...opts?.env } })

async function git(cwd: string, ...args: string[]): Promise<string> {
  const res = await isolatedExec('git', ['-C', cwd, ...args])
  if (res.code !== 0) throw new Error(`git ${args.join(' ')} failed: ${res.stderr}`)
  return res.stdout.trim()
}

async function commit(cwd: string, file: string, content: string, message: string): Promise<string> {
  await fs.mkdir(join(cwd, file, '..'), { recursive: true })
  await fs.writeFile(join(cwd, file), content)
  await git(cwd, 'add', '-A')
  await git(cwd, 'commit', '-q', '-m', message)
  return git(cwd, 'rev-parse', 'HEAD')
}

function pr(number: number, headRef: string, headSha: string, baseRef = 'main'): PullRequest {
  const fullName = 'acme/demo'
  return {
    id: prIdOf(fullName, number),
    repo: repoRefFromFullName(fullName),
    number,
    title: `PR ${number}`,
    author: 'someone',
    url: `https://github.com/${fullName}/pull/${number}`,
    headRef,
    headSha,
    baseRef,
    isDraft: false,
    state: 'open',
    createdAt: '2026-09-13T08:00:00Z',
    updatedAt: '2026-09-13T08:00:00Z',
    labels: [],
    reviewRequested: true,
    mine: false
  }
}

let tmp: string
let remote: string
let author: string
let local: string
let worktrees: string
let sha1: string
let sha2: string
let mainSha: string
const wtFor = (n: number): string => join(worktrees, 'acme', 'demo', `pr-${n}`)

beforeAll(async () => {
  tmp = await fs.realpath(await fs.mkdtemp(join(tmpdir(), 'prr-wt-')))
  remote = join(tmp, 'remote.git')
  author = join(tmp, 'author')
  local = join(tmp, 'local')
  worktrees = join(tmp, 'worktrees')

  await fs.mkdir(remote)
  await git(remote, 'init', '-q', '--bare', '--initial-branch=main')
  await git(tmp, 'clone', '-q', remote, author)
  await commit(author, 'README.md', '# demo\n', 'init')
  await git(author, 'push', '-q', 'origin', 'main')
  await git(tmp, 'clone', '-q', remote, local)

  await git(author, 'checkout', '-q', '-b', 'feature')
  sha1 = await commit(author, 'packages/foo/index.js', 'module.exports = 1\n', 'feat: foo')
  await git(author, 'push', '-q', 'origin', 'feature')
  await git(remote, 'update-ref', 'refs/pull/7/head', sha1)

  // main moves on after `local` was cloned, so a stale origin/main is detectable.
  await git(author, 'checkout', '-q', 'main')
  mainSha = await commit(author, 'CHANGELOG.md', '# changes\n', 'chore: changelog')
  await git(author, 'push', '-q', 'origin', 'main')
  await git(author, 'checkout', '-q', 'feature')

  await fs.mkdir(join(local, 'node_modules', 'dep'), { recursive: true })
  await fs.mkdir(join(local, 'packages', 'foo', 'node_modules', 'dep'), { recursive: true })
  await fs.mkdir(join(local, 'packages', 'bar', 'node_modules'), { recursive: true })
}, 20000)

afterAll(async () => {
  await fs.rm(tmp, { recursive: true, force: true })
})

describe('GitWorktree', () => {
  const wt = new GitWorktree({ exec: isolatedExec })

  it('fetches the pull ref and the base, creates a detached worktree, links node_modules and runs the prepare command', async () => {
    expect(await git(local, 'rev-parse', 'refs/remotes/origin/main')).not.toBe(mainSha)
    const activity: string[] = []
    const res = await wt.prepare({
      localRepoPath: local,
      worktreePath: wtFor(7),
      pr: pr(7, 'feature', sha1),
      linkNodeModules: true,
      prepareCommand: 'echo prepared > prepared.txt && echo hello-from-prepare',
      onActivity: (t) => activity.push(t)
    })
    expect(res).toEqual({ worktreePath: wtFor(7), headSha: sha1 })
    expect(await git(wtFor(7), 'rev-parse', 'HEAD')).toBe(sha1)
    expect(await git(local, 'rev-parse', 'refs/overlook/pr-7')).toBe(sha1)
    expect(await git(local, 'rev-parse', 'refs/remotes/origin/main')).toBe(mainSha)
    expect(await git(wtFor(7), 'rev-parse', 'origin/main')).toBe(mainSha)
    expect(activity).toEqual([
      'Fetching pull/7/head',
      'Fetching main',
      'Creating worktree',
      'Linking node_modules from the main checkout',
      'Running: echo prepared > prepared.txt && echo hello-from-prepare',
      'hello-from-prepare'
    ])
    expect((await fs.readFile(join(wtFor(7), 'prepared.txt'), 'utf8')).trim()).toBe('prepared')
    expect((await fs.lstat(join(wtFor(7), 'node_modules'))).isSymbolicLink()).toBe(true)
    expect(await fs.readlink(join(wtFor(7), 'node_modules'))).toBe(join(local, 'node_modules'))
    expect(await fs.readlink(join(wtFor(7), 'packages', 'foo', 'node_modules'))).toBe(join(local, 'packages', 'foo', 'node_modules'))
    await expect(fs.lstat(join(wtFor(7), 'packages', 'bar'))).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await wt.exists(wtFor(7))).toBe(true)
  })

  it('re-prepares an existing worktree after a new push without re-running setup', async () => {
    sha2 = await commit(author, 'packages/foo/index.js', 'module.exports = 2\n', 'feat: foo again')
    await git(author, 'push', '-q', 'origin', 'feature')
    await git(remote, 'update-ref', 'refs/pull/7/head', sha2)
    await fs.writeFile(join(wtFor(7), 'README.md'), 'local edit that must not block checkout\n')

    const activity: string[] = []
    const res = await wt.prepare({
      localRepoPath: local,
      worktreePath: wtFor(7),
      pr: pr(7, 'feature', sha2),
      linkNodeModules: true,
      prepareCommand: 'exit 1',
      onActivity: (t) => activity.push(t)
    })
    expect(res.headSha).toBe(sha2)
    expect(await git(wtFor(7), 'rev-parse', 'HEAD')).toBe(sha2)
    expect(activity).toEqual(['Fetching pull/7/head', 'Fetching main', `Checking out ${sha2.slice(0, 7)}`])
    expect((await fs.readFile(join(wtFor(7), 'packages', 'foo', 'index.js'), 'utf8')).trim()).toBe('module.exports = 2')
    expect(await fs.readFile(join(wtFor(7), 'prepared.txt'), 'utf8')).toContain('prepared')
    const list = await git(local, 'worktree', 'list', '--porcelain')
    expect(list.split('\n').filter((l) => l === `worktree ${wtFor(7)}`)).toHaveLength(1)
  })

  it('falls back to fetching the branch when the pull ref does not exist', async () => {
    await git(author, 'checkout', '-q', '-b', 'feature-2')
    const sha3 = await commit(author, 'docs.md', 'docs\n', 'docs')
    await git(author, 'push', '-q', 'origin', 'feature-2')
    const activity: string[] = []
    const res = await wt.prepare({
      localRepoPath: local,
      worktreePath: wtFor(8),
      pr: pr(8, 'feature-2', sha3),
      linkNodeModules: false,
      onActivity: (t) => activity.push(t)
    })
    expect(res.headSha).toBe(sha3)
    expect(await git(wtFor(8), 'rev-parse', 'HEAD')).toBe(sha3)
    expect(activity).toEqual(['Fetching pull/8/head', 'Fetching feature-2', 'Fetching main', 'Creating worktree'])
    await expect(fs.lstat(join(wtFor(8), 'node_modules'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('leaves a healthy worktree alone and reports the error when its checkout fails', async () => {
    await fs.writeFile(join(wtFor(7), 'notes.txt'), 'the user left this here\n')
    const lock = join(await git(wtFor(7), 'rev-parse', '--absolute-git-dir'), 'index.lock')
    await fs.writeFile(lock, '')
    try {
      await expect(wt.prepare({ localRepoPath: local, worktreePath: wtFor(7), pr: pr(7, 'feature', sha1), linkNodeModules: false })).rejects.toThrow(
        new RegExp(`Checking out ${sha1.slice(0, 7)} in .*pr-7 failed`)
      )
      expect(await fs.readFile(join(wtFor(7), 'notes.txt'), 'utf8')).toContain('the user left this here')
      expect(await git(wtFor(7), 'rev-parse', 'HEAD')).toBe(sha2)
    } finally {
      await fs.rm(lock, { force: true })
    }
  })

  it('rebuilds a directory that exists but is not a registered worktree', async () => {
    await fs.mkdir(wtFor(9), { recursive: true })
    await fs.writeFile(join(wtFor(9), 'stale.txt'), 'stale')
    const activity: string[] = []
    await wt.prepare({ localRepoPath: local, worktreePath: wtFor(9), pr: pr(9, 'feature', sha2), linkNodeModules: false, onActivity: (t) => activity.push(t) })
    expect(activity).toContain('Replacing stale worktree directory')
    expect(await git(wtFor(9), 'rev-parse', 'HEAD')).toBe(sha2)
    await expect(fs.stat(join(wtFor(9), 'stale.txt'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('rebuilds a registered worktree that git no longer recognises', async () => {
    await fs.writeFile(join(wtFor(9), '.git'), 'gitdir: /nonexistent/overlook-gitdir\n')
    const activity: string[] = []
    const res = await wt.prepare({ localRepoPath: local, worktreePath: wtFor(9), pr: pr(9, 'feature', sha2), linkNodeModules: false, onActivity: (t) => activity.push(t) })
    expect(res.headSha).toBe(sha2)
    expect(activity).toEqual([
      'Fetching pull/9/head',
      'Fetching main',
      `Checking out ${sha2.slice(0, 7)}`,
      'Rebuilding stale worktree',
      'Replacing stale worktree directory',
      'Creating worktree'
    ])
    expect(await git(wtFor(9), 'rev-parse', 'HEAD')).toBe(sha2)
    const list = await git(local, 'worktree', 'list', '--porcelain')
    expect(list.split('\n').filter((l) => l === `worktree ${wtFor(9)}`)).toHaveLength(1)
  })

  it('still prepares when the base branch cannot be fetched', async () => {
    const activity: string[] = []
    const res = await wt.prepare({
      localRepoPath: local,
      worktreePath: wtFor(16),
      pr: pr(16, 'feature', sha2, 'no-such-base'),
      linkNodeModules: false,
      onActivity: (t) => activity.push(t)
    })
    expect(res.headSha).toBe(sha2)
    expect(activity).toEqual(['Fetching pull/16/head', 'Fetching no-such-base', 'Creating worktree'])
    expect(await git(wtFor(16), 'rev-parse', 'HEAD')).toBe(sha2)
  })

  it('fails clearly when the head commit cannot be fetched', async () => {
    await expect(
      wt.prepare({ localRepoPath: local, worktreePath: wtFor(10), pr: pr(10, 'no-such-branch', 'deadbeef'.repeat(5)), linkNodeModules: false })
    ).rejects.toThrow(/Commit deadbee for acme\/demo#10 was not found after fetching pull\/10\/head and no-such-branch/)
    expect(await wt.exists(wtFor(10))).toBe(false)
  })

  it('fails with the prepare command output when it exits non-zero', async () => {
    const activity: string[] = []
    await expect(
      wt.prepare({
        localRepoPath: local,
        worktreePath: wtFor(11),
        pr: pr(11, 'feature', sha2),
        linkNodeModules: false,
        prepareCommand: 'echo first >&2; echo oops >&2; exit 3',
        onActivity: (t) => activity.push(t)
      })
    ).rejects.toThrow(/Prepare command failed \(exit 3\): echo first >&2; echo oops >&2; exit 3\nfirst\noops/)
    expect(activity).toContain('oops')
  })

  it('rejects when the local path is not a git repository', async () => {
    const plain = join(tmp, 'plain')
    await fs.mkdir(plain, { recursive: true })
    await expect(wt.prepare({ localRepoPath: plain, worktreePath: wtFor(12), pr: pr(12, 'feature', sha2), linkNodeModules: false })).rejects.toThrow(
      /is not a git repository/
    )
  })

  it('stops as soon as the signal is aborted', async () => {
    const ac = new AbortController()
    ac.abort()
    await expect(
      wt.prepare({ localRepoPath: local, worktreePath: wtFor(13), pr: pr(13, 'feature', sha2), linkNodeModules: false, signal: ac.signal })
    ).rejects.toThrow(/abort/i)
    expect(await wt.exists(wtFor(13))).toBe(false)
  })

  it('removes a worktree and reports it gone', async () => {
    await wt.remove(local, wtFor(7))
    expect(await wt.exists(wtFor(7))).toBe(false)
    await expect(fs.stat(wtFor(7))).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await git(local, 'worktree', 'list', '--porcelain')).not.toContain(wtFor(7))
    await wt.remove(local, wtFor(7))
  })

  it('removes a directory git no longer knows about', async () => {
    await fs.mkdir(wtFor(14), { recursive: true })
    await fs.writeFile(join(wtFor(14), 'x'), 'x')
    await wt.remove(local, wtFor(14))
    await expect(fs.stat(wtFor(14))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('refuses to delete a real repository or the main checkout', async () => {
    await expect(wt.remove(local, local)).rejects.toThrow(/main checkout/)
    await expect(wt.remove(local, author)).rejects.toThrow(/not a linked worktree/)
    expect((await fs.stat(join(author, '.git'))).isDirectory()).toBe(true)
    expect(await git(author, 'rev-parse', '--is-inside-work-tree')).toBe('true')
  })

  it('refuses to delete a directory that contains the main checkout', async () => {
    const outer = join(tmp, 'outer')
    const inner = join(outer, 'inner')
    await fs.mkdir(outer, { recursive: true })
    await git(tmp, 'clone', '-q', remote, inner)
    await expect(wt.remove(inner, outer)).rejects.toThrow(/contains the main checkout/)
    await expect(
      wt.prepare({ localRepoPath: inner, worktreePath: outer, pr: pr(15, 'feature', sha2), linkNodeModules: false })
    ).rejects.toThrow(/contains the main checkout/)
    expect((await fs.stat(join(inner, '.git'))).isDirectory()).toBe(true)
  })

  it('reports exists() false for plain directories and missing paths', async () => {
    const plain = join(tmp, 'plain-dir')
    await fs.mkdir(plain, { recursive: true })
    expect(await wt.exists(plain)).toBe(false)
    expect(await wt.exists(join(tmp, 'nope'))).toBe(false)
    expect(await wt.exists(wtFor(8))).toBe(true)
  })

  it('reports exists() false for a plain directory inside a repository', async () => {
    const inside = join(local, 'not-a-worktree')
    await fs.mkdir(inside, { recursive: true })
    expect(await wt.exists(inside)).toBe(false)
    expect(await wt.exists(local)).toBe(true)
  })
})
