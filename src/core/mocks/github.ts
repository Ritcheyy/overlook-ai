import type { PrComment, PullRequest } from '../domain'
import type { Clock, GitHubPort, PullRequestDetail } from '../ports'
import { systemClock } from '../ports'
import { DEMO_LOGIN, seedPullRequests } from '../demo/seed'

const DEMO_REPLY = [
  '### Round 1 findings: disposition',
  '',
  '| # | Finding | Outcome |',
  '| --- | --- | --- |',
  '| 1 | First finding | **Fixed.** Covered by a new test. |',
  "| 2 | Second finding | **Won't fix.** Out of scope for this PR; tracked separately. |"
].join('\n')

export interface PostedComment {
  prId: string
  body: string
  url: string
  at: string
}

/**
 * In-memory GitHub. Browser-safe. `simulate*` methods drive demo scenarios
 * and tests; the scheduler only ever sees the port interface.
 */
export class MockGitHub implements GitHubPort {
  readonly comments: PostedComment[] = []
  /** Every conversation comment per PR, the app's own and simulated replies alike, oldest first. */
  private conversation = new Map<string, PrComment[]>()
  private prs = new Map<string, PullRequest>()
  private counter = 0
  latencyMs = 0
  failNextPost = false

  constructor(
    private opts: { seed?: PullRequest[]; login?: string; clock?: Clock } = {}
  ) {
    const seed = opts.seed ?? seedPullRequests((opts.clock ?? systemClock).now())
    for (const p of seed) this.prs.set(p.id, structuredClone(p))
  }

  private get clock(): Clock {
    return this.opts.clock ?? systemClock
  }

  private async lag(): Promise<void> {
    if (this.latencyMs > 0) await new Promise((r) => setTimeout(r, this.latencyMs))
  }

  async me(): Promise<string> {
    await this.lag()
    return this.opts.login ?? DEMO_LOGIN
  }

  async listReviewRequested(): Promise<PullRequest[]> {
    await this.lag()
    return [...this.prs.values()].filter((p) => p.state === 'open' && p.reviewRequested).map((p) => structuredClone(p))
  }

  async listMine(): Promise<PullRequest[]> {
    await this.lag()
    return [...this.prs.values()].filter((p) => p.state === 'open' && p.mine).map((p) => structuredClone(p))
  }

  async getPullRequest(fullName: string, number: number, opts: { comments?: boolean } = {}): Promise<PullRequestDetail> {
    await this.lag()
    const p = this.prs.get(`${fullName}#${number}`)
    if (!p) throw new Error(`PR ${fullName}#${number} not found`)
    const detail: PullRequestDetail = structuredClone(p)
    if (opts.comments) detail.comments = structuredClone(this.conversation.get(p.id) ?? [])
    return detail
  }

  async getDiff(fullName: string, number: number): Promise<string> {
    await this.lag()
    const p = await this.getPullRequest(fullName, number)
    return `diff --git a/README.md b/README.md\n--- a/README.md\n+++ b/README.md\n@@ -1 +1,2 @@\n # ${p.repo.name}\n+${p.title} (${p.headSha.slice(0, 7)})\n`
  }

  async postComment(fullName: string, number: number, body: string): Promise<{ url: string }> {
    await this.lag()
    if (this.failNextPost) {
      this.failNextPost = false
      throw new Error('GitHub API: 502 Bad Gateway')
    }
    const prId = `${fullName}#${number}`
    if (!this.prs.has(prId)) throw new Error(`PR ${prId} not found`)
    const url = `https://github.com/${fullName}/pull/${number}#issuecomment-${++this.counter}`
    const at = this.clock.now().toISOString()
    this.comments.push({ prId, body, url, at })
    this.addComment(prId, { url, author: this.opts.login ?? DEMO_LOGIN, body, createdAt: at })
    return { url }
  }

  /** All PRs, open or not, for assertions. */
  all(): PullRequest[] {
    return [...this.prs.values()].map((p) => structuredClone(p))
  }

  simulatePush(prId: string): PullRequest {
    const p = this.must(prId)
    const n = (++this.counter).toString(16).padStart(2, '0')
    p.headSha = `${n}${p.headSha.slice(2)}`
    p.updatedAt = this.clock.now().toISOString()
    p.additions = (p.additions ?? 0) + 12
    p.deletions = (p.deletions ?? 0) + 3
    return structuredClone(p)
  }

  /** The PR author answers on the conversation, by default with a disposition for the numbered findings. */
  simulateReply(prId: string, body?: string, author?: string): PrComment {
    const p = this.must(prId)
    const comment: PrComment = {
      url: `https://github.com/${p.repo.fullName}/pull/${p.number}#issuecomment-${++this.counter}`,
      author: author ?? p.author,
      body: body ?? DEMO_REPLY,
      createdAt: this.clock.now().toISOString()
    }
    this.addComment(prId, comment)
    p.updatedAt = comment.createdAt
    return structuredClone(comment)
  }

  private addComment(prId: string, comment: PrComment): void {
    this.conversation.set(prId, [...(this.conversation.get(prId) ?? []), comment])
  }

  simulateClose(prId: string, merged: boolean): PullRequest {
    const p = this.must(prId)
    p.state = merged ? 'merged' : 'closed'
    p.updatedAt = this.clock.now().toISOString()
    return structuredClone(p)
  }

  simulateNewPullRequest(overrides: Partial<PullRequest> = {}): PullRequest {
    const fullName = overrides.repo?.fullName ?? 'acme/checkout-api'
    let number = 900 + ++this.counter
    while (this.prs.has(`${fullName}#${number}`)) number = 900 + ++this.counter
    const [owner, name] = fullName.split('/')
    const now = this.clock.now().toISOString()
    const p: PullRequest = {
      id: `${fullName}#${number}`,
      repo: { host: 'github', owner, name, fullName },
      number,
      title: 'fix: handle empty cart on checkout',
      author: 'mariam-dev',
      url: `https://github.com/${fullName}/pull/${number}`,
      headRef: `fix/empty-cart-${number}`,
      headSha: `${number.toString(16)}0000000000000000000000000000000000`.slice(0, 40),
      baseRef: 'main',
      isDraft: false,
      state: 'open',
      createdAt: now,
      updatedAt: now,
      additions: 30,
      deletions: 4,
      changedFiles: 2,
      labels: [],
      reviewRequested: true,
      mine: false,
      ...overrides
    }
    this.prs.set(p.id, p)
    return structuredClone(p)
  }

  private must(prId: string): PullRequest {
    const p = this.prs.get(prId)
    if (!p) throw new Error(`PR ${prId} not found`)
    return p
  }
}
