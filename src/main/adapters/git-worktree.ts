import { promises as fs } from 'node:fs'
import { dirname, join, resolve, sep } from 'node:path'
import type { PullRequest } from '@core/domain'
import { shortSha } from '@core/domain'
import type { PrepareWorktreeOptions, WorktreePort } from '@core/ports'
import { exec as defaultExec, throwIfAborted } from './exec'
import type { ExecFn, ExecResult } from './exec'
import { expandHome } from './repo-discover'

/** Never let git block on a credential prompt; the app has no terminal to answer it. */
const GIT_ENV = { GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' }
const WORKSPACE_DIRS = ['apps', 'packages']
const STDERR_TAIL = 12
const IGNORABLE_REMOVE = /not a working tree|not a git repository|no such file/i

type Say = (text: string) => void

function lastLines(text: string, n = 5): string {
  return text
    .split('\n')
    .map((l) => l.trimEnd())
    .filter(Boolean)
    .slice(-n)
    .join('\n')
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await fs.stat(path)).isDirectory()
  } catch {
    return false
  }
}

async function entryExists(path: string): Promise<boolean> {
  try {
    await fs.lstat(path)
    return true
  } catch {
    return false
  }
}

async function canonical(path: string): Promise<string> {
  try {
    return await fs.realpath(path)
  } catch {
    return resolve(path)
  }
}

/**
 * A linked worktree carries a `.git` file; a `.git` directory means a full
 * repository, which must never be deleted as if it were disposable. The same
 * goes for the main checkout itself and any directory that contains it.
 */
async function assertDisposable(repo: string, wt: string): Promise<void> {
  const [r, w] = await Promise.all([canonical(repo), canonical(wt)])
  if (r === w) throw new Error(`Refusing to remove ${wt}: it is the main checkout`)
  if (r.startsWith(w.endsWith(sep) ? w : w + sep)) {
    throw new Error(`Refusing to remove ${wt}: it contains the main checkout ${repo}`)
  }
  if (await isDirectory(join(wt, '.git'))) {
    throw new Error(`Refusing to delete ${wt}: it is a git repository, not a linked worktree`)
  }
}

async function linkNodeModules(repo: string, wt: string, say: Say): Promise<void> {
  const candidates = ['node_modules']
  for (const ws of WORKSPACE_DIRS) {
    let entries: string[] = []
    try {
      entries = await fs.readdir(join(repo, ws))
    } catch {
      continue
    }
    for (const name of entries.sort()) {
      if (!name.startsWith('.')) candidates.push(join(ws, name, 'node_modules'))
    }
  }
  let linked = 0
  for (const rel of candidates) {
    const src = join(repo, rel)
    const dst = join(wt, rel)
    if (!(await isDirectory(src))) continue
    if (!(await isDirectory(dirname(dst)))) continue
    if (await entryExists(dst)) continue
    if (linked === 0) say('Linking node_modules from the main checkout')
    await fs.symlink(src, dst, 'dir')
    linked++
  }
}

export class GitWorktree implements WorktreePort {
  private readonly gitPath: string
  private readonly exec: ExecFn

  constructor(opts: { gitPath?: string; exec?: ExecFn } = {}) {
    this.gitPath = opts.gitPath ?? 'git'
    this.exec = opts.exec ?? defaultExec
  }

  async prepare(opts: PrepareWorktreeOptions): Promise<{ worktreePath: string; headSha: string }> {
    const { pr, signal, onActivity } = opts
    const repo = resolve(expandHome(opts.localRepoPath))
    const wt = resolve(expandHome(opts.worktreePath))
    const sha = pr.headSha
    const say: Say = (text) => {
      if (text.trim()) onActivity?.(text)
    }

    const top = await this.git(repo, ['rev-parse', '--show-toplevel'], signal)
    if (top.code !== 0) throw new Error(`${repo} is not a git repository: ${lastLines(top.stderr)}`)

    await this.fetchHead(repo, pr, signal, say)
    await this.fetchBase(repo, pr, signal, say)

    let fresh = false
    const registered = await this.isRegistered(repo, wt, signal)
    const present = await isDirectory(wt)
    if (registered && present) {
      say(`Checking out ${shortSha(sha)}`)
      const checkout = await this.git(wt, ['checkout', '--force', '--detach', sha], signal)
      if (checkout.code !== 0) {
        // Only a worktree git no longer recognises (main repo moved or re-cloned) is rebuilt. A
        // healthy one that failed to check out (a lock, a permission) may hold the user's own
        // files, so the failure is surfaced and the folder left alone.
        if (await this.isWorkingTree(wt, signal)) {
          throw new Error(`Checking out ${shortSha(sha)} in ${wt} failed (exit ${checkout.code}): ${lastLines(checkout.stderr)}`)
        }
        say('Rebuilding stale worktree')
        await this.createFresh(repo, wt, sha, signal, say)
        fresh = true
      }
    } else {
      await this.createFresh(repo, wt, sha, signal, say)
      fresh = true
    }

    if (fresh && opts.linkNodeModules) await linkNodeModules(repo, wt, say)
    if (fresh && opts.prepareCommand) await this.runPrepare(wt, opts.prepareCommand, signal, say)
    throwIfAborted(signal)
    return { worktreePath: wt, headSha: sha }
  }

  async remove(localRepoPath: string, worktreePath: string): Promise<void> {
    const repo = resolve(expandHome(localRepoPath))
    const wt = resolve(expandHome(worktreePath))
    await assertDisposable(repo, wt)
    const removed = await this.git(repo, ['worktree', 'remove', '--force', wt])
    if (removed.code !== 0 && !IGNORABLE_REMOVE.test(removed.stderr)) {
      throw new Error(`git worktree remove failed (exit ${removed.code}): ${lastLines(removed.stderr)}`)
    }
    await this.git(repo, ['worktree', 'prune'])
    if (await entryExists(wt)) await fs.rm(wt, { recursive: true, force: true })
  }

  async exists(worktreePath: string): Promise<boolean> {
    const wt = resolve(expandHome(worktreePath))
    if (!(await isDirectory(wt))) return false
    return this.isWorkingTree(wt)
  }

  /** True when git sees `wt` itself as the top of a working tree. */
  private async isWorkingTree(wt: string, signal?: AbortSignal): Promise<boolean> {
    // --is-inside-work-tree alone is true for any folder under a repository (a dotfiles home included).
    const res = await this.git(wt, ['rev-parse', '--show-toplevel'], signal)
    return res.code === 0 && (await canonical(res.stdout.trim())) === (await canonical(wt))
  }

  private async fetchHead(repo: string, pr: PullRequest, signal: AbortSignal | undefined, say: Say): Promise<void> {
    const pullRef = `pull/${pr.number}/head`
    say(`Fetching ${pullRef}`)
    const viaPull = await this.git(repo, ['fetch', 'origin', `+refs/${pullRef}:refs/overlook/pr-${pr.number}`], signal)
    let failure = viaPull.code === 0 ? undefined : lastLines(viaPull.stderr)
    if (await this.hasCommit(repo, pr.headSha, signal)) return

    say(`Fetching ${pr.headRef}`)
    const viaBranch = await this.git(repo, ['fetch', 'origin', pr.headRef], signal)
    if (viaBranch.code !== 0) failure = lastLines(viaBranch.stderr)
    if (await this.hasCommit(repo, pr.headSha, signal)) return

    throw new Error(
      `Commit ${shortSha(pr.headSha)} for ${pr.repo.fullName}#${pr.number} was not found after fetching ${pullRef} and ${pr.headRef} from origin` +
        (failure ? `: ${failure}` : '')
    )
  }

  /** Refreshes `origin/<base>` so the reviewer's `git diff origin/<base>...HEAD` sees the real change; a stale base is not fatal. */
  private async fetchBase(repo: string, pr: PullRequest, signal: AbortSignal | undefined, say: Say): Promise<void> {
    say(`Fetching ${pr.baseRef}`)
    await this.git(repo, ['fetch', 'origin', pr.baseRef], signal)
  }

  private async hasCommit(repo: string, sha: string, signal?: AbortSignal): Promise<boolean> {
    const res = await this.git(repo, ['cat-file', '-e', `${sha}^{commit}`], signal)
    return res.code === 0
  }

  private async isRegistered(repo: string, wt: string, signal?: AbortSignal): Promise<boolean> {
    const list = await this.must(repo, ['worktree', 'list', '--porcelain'], signal, 'worktree list')
    const target = await canonical(wt)
    for (const line of list.stdout.split('\n')) {
      if (!line.startsWith('worktree ')) continue
      const path = line.slice('worktree '.length).trim()
      if (path === wt || path === target || (await canonical(path)) === target) return true
    }
    return false
  }

  private async createFresh(repo: string, wt: string, sha: string, signal: AbortSignal | undefined, say: Say): Promise<void> {
    if (await entryExists(wt)) {
      await assertDisposable(repo, wt)
      say('Replacing stale worktree directory')
      await fs.rm(wt, { recursive: true, force: true })
    }
    // Prune only once the directory is gone; otherwise git keeps the registration and refuses to add over it.
    await this.git(repo, ['worktree', 'prune'], signal)
    await fs.mkdir(dirname(wt), { recursive: true })
    say('Creating worktree')
    await this.must(repo, ['worktree', 'add', '--detach', wt, sha], signal, 'worktree add')
  }

  private async runPrepare(wt: string, command: string, signal: AbortSignal | undefined, say: Say): Promise<void> {
    say(`Running: ${command}`)
    const tail: string[] = []
    throwIfAborted(signal)
    const res = await this.exec('sh', ['-lc', command], {
      cwd: wt,
      signal,
      env: GIT_ENV,
      onLine: say,
      onErrorLine: (line) => {
        say(line)
        tail.push(line)
        if (tail.length > STDERR_TAIL) tail.shift()
      }
    })
    throwIfAborted(signal)
    if (res.code !== 0) {
      throw new Error(`Prepare command failed (exit ${res.code}): ${command}\n${tail.filter((l) => l.trim()).join('\n')}`.trimEnd())
    }
  }

  private async git(cwd: string, args: string[], signal?: AbortSignal): Promise<ExecResult> {
    throwIfAborted(signal)
    const res = await this.exec(this.gitPath, ['-C', cwd, ...args], { signal, env: GIT_ENV })
    throwIfAborted(signal)
    return res
  }

  private async must(cwd: string, args: string[], signal: AbortSignal | undefined, what: string): Promise<ExecResult> {
    const res = await this.git(cwd, args, signal)
    if (res.code !== 0) throw new Error(`git ${what} failed (exit ${res.code}): ${lastLines(res.stderr)}`)
    return res
  }
}
