/**
 * Pure mapping from `gh` JSON payloads to the domain `PullRequest`.
 * `gh search prs` and the PR detail disagree on casing and shape (lowercase
 * vs uppercase state, no head refs in search results), which is why the search
 * result only identifies a PR and the detail payload fills it in. Details come
 * from a batched GraphQL query flattened to the `gh pr view --json` shape.
 */
import { z } from 'zod'
import type { PrComment, PullRequest, PullRequestState, ReviewDecision } from '@core/domain'
import { prIdOf, repoRefFromFullName } from '@core/domain'
import type { PullRequestDetail } from '@core/ports'

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
      .default([]),
    reviewDecision: z.string().nullish(),
    comments: z
      .array(
        z
          .object({
            author: actor.nullish(),
            body: z.string().nullish(),
            createdAt: z.string(),
            url: z.string()
          })
          .passthrough()
      )
      .optional()
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

const graphqlBodySchema = z
  .object({
    data: z.record(z.string(), z.object({ pullRequest: z.record(z.string(), z.unknown()).nullish() }).passthrough().nullish()).nullish(),
    errors: z.array(z.object({ message: z.string().optional() }).passthrough()).optional(),
    message: z.string().optional()
  })
  .passthrough()

function nodesOf(connection: unknown): unknown[] {
  const nodes = (connection as { nodes?: unknown } | null | undefined)?.nodes
  return Array.isArray(nodes) ? nodes : []
}

/** A GraphQL PullRequest node in the shape `gh pr view --json` prints, so one schema serves both. */
function flattenGraphqlPr(node: Record<string, unknown>): Record<string, unknown> {
  const flat: Record<string, unknown> = {
    ...node,
    labels: nodesOf(node['labels']),
    reviewRequests: nodesOf(node['reviewRequests']).map((r) => (r as { requestedReviewer?: unknown } | null)?.requestedReviewer ?? {})
  }
  if ('comments' in node) flat['comments'] = nodesOf(node['comments'])
  return flat
}

/** The PRs that resolved in a batched query, by id; an alias GitHub could not resolve is skipped. */
export function parseGraphqlDetails(json: string, aliases: readonly { alias: string; fullName: string }[]): Map<string, GhPrDetail> {
  const body = graphqlBodySchema.parse(parseJson(json.trim(), 'gh api graphql'))
  if (!body.data) {
    const why = body.errors?.map((e) => e.message).filter(Boolean).join('; ') || body.message
    throw new Error(`gh api graphql returned no data${why ? `: ${why}` : ''}`)
  }
  const out = new Map<string, GhPrDetail>()
  for (const { alias, fullName } of aliases) {
    const node = body.data[alias]?.pullRequest
    if (!node) continue
    const detail = ghPrDetailSchema.parse(flattenGraphqlPr(node))
    out.set(prIdOf(fullName, detail.number), detail)
  }
  return out
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

export function mapReviewDecision(value: string | null | undefined): ReviewDecision | undefined {
  switch ((value ?? '').toUpperCase()) {
    case 'APPROVED':
      return 'approved'
    case 'CHANGES_REQUESTED':
      return 'changes_requested'
    case 'REVIEW_REQUIRED':
      return 'review_required'
    default:
      return undefined
  }
}

export function mapComments(d: GhPrDetail): PrComment[] | undefined {
  return d.comments?.map((c) => ({ url: c.url, author: c.author?.login || GHOST, body: c.body ?? '', createdAt: c.createdAt }))
}

export function searchItemId(item: GhSearchPr): string {
  return prIdOf(item.repository.nameWithOwner, item.number)
}

export function mapDetailToPullRequest(fullName: string, d: GhPrDetail, ctx: MapContext = {}): PullRequest {
  const author = d.author?.login || GHOST
  const requested = d.reviewRequests.some((r) => sameLogin(r.login, ctx.me))
  const decision = mapReviewDecision(d.reviewDecision)
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
    mine: sameLogin(author, ctx.me),
    ...(decision && { reviewDecision: decision })
  }
}

/** The PR plus its conversation, when the payload carried one. */
export function mapDetail(fullName: string, d: GhPrDetail, ctx: MapContext = {}): PullRequestDetail {
  const pr: PullRequestDetail = mapDetailToPullRequest(fullName, d, ctx)
  const comments = mapComments(d)
  if (comments) pr.comments = comments
  return pr
}
