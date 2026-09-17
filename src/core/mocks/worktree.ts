import type { PrepareWorktreeOptions, WorktreePort } from '../ports'

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(new Error('aborted'))
    const t = setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => {
      clearTimeout(t)
      reject(new Error('aborted'))
    })
  })

/** In-memory worktrees. `stepMs` paces the fake fetch/checkout for demos. */
export class MockWorktree implements WorktreePort {
  readonly trees = new Map<string, { headSha: string; localRepoPath: string; prepared: number }>()
  failNext = false

  constructor(public stepMs = 0) {}

  async prepare(opts: PrepareWorktreeOptions): Promise<{ worktreePath: string; headSha: string }> {
    const { worktreePath, pr, onActivity, signal } = opts
    if (this.failNext) {
      this.failNext = false
      throw new Error(`git fetch failed: could not read from remote for ${pr.repo.fullName}`)
    }
    const existing = this.trees.get(worktreePath)
    onActivity?.(existing ? `Fetching ${pr.headRef}` : `Fetching pull/${pr.number}/head`)
    await sleep(this.stepMs, signal)
    onActivity?.(existing ? `Checking out ${pr.headSha.slice(0, 7)}` : `Creating worktree at ${worktreePath}`)
    await sleep(this.stepMs, signal)
    if (!existing && opts.linkNodeModules) {
      onActivity?.('Linking node_modules from the main checkout')
      await sleep(this.stepMs / 2, signal)
    }
    if (!existing && opts.prepareCommand) {
      onActivity?.(`Running: ${opts.prepareCommand}`)
      await sleep(this.stepMs, signal)
    }
    this.trees.set(worktreePath, {
      headSha: pr.headSha,
      localRepoPath: opts.localRepoPath,
      prepared: (existing?.prepared ?? 0) + 1
    })
    return { worktreePath, headSha: pr.headSha }
  }

  async remove(_localRepoPath: string, worktreePath: string): Promise<void> {
    this.trees.delete(worktreePath)
  }

  async exists(worktreePath: string): Promise<boolean> {
    return this.trees.has(worktreePath)
  }
}
