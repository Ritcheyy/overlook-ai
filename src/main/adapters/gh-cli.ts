import type { PullRequest } from '@core/domain'
import { prIdOf } from '@core/domain'
import type { GitHubPort, PullRequestDetail, PullRequestRef } from '@core/ports'
import { exec as defaultExec } from './exec'
import type { ExecFn, ExecResult } from './exec'
import { mapDetail, mapDetailToPullRequest, parseGraphqlDetails, parseSearchResults, searchItemId } from './github-map'
import type { GhPrDetail } from './github-map'

export type { ExecFn } from './exec'

/** What the search should leave out; read on every listing so settings changes apply to the next poll. */
export interface SearchFilter {
  /** `owner/name` repos whose PRs are dropped before any detail call. */
  inactiveRepos?: string[]
  /** `YYYY-MM-DD`; only PRs updated on or after this date are searched for. */
  updatedSince?: string
}

export const SEARCH_FIELDS = 'number,title,repository,author,url,updatedAt,createdAt,isDraft,labels,state'
const SEARCH_LIMIT = 50
/** PRs per GraphQL call. GitHub charges per node asked for, so a batch this size stays under 30 points of the hourly 5000. */
export const DETAIL_BATCH = 20
const BATCH_CONCURRENCY = 3
/** The newest comments are the ones a reply shows up in. */
const COMMENTS_LAST = 50
const LABELS_FIRST = 30
const REVIEW_REQUESTS_FIRST = 30
const DETAIL_CACHE_LIMIT = 500
const GH_TIMEOUT_MS = 2 * 60_000
const NAME = /^[A-Za-z0-9_.-]+$/

/** Keeps gh quiet and non-interactive: no update nags, prompts, pager, or colour. */
export const GH_ENV = {
  GH_NO_UPDATE_NOTIFIER: '1',
  GH_PROMPT_DISABLED: '1',
  GH_PAGER: 'cat',
  PAGER: 'cat',
  NO_COLOR: '1',
  CLICOLOR: '0'
}

export function ghError(args: string[], res: ExecResult): Error {
  const detail = res.stderr.trim() || res.stdout.trim() || `exit code ${res.code}`
  const base = `gh ${args.slice(0, 2).join(' ')} failed (exit ${res.code}): ${detail}`
  if (/auth login|not logged/i.test(res.stderr)) {
    return new Error(`GitHub CLI is not logged in. Run: gh auth login\n${base}`)
  }
  return new Error(base)
}

async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array<R>(items.length)
  let next = 0
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const i = next++
      results[i] = await fn(items[i]!)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}

const PR_FRAGMENT = `fragment Pr on PullRequest { number title body url author { login } headRefName headRefOid baseRefName additions deletions changedFiles state isDraft mergedAt createdAt updatedAt reviewDecision labels(first: ${LABELS_FIRST}) { nodes { name } } reviewRequests(first: ${REVIEW_REQUESTS_FIRST}) { nodes { requestedReviewer { ... on User { login } ... on Team { name slug } ... on Mannequin { login } ... on Bot { login } } } } }`
const COMMENTS_FIELD = `comments(last: ${COMMENTS_LAST}) { nodes { author { login } body createdAt url } }`

/** One query for a batch of PRs, aliased `p0`, `p1`, … in the order given. */
export function detailsQuery(refs: readonly PullRequestRef[]): string {
  const parts = refs.map((ref, i) => {
    const [owner, name] = ref.fullName.split('/')
    return `p${i}: repository(owner: ${JSON.stringify(owner)}, name: ${JSON.stringify(name)}) { pullRequest(number: ${ref.number}) { ...Pr ${ref.comments ? COMMENTS_FIELD : ''}} }`
  })
  return `query { ${parts.join(' ')} }\n${PR_FRAGMENT}`
}

/**
 * GitHub over the `gh` CLI, so the app rides on the user's existing login and
 * never handles a token. Listings come from `gh search`, details from one
 * GraphQL query per batch of PRs, cached by (id, updatedAt) so a poll only
 * re-fetches PRs that actually changed.
 */
export class GhCliGitHub implements GitHubPort {
  private readonly ghPath: string
  private readonly exec: ExecFn
  private readonly filter: () => SearchFilter
  private loginPromise?: Promise<string>
  private teamsPromise?: Promise<string[]>
  private readonly details = new Map<string, { updatedAt: string; detail: GhPrDetail }>()

  constructor(opts: { ghPath?: string; exec?: ExecFn; filter?: () => SearchFilter } = {}) {
    this.ghPath = opts.ghPath ?? 'gh'
    this.exec = opts.exec ?? defaultExec
    this.filter = opts.filter ?? (() => ({}))
  }

  me(): Promise<string> {
    if (!this.loginPromise) {
      const p = this.gh(['api', 'user', '--jq', '.login']).then((out) => {
        const login = out.trim()
        if (!login) throw new Error('gh api user returned an empty login')
        return login
      })
      this.loginPromise = p
      p.catch(() => {
        if (this.loginPromise === p) this.loginPromise = undefined
      })
    }
    return this.loginPromise
  }

  /**
   * Directly requested reviews plus reviews requested from any of my teams,
   * searched side by side. Team searches are extra credit: a failing one is
   * skipped rather than failing the poll.
   */
  async listReviewRequested(): Promise<PullRequest[]> {
    const [direct, teams] = await Promise.all([this.search(['--review-requested=@me'], true), this.teams()])
    const perTeam = await Promise.all(teams.map((team) => this.search([`team-review-requested:${team}`], true).catch((): PullRequest[] => [])))
    const seen = new Set(direct.map((p) => p.id))
    const merged = [...direct]
    for (const pr of perTeam.flat()) {
      if (seen.has(pr.id)) continue
      seen.add(pr.id)
      merged.push(pr)
    }
    return merged
  }

  /** `org/slug` for every team I belong to; empty (and retried next time) when gh cannot list them. */
  private teams(): Promise<string[]> {
    if (!this.teamsPromise) {
      const p: Promise<string[]> = this.gh(['api', 'user/teams', '--paginate', '--jq', '.[] | "\\(.organization.login)/\\(.slug)"'])
        .then((out) =>
          out
            .split('\n')
            .map((l) => l.trim())
            .filter((l) => /^[^\s/]+\/[^\s/]+$/.test(l))
        )
        .catch(() => {
          if (this.teamsPromise === p) this.teamsPromise = undefined
          return []
        })
      this.teamsPromise = p
    }
    return this.teamsPromise
  }

  listMine(): Promise<PullRequest[]> {
    return this.search(['--author=@me'], false)
  }

  async getPullRequest(fullName: string, number: number, opts: { comments?: boolean } = {}): Promise<PullRequestDetail> {
    const got = await this.getPullRequests([{ fullName, number, comments: opts.comments }])
    const pr = got.get(prIdOf(fullName, number))
    if (!pr) throw new Error(`${fullName}#${number} could not be read from GitHub`)
    return pr
  }

  async getPullRequests(refs: readonly PullRequestRef[]): Promise<Map<string, PullRequestDetail>> {
    const [me, details] = await Promise.all([this.me(), this.fetchDetails(refs)])
    const out = new Map<string, PullRequestDetail>()
    for (const ref of refs) {
      const id = prIdOf(ref.fullName, ref.number)
      const detail = details.get(id)
      if (!detail || out.has(id)) continue
      this.remember(id, detail.updatedAt, detail)
      out.set(id, ref.comments ? mapDetail(ref.fullName, detail, { me }) : mapDetailToPullRequest(ref.fullName, detail, { me }))
    }
    return out
  }

  async getDiff(fullName: string, number: number): Promise<string> {
    return this.gh(['pr', 'diff', String(number), '--repo', fullName])
  }

  async postComment(fullName: string, number: number, body: string): Promise<{ url: string }> {
    const out = await this.gh(['pr', 'comment', String(number), '--repo', fullName, '--body-file', '-'], { input: body })
    const url = out
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .pop()
    if (!url) throw new Error(`gh pr comment on ${fullName}#${number} did not return a comment URL`)
    return { url }
  }

  private async search(query: string[], reviewRequested: boolean): Promise<PullRequest[]> {
    const { inactiveRepos = [], updatedSince } = this.filter()
    const args = ['search', 'prs', ...query, '--state=open', '--sort', 'updated', '--limit', String(SEARCH_LIMIT), '--json', SEARCH_FIELDS]
    if (updatedSince) args.push('--updated', `>=${updatedSince}`)
    const [me, out] = await Promise.all([this.me(), this.gh(args)])
    const inactive = new Set(inactiveRepos)
    const items = parseSearchResults(out).filter((item) => !inactive.has(item.repository.nameWithOwner))
    // The search index's stamp decides staleness: the detail's own may lag it by seconds.
    const changed = items.filter((item) => this.details.get(searchItemId(item))?.updatedAt !== item.updatedAt)
    const fetched = await this.fetchDetails(changed.map((item) => ({ fullName: item.repository.nameWithOwner, number: item.number })))
    for (const item of changed) {
      const detail = fetched.get(searchItemId(item))
      if (detail) this.remember(searchItemId(item), item.updatedAt, detail)
    }
    const prs: PullRequest[] = []
    for (const item of items) {
      const detail = this.details.get(searchItemId(item))?.detail
      // A PR the batch could not read (gone, or access lost) sits out until the next poll.
      if (detail) prs.push(mapDetailToPullRequest(item.repository.nameWithOwner, detail, { me, reviewRequested }))
    }
    return prs
  }

  /** Details for every readable ref, a batch per query and three queries at a time. */
  private async fetchDetails(refs: readonly PullRequestRef[]): Promise<Map<string, GhPrDetail>> {
    const wanted = new Map<string, PullRequestRef>()
    for (const ref of refs) {
      const [owner, name, ...rest] = ref.fullName.split('/')
      if (!owner || !name || rest.length > 0 || !NAME.test(owner) || !NAME.test(name) || !Number.isInteger(ref.number)) continue
      const id = prIdOf(ref.fullName, ref.number)
      wanted.set(id, { fullName: ref.fullName, number: ref.number, comments: !!(wanted.get(id)?.comments || ref.comments) })
    }
    const list = [...wanted.values()]
    const batches: PullRequestRef[][] = []
    for (let i = 0; i < list.length; i += DETAIL_BATCH) batches.push(list.slice(i, i + DETAIL_BATCH))
    const results = await mapLimit(batches, BATCH_CONCURRENCY, async (batch) => {
      const out = await this.gh(['api', 'graphql', '-f', `query=${detailsQuery(batch)}`], { partial: true })
      return parseGraphqlDetails(out, batch.map((ref, i) => ({ alias: `p${i}`, fullName: ref.fullName })))
    })
    const merged = new Map<string, GhPrDetail>()
    for (const result of results) for (const [id, detail] of result) merged.set(id, detail)
    return merged
  }

  private remember(id: string, updatedAt: string, detail: GhPrDetail): void {
    this.details.delete(id)
    this.details.set(id, { updatedAt, detail })
    if (this.details.size > DETAIL_CACHE_LIMIT) {
      const oldest = this.details.keys().next().value
      if (oldest !== undefined) this.details.delete(oldest)
    }
  }

  private async gh(args: string[], opts: { input?: string; partial?: boolean } = {}): Promise<string> {
    let res: ExecResult
    try {
      res = await this.exec(this.ghPath, args, { input: opts.input, env: GH_ENV, timeoutMs: GH_TIMEOUT_MS })
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new Error(`GitHub CLI not found at "${this.ghPath}". Install it from https://cli.github.com and run: gh auth login`)
      }
      throw e
    }
    // A GraphQL batch with one unreadable PR exits 1 but still prints the rest; the parser keeps what resolved.
    if (res.code !== 0 && !(opts.partial && res.stdout.trim().startsWith('{'))) throw ghError(args, res)
    return res.stdout
  }
}
