import type { PullRequest } from '@core/domain'
import { prIdOf } from '@core/domain'
import type { GitHubPort, PullRequestDetail } from '@core/ports'
import { exec as defaultExec } from './exec'
import type { ExecFn, ExecResult } from './exec'
import { mapDetail, mapDetailToPullRequest, parsePrDetail, parseSearchResults, searchItemId } from './github-map'
import type { GhPrDetail, GhSearchPr } from './github-map'

export type { ExecFn } from './exec'

/** What the search should leave out; read on every listing so settings changes apply to the next poll. */
export interface SearchFilter {
  /** `owner/name` repos whose PRs are dropped before any detail call. */
  inactiveRepos?: string[]
  /** `YYYY-MM-DD`; only PRs updated on or after this date are searched for. */
  updatedSince?: string
}

export const SEARCH_FIELDS = 'number,title,repository,author,url,updatedAt,createdAt,isDraft,labels,state'
export const DETAIL_FIELDS =
  'number,title,body,url,author,headRefName,headRefOid,baseRefName,additions,deletions,changedFiles,state,isDraft,mergedAt,labels,createdAt,updatedAt,reviewRequests,reviewDecision'
/** Watched PRs also need their conversation, to spot the author's reply. */
export const DETAIL_WITH_COMMENTS_FIELDS = `${DETAIL_FIELDS},comments`
const SEARCH_LIMIT = 50
const DETAIL_CONCURRENCY = 4
const DETAIL_CACHE_LIMIT = 500
const GH_TIMEOUT_MS = 2 * 60_000

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

/**
 * GitHub over the `gh` CLI, so the app rides on the user's existing login and
 * never handles a token. Detail payloads are cached by (id, updatedAt) so a
 * poll only re-fetches PRs that actually changed.
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
   * Directly requested reviews plus reviews requested from any of my teams.
   * Team searches are extra credit: a failing one is skipped rather than
   * failing the poll.
   */
  async listReviewRequested(): Promise<PullRequest[]> {
    const [direct, teams] = await Promise.all([this.search(['--review-requested=@me'], true), this.teams()])
    const seen = new Set(direct.map((p) => p.id))
    const merged = [...direct]
    for (const team of teams) {
      let prs: PullRequest[]
      try {
        prs = await this.search([`team-review-requested:${team}`], true)
      } catch {
        continue
      }
      for (const pr of prs) {
        if (seen.has(pr.id)) continue
        seen.add(pr.id)
        merged.push(pr)
      }
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
    const [me, detail] = await Promise.all([this.me(), this.fetchDetail(fullName, number, opts.comments)])
    this.remember(prIdOf(fullName, number), detail.updatedAt, detail)
    return opts.comments ? mapDetail(fullName, detail, { me }) : mapDetailToPullRequest(fullName, detail, { me })
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
    const details = await mapLimit(items, DETAIL_CONCURRENCY, (item) => this.detailFor(item))
    return items.map((item, i) =>
      mapDetailToPullRequest(item.repository.nameWithOwner, details[i]!, { me, reviewRequested })
    )
  }

  private async detailFor(item: GhSearchPr): Promise<GhPrDetail> {
    const id = searchItemId(item)
    const cached = this.details.get(id)
    if (cached && cached.updatedAt === item.updatedAt) return cached.detail
    const detail = await this.fetchDetail(item.repository.nameWithOwner, item.number)
    this.remember(id, item.updatedAt, detail)
    return detail
  }

  private async fetchDetail(fullName: string, number: number, comments = false): Promise<GhPrDetail> {
    const out = await this.gh(['pr', 'view', String(number), '--repo', fullName, '--json', comments ? DETAIL_WITH_COMMENTS_FIELDS : DETAIL_FIELDS])
    return parsePrDetail(out)
  }

  private remember(id: string, updatedAt: string, detail: GhPrDetail): void {
    this.details.delete(id)
    this.details.set(id, { updatedAt, detail })
    if (this.details.size > DETAIL_CACHE_LIMIT) {
      const oldest = this.details.keys().next().value
      if (oldest !== undefined) this.details.delete(oldest)
    }
  }

  private async gh(args: string[], opts: { input?: string } = {}): Promise<string> {
    let res: ExecResult
    try {
      res = await this.exec(this.ghPath, args, { input: opts.input, env: GH_ENV, timeoutMs: GH_TIMEOUT_MS })
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new Error(`GitHub CLI not found at "${this.ghPath}". Install it from https://cli.github.com and run: gh auth login`)
      }
      throw e
    }
    if (res.code !== 0) throw ghError(args, res)
    return res.stdout
  }
}
