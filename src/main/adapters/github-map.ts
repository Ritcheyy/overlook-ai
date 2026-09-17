/**
 * Pure mapping from `gh` JSON payloads to the domain `PullRequest`.
 * `gh search prs` and `gh pr view` disagree on casing and shape (lowercase vs
 * uppercase state, no head refs in search results), which is why the search
 * result only identifies a PR and the detail payload fills it in.
 */
import { z } from 'zod'
import type { PullRequest, PullRequestState } from '@core/domain'
import { prIdOf, repoRefFromFullName } from '@core/domain'

const actor = z.object({ login: z.string() }).passthrough()
const label = z.object({ name: z.string() }).passthrough()

export const ghSearchPrSchema = z
  .object({
    number: z.number().int(),
    title: z.string(),
    url: z.string(),
    createdAt: z.string(),
    updatedAt: z.string(),
    isDraft: z.boolean().default(false),
    state: z.string().optional(),
    author: actor.nullish(),
    repository: z.object({ name: z.string().optional(), nameWithOwner: z.string() }).passthrough(),
    labels: z.array(label).default([])
  })
  .passthrough()

export const ghPrDetailSchema = z
  .object({
    number: z.number().int(),
    title: z.string(),
    body: z.string().nullish(),
    url: z.string(),
    author: actor.nullish(),
    headRefName: z.string(),
    headRefOid: z.string(),
    baseRefName: z.string(),
    additions: z.number().optional(),
    deletions: z.number().optional(),
    changedFiles: z.number().optional(),
    state: z.string(),
    isDraft: z.boolean().default(false),
    mergedAt: z.string().nullish(),
    labels: z.array(label).default([]),
    createdAt: z.string(),
    updatedAt: z.string(),
    reviewRequests: z
      .array(z.object({ login: z.string().optional(), name: z.string().optional(), slug: z.string().optional() }).passthrough())
      .default([])
  })
  .passthrough()

export type GhSearchPr = z.infer<typeof ghSearchPrSchema>
export type GhPrDetail = z.infer<typeof ghPrDetailSchema>

export interface MapContext {
  /** Login of the authenticated user; drives `mine` and `reviewRequested`. */
  me?: string
  /** The PR came from the review-requested search, which is authoritative. */
  reviewRequested?: boolean
}

/** Deleted accounts come back without an author; GitHub shows them as "ghost". */
const GHOST = 'ghost'

export function parseSearchResults(json: string): GhSearchPr[] {
  const text = json.trim()
  if (!text) return []
  return z.array(ghSearchPrSchema).parse(parseJson(text, 'gh search prs'))
}

export function parsePrDetail(json: string): GhPrDetail {
  return ghPrDetailSchema.parse(parseJson(json.trim(), 'gh pr view'))
}

function parseJson(text: string, source: string): unknown {
  try {
    return JSON.parse(text)
  } catch (e) {
    throw new Error(`${source} returned invalid JSON: ${(e as Error).message}`)
  }
}

export function sameLogin(a: string | undefined, b: string | undefined): boolean {
  return !!a && !!b && a.toLowerCase() === b.toLowerCase()
}

export function mapPrState(state: string, mergedAt?: string | null): PullRequestState {
  if (mergedAt) return 'merged'
  switch (state.toUpperCase()) {
    case 'MERGED':
      return 'merged'
    case 'CLOSED':
      return 'closed'
    default:
      return 'open'
  }
}

export function searchItemId(item: GhSearchPr): string {
  return prIdOf(item.repository.nameWithOwner, item.number)
}

export function mapDetailToPullRequest(fullName: string, d: GhPrDetail, ctx: MapContext = {}): PullRequest {
  const author = d.author?.login || GHOST
  const requested = d.reviewRequests.some((r) => sameLogin(r.login, ctx.me))
  return {
    id: prIdOf(fullName, d.number),
    repo: repoRefFromFullName(fullName),
    number: d.number,
    title: d.title,
    body: d.body || undefined,
    author,
    url: d.url,
    headRef: d.headRefName,
    headSha: d.headRefOid,
    baseRef: d.baseRefName,
    isDraft: d.isDraft,
    state: mapPrState(d.state, d.mergedAt),
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
    additions: d.additions,
    deletions: d.deletions,
    changedFiles: d.changedFiles,
    labels: d.labels.map((l) => l.name),
    reviewRequested: !!ctx.reviewRequested || requested,
    mine: sameLogin(author, ctx.me)
  }
}
