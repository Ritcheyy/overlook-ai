import { describe, expect, it } from 'vitest'
import type { ExecFn, ExecOptions, ExecResult } from './exec'
import { DETAIL_FIELDS, DETAIL_WITH_COMMENTS_FIELDS, GhCliGitHub, SEARCH_FIELDS } from './gh-cli'

interface Call {
  cmd: string
  args: string[]
  opts?: ExecOptions
}

type Handler = (args: string[], opts?: ExecOptions) => ExecResult | Promise<ExecResult>

function ok(stdout: string): ExecResult {
  return { stdout, stderr: '', code: 0 }
}

function fakeGh(handler: Handler): { exec: ExecFn; calls: Call[] } {
  const calls: Call[] = []
  const exec: ExecFn = async (cmd, args, opts) => {
    calls.push({ cmd, args, opts })
    return handler(args, opts)
  }
  return { exec, calls }
}

function searchItem(fullName: string, number: number, updatedAt: string, author = 'dami-codes'): Record<string, unknown> {
  return {
    number,
    title: `PR ${number}`,
    repository: { name: fullName.split('/')[1], nameWithOwner: fullName },
    author: { login: author, is_bot: false },
    url: `https://github.com/${fullName}/pull/${number}`,
    updatedAt,
    createdAt: '2026-09-13T08:00:00Z',
    isDraft: false,
    labels: [{ name: 'backend' }],
    state: 'open'
  }
}

function detail(fullName: string, number: number, updatedAt: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    number,
    title: `PR ${number}`,
    body: 'body',
    url: `https://github.com/${fullName}/pull/${number}`,
    author: { login: 'dami-codes' },
    headRefName: `feat/${number}`,
    headRefOid: `${number}`.padEnd(40, '0'),
    baseRefName: 'main',
    additions: 1,
    deletions: 2,
    changedFiles: 3,
    state: 'OPEN',
    isDraft: false,
    mergedAt: null,
    labels: [{ name: 'backend' }],
    createdAt: '2026-09-13T08:00:00Z',
    updatedAt,
    reviewRequests: [],
    ...extra
  }
}

function repoAndNumber(args: string[]): { fullName: string; number: number } {
  return { fullName: args[args.indexOf('--repo') + 1]!, number: Number(args[2]) }
}

describe('GhCliGitHub', () => {
  it('reads the login once and caches it', async () => {
    const { exec, calls } = fakeGh(() => ok('octo-reviewer\n'))
    const gh = new GhCliGitHub({ exec })
    expect(await gh.me()).toBe('octo-reviewer')
    expect(await gh.me()).toBe('octo-reviewer')
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({ cmd: 'gh', args: ['api', 'user', '--jq', '.login'] })
    expect(calls[0]!.opts?.env).toMatchObject({ GH_NO_UPDATE_NOTIFIER: '1', GH_PROMPT_DISABLED: '1' })
  })

  it('retries the login after a failure', async () => {
    let n = 0
    const { exec } = fakeGh(() => (++n === 1 ? { stdout: '', stderr: 'boom', code: 1 } : ok('octo-reviewer')))
    const gh = new GhCliGitHub({ exec, ghPath: '/opt/homebrew/bin/gh' })
    await expect(gh.me()).rejects.toThrow(/boom/)
    expect(await gh.me()).toBe('octo-reviewer')
  })

  it('lists review-requested PRs by combining search results with detail calls', async () => {
    const { exec, calls } = fakeGh((args) => {
      if (args[0] === 'api') return ok('octo-reviewer')
      if (args[0] === 'search') {
        return ok(JSON.stringify([searchItem('acme/checkout-api', 412, 't1'), searchItem('acme/storefront-web', 1203, 't2')]))
      }
      if (args[0] === 'pr' && args[1] === 'view') {
        const { fullName, number } = repoAndNumber(args)
        return ok(JSON.stringify(detail(fullName, number, number === 412 ? 't1' : 't2')))
      }
      throw new Error(`unexpected ${args.join(' ')}`)
    })
    const gh = new GhCliGitHub({ exec })
    const prs = await gh.listReviewRequested()

    expect(prs.map((p) => p.id)).toEqual(['acme/checkout-api#412', 'acme/storefront-web#1203'])
    expect(prs[0]).toMatchObject({ headRef: 'feat/412', baseRef: 'main', reviewRequested: true, mine: false, labels: ['backend'] })
    const search = calls.find((c) => c.args[0] === 'search')!
    expect(search.args).toEqual(['search', 'prs', '--review-requested=@me', '--state=open', '--sort', 'updated', '--limit', '50', '--json', SEARCH_FIELDS])
    expect(calls.find((c) => c.args[1] === 'user/teams')?.args).toEqual(['api', 'user/teams', '--paginate', '--jq', '.[] | "\\(.organization.login)/\\(.slug)"'])
    const views = calls.filter((c) => c.args[1] === 'view')
    expect(views).toHaveLength(2)
    expect(views[0]!.args).toEqual(['pr', 'view', '412', '--repo', 'acme/checkout-api', '--json', DETAIL_FIELDS])
  })

  it('lists my PRs with --author=@me and marks them mine', async () => {
    const { exec, calls } = fakeGh((args) => {
      if (args[0] === 'api') return ok('octo-reviewer')
      if (args[0] === 'search') return ok(JSON.stringify([searchItem('acme/checkout-api', 419, 't1', 'octo-reviewer')]))
      const { fullName, number } = repoAndNumber(args)
      return ok(JSON.stringify(detail(fullName, number, 't1', { author: { login: 'octo-reviewer' } })))
    })
    const prs = await new GhCliGitHub({ exec }).listMine()
    expect(prs).toHaveLength(1)
    expect(prs[0]).toMatchObject({ mine: true, reviewRequested: false })
    expect(calls.find((c) => c.args[0] === 'search')!.args).toContain('--author=@me')
  })

  it('skips detail calls for PRs whose updatedAt is unchanged since the last poll', async () => {
    let stamp412 = 't1'
    const { exec, calls } = fakeGh((args) => {
      if (args[0] === 'api') return ok('octo-reviewer')
      if (args[0] === 'search') return ok(JSON.stringify([searchItem('acme/checkout-api', 412, stamp412), searchItem('acme/checkout-api', 413, 't1')]))
      const { fullName, number } = repoAndNumber(args)
      return ok(JSON.stringify(detail(fullName, number, number === 412 ? stamp412 : 't1', { headRefOid: `${stamp412}`.padEnd(40, '0') })))
    })
    const gh = new GhCliGitHub({ exec })
    await gh.listReviewRequested()
    expect(calls.filter((c) => c.args[1] === 'view')).toHaveLength(2)

    await gh.listReviewRequested()
    expect(calls.filter((c) => c.args[1] === 'view')).toHaveLength(2)

    stamp412 = 't9'
    const prs = await gh.listReviewRequested()
    const views = calls.filter((c) => c.args[1] === 'view')
    expect(views).toHaveLength(3)
    expect(views[2]!.args[2]).toBe('412')
    expect(prs.find((p) => p.number === 412)!.headSha).toBe('t9'.padEnd(40, '0'))
  })

  it('applies the search filter: --updated for the age cut-off and no detail call for inactive repos', async () => {
    let filter: { inactiveRepos?: string[]; updatedSince?: string } = {}
    // A fresh stamp per search defeats the detail cache, so a skipped view call can only come from the filter.
    let stamp = 0
    const { exec, calls } = fakeGh((args) => {
      if (args[0] === 'api') return ok('octo-reviewer')
      if (args[0] === 'search') return ok(JSON.stringify([searchItem('acme/checkout-api', 412, `t${++stamp}`), searchItem('acme/legacy', 9, `t${stamp}`)]))
      const { fullName, number } = repoAndNumber(args)
      return ok(JSON.stringify(detail(fullName, number, `t${stamp}`)))
    })
    const gh = new GhCliGitHub({ exec, filter: () => filter })

    expect((await gh.listReviewRequested()).map((p) => p.id)).toEqual(['acme/checkout-api#412', 'acme/legacy#9'])
    expect(calls.find((c) => c.args[0] === 'search')!.args).not.toContain('--updated')
    expect(calls.filter((c) => c.args[1] === 'view')).toHaveLength(2)

    calls.length = 0
    filter = { inactiveRepos: ['acme/legacy'], updatedSince: '2026-08-14' }
    const prs = await gh.listMine()
    expect(prs.map((p) => p.id)).toEqual(['acme/checkout-api#412'])
    const search = calls.find((c) => c.args[0] === 'search')!.args
    expect(search.slice(-2)).toEqual(['--updated', '>=2026-08-14'])
    expect(search).toContain('--author=@me')
    expect(calls.filter((c) => c.args[1] === 'view').map((c) => c.args[4])).toEqual(['acme/checkout-api'])

    calls.length = 0
    filter = { inactiveRepos: ['acme/checkout-api', 'acme/legacy'] }
    expect(await gh.listReviewRequested()).toEqual([])
    expect(calls.filter((c) => c.args[1] === 'view')).toHaveLength(0)
  })

  it('runs at most four detail calls at a time', async () => {
    let inFlight = 0
    let peak = 0
    const items = Array.from({ length: 10 }, (_, i) => searchItem('acme/checkout-api', 100 + i, 't1'))
    const { exec } = fakeGh(async (args) => {
      if (args[0] === 'api') return ok('octo-reviewer')
      if (args[0] === 'search') return ok(JSON.stringify(items))
      inFlight++
      peak = Math.max(peak, inFlight)
      await new Promise((r) => setTimeout(r, 2))
      inFlight--
      const { fullName, number } = repoAndNumber(args)
      return ok(JSON.stringify(detail(fullName, number, 't1')))
    })
    const prs = await new GhCliGitHub({ exec }).listReviewRequested()
    expect(prs).toHaveLength(10)
    expect(prs.map((p) => p.number)).toEqual(items.map((i) => i['number']))
    expect(peak).toBe(4)
  })

  it('fetches one PR and computes reviewRequested from reviewRequests', async () => {
    const { exec } = fakeGh((args) => {
      if (args[0] === 'api') return ok('octo-reviewer')
      const { fullName, number } = repoAndNumber(args)
      return ok(JSON.stringify(detail(fullName, number, 't1', { state: 'MERGED', mergedAt: '2026-09-13T12:00:00Z', reviewRequests: [{ login: 'octo-Reviewer' }] })))
    })
    const pr = await new GhCliGitHub({ exec }).getPullRequest('acme/checkout-api', 412)
    expect(pr).toMatchObject({ id: 'acme/checkout-api#412', state: 'merged', reviewRequested: true, mine: false })
  })

  it('asks for the conversation only when told to, and maps it with the review decision', async () => {
    const { exec, calls } = fakeGh((args) => {
      if (args[0] === 'api') return ok('octo-reviewer')
      const { fullName, number } = repoAndNumber(args)
      return ok(
        JSON.stringify(
          detail(fullName, number, 't1', {
            reviewDecision: 'APPROVED',
            comments: [
              { author: { login: 'dami-codes' }, body: 'Fixed both.', createdAt: '2026-09-13T12:00:00Z', url: 'https://github.com/acme/checkout-api/pull/412#issuecomment-7', id: 'IC_1' },
              { author: null, body: null, createdAt: '2026-09-13T12:01:00Z', url: 'https://github.com/acme/checkout-api/pull/412#issuecomment-8' }
            ]
          })
        )
      )
    })
    const gh = new GhCliGitHub({ exec })
    const plain = await gh.getPullRequest('acme/checkout-api', 412)
    expect(calls.find((c) => c.args[0] === 'pr')!.args).toEqual(['pr', 'view', '412', '--repo', 'acme/checkout-api', '--json', DETAIL_FIELDS])
    expect(plain.comments).toBeUndefined()
    expect(plain.reviewDecision).toBe('approved')
    const withComments = await gh.getPullRequest('acme/checkout-api', 412, { comments: true })
    expect(calls.filter((c) => c.args[0] === 'pr').pop()!.args).toEqual(['pr', 'view', '412', '--repo', 'acme/checkout-api', '--json', DETAIL_WITH_COMMENTS_FIELDS])
    expect(withComments.comments).toEqual([
      { url: 'https://github.com/acme/checkout-api/pull/412#issuecomment-7', author: 'dami-codes', body: 'Fixed both.', createdAt: '2026-09-13T12:00:00Z' },
      { url: 'https://github.com/acme/checkout-api/pull/412#issuecomment-8', author: 'ghost', body: '', createdAt: '2026-09-13T12:01:00Z' }
    ])
  })

  it('returns the diff verbatim', async () => {
    const { exec, calls } = fakeGh(() => ok('diff --git a/x b/x\n'))
    expect(await new GhCliGitHub({ exec }).getDiff('acme/checkout-api', 412)).toBe('diff --git a/x b/x\n')
    expect(calls[0]!.args).toEqual(['pr', 'diff', '412', '--repo', 'acme/checkout-api'])
  })

  it('posts a comment through stdin and returns the URL from the last stdout line', async () => {
    const { exec, calls } = fakeGh(() => ok('\nhttps://github.com/acme/checkout-api/pull/412#issuecomment-99\n\n'))
    const res = await new GhCliGitHub({ exec }).postComment('acme/checkout-api', 412, '## Review\n\nlooks good')
    expect(res).toEqual({ url: 'https://github.com/acme/checkout-api/pull/412#issuecomment-99' })
    expect(calls[0]!.args).toEqual(['pr', 'comment', '412', '--repo', 'acme/checkout-api', '--body-file', '-'])
    expect(calls[0]!.opts?.input).toBe('## Review\n\nlooks good')
  })

  it('fails when the comment URL is missing', async () => {
    const { exec } = fakeGh(() => ok(''))
    await expect(new GhCliGitHub({ exec }).postComment('acme/checkout-api', 412, 'x')).rejects.toThrow(/did not return a comment URL/)
  })

  it('surfaces stderr on failure and explains a missing login', async () => {
    const { exec } = fakeGh(() => ({ stdout: '', stderr: 'To get started with GitHub CLI, please run:  gh auth login', code: 4 }))
    await expect(new GhCliGitHub({ exec }).getDiff('acme/checkout-api', 1)).rejects.toThrow(
      /^GitHub CLI is not logged in\. Run: gh auth login\ngh pr diff failed \(exit 4\): To get started/
    )
    const { exec: exec2 } = fakeGh(() => ({ stdout: '', stderr: 'GraphQL: Could not resolve to a PullRequest', code: 1 }))
    await expect(new GhCliGitHub({ exec: exec2 }).getDiff('acme/checkout-api', 1)).rejects.toThrow(/^gh pr diff failed \(exit 1\): GraphQL: Could not resolve/)
  })

  it('explains when gh is not installed', async () => {
    const exec: ExecFn = async () => {
      throw Object.assign(new Error('spawn gh ENOENT'), { code: 'ENOENT' })
    }
    await expect(new GhCliGitHub({ exec }).me()).rejects.toThrow(/GitHub CLI not found at "gh"/)
  })

  describe('team review requests', () => {
    const teamSearch = (args: string[]): string | undefined => args.find((a) => a.startsWith('team-review-requested:'))?.split(':')[1]

    function teamAware(opts: { teams: ExecResult; platformFails?: boolean }): Handler {
      return (args) => {
        if (args[0] === 'api' && args[1] === 'user') return ok('octo-reviewer')
        if (args[0] === 'api' && args[1] === 'user/teams') return opts.teams
        if (args[0] === 'search') {
          const team = teamSearch(args)
          if (!team) return ok(JSON.stringify([searchItem('acme/checkout-api', 412, 't1')]))
          if (team === 'acme/backend') return ok(JSON.stringify([searchItem('acme/checkout-api', 412, 't1'), searchItem('acme/storefront-web', 500, 't3')]))
          if (team === 'acme/platform' && opts.platformFails) return { stdout: '', stderr: 'GraphQL: something broke', code: 1 }
          return ok('[]')
        }
        const { fullName, number } = repoAndNumber(args)
        return ok(JSON.stringify(detail(fullName, number, number === 500 ? 't3' : 't1')))
      }
    }

    it('adds PRs requested from my teams, deduplicated, with one search per team', async () => {
      const { exec, calls } = fakeGh(teamAware({ teams: ok('acme/backend\nacme/platform\n') }))
      const gh = new GhCliGitHub({ exec })
      const prs = await gh.listReviewRequested()

      expect(prs.map((p) => p.id)).toEqual(['acme/checkout-api#412', 'acme/storefront-web#500'])
      expect(prs.every((p) => p.reviewRequested)).toBe(true)
      const searches = calls.filter((c) => c.args[0] === 'search').map((c) => c.args)
      expect(searches).toHaveLength(3)
      expect(searches[0]!).toContain('--review-requested=@me')
      expect(searches[1]!.slice(0, 7)).toEqual(['search', 'prs', 'team-review-requested:acme/backend', '--state=open', '--sort', 'updated', '--limit'])
      expect(searches[2]![2]).toBe('team-review-requested:acme/platform')
      expect(calls.filter((c) => c.args[1] === 'view')).toHaveLength(2)

      await gh.listReviewRequested()
      expect(calls.filter((c) => c.args[1] === 'user/teams')).toHaveLength(1)
    })

    it('skips a team whose search fails and keeps the rest', async () => {
      const { exec } = fakeGh(teamAware({ teams: ok('acme/platform\nacme/backend\n'), platformFails: true }))
      const prs = await new GhCliGitHub({ exec }).listReviewRequested()
      expect(prs.map((p) => p.id)).toEqual(['acme/checkout-api#412', 'acme/storefront-web#500'])
    })

    it('falls back to the direct search when teams cannot be listed, and retries next time', async () => {
      let teamsCalls = 0
      const { exec, calls } = fakeGh((args) => {
        if (args[0] === 'api' && args[1] === 'user/teams') {
          teamsCalls++
          return teamsCalls === 1 ? { stdout: '', stderr: 'HTTP 403: read:org scope missing', code: 1 } : ok('acme/backend\n')
        }
        return teamAware({ teams: ok('') })(args)
      })
      const gh = new GhCliGitHub({ exec })
      expect((await gh.listReviewRequested()).map((p) => p.id)).toEqual(['acme/checkout-api#412'])
      expect(calls.filter((c) => c.args[0] === 'search')).toHaveLength(1)

      expect((await gh.listReviewRequested()).map((p) => p.id)).toEqual(['acme/checkout-api#412', 'acme/storefront-web#500'])
      expect(teamsCalls).toBe(2)
    })

    it('ignores malformed team lines', async () => {
      const { exec, calls } = fakeGh(teamAware({ teams: ok('\nocto-reviewer\nacme/backend\nnot a team\n') }))
      await new GhCliGitHub({ exec }).listReviewRequested()
      const teamSearches = calls.filter((c) => c.args[0] === 'search' && teamSearch(c.args))
      expect(teamSearches.map((c) => teamSearch(c.args))).toEqual(['acme/backend'])
    })
  })
})
