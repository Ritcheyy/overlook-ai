/**
 * Per-run choices (model, effort, budget, auto-post) layered over the
 * settings for a single review, so a re-run can try another model without
 * touching the defaults.
 */
import type { PrComment, RunOptions, Settings } from '../domain'

const EFFORTS = new Set(['', 'low', 'medium', 'high', 'max'])
const MAX_MODEL_LENGTH = 120
/** Replies handed to one review; older ones are dropped first. */
export const MAX_REPLIES = 5
/** Characters kept from each reply body. */
export const MAX_REPLY_CHARS = 8000

/** Drops anything malformed; an empty result means "use the settings". */
export function sanitizeRunOptions(raw: RunOptions | undefined): RunOptions | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const out: RunOptions = {}
  if (typeof raw.model === 'string') out.model = raw.model.trim().slice(0, MAX_MODEL_LENGTH)
  if (typeof raw.effort === 'string' && EFFORTS.has(raw.effort)) out.effort = raw.effort
  if (typeof raw.maxBudgetUsd === 'number' && Number.isFinite(raw.maxBudgetUsd) && raw.maxBudgetUsd >= 0) out.maxBudgetUsd = raw.maxBudgetUsd
  if (typeof raw.autoPost === 'boolean') out.autoPost = raw.autoPost
  return Object.keys(out).length > 0 ? out : undefined
}

/** The settings one run sees. Empty strings clear the setting, which the CLI reads as its own default. */
export function applyRunOptions(settings: Settings, options: RunOptions | undefined): Settings {
  if (!options) return settings
  const next: Settings = { ...settings }
  if (options.model !== undefined) {
    next.claudeModel = options.model
    // The CLI refuses a fallback that is the model itself, which a one-off switch to the fallback would produce.
    if (options.model && options.model === next.claudeFallbackModel) next.claudeFallbackModel = undefined
  }
  if (options.effort !== undefined) next.claudeEffort = options.effort || undefined
  if (options.maxBudgetUsd !== undefined) next.maxBudgetUsdPerReview = options.maxBudgetUsd
  return next
}

/** Newest replies last, capped in count and size so a long thread cannot swamp the prompt or the saved state. */
export function trimReplies(replies: readonly PrComment[]): PrComment[] {
  return [...replies]
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .slice(-MAX_REPLIES)
    .map((r) => (r.body.length > MAX_REPLY_CHARS ? { ...r, body: `${r.body.slice(0, MAX_REPLY_CHARS)}\n\n[reply truncated]` } : { ...r }))
}
