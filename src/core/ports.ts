/**
 * Ports the scheduler talks to. Real implementations live in src/main/adapters
 * (Node + Electron). Browser-safe fakes live in src/core/mocks and back demo
 * mode, the in-browser dev server, and the unit tests.
 */
import type {
  Activity,
  DetectedWorkspace,
  LocalRepo,
  Loadout,
  Mission,
  PrComment,
  PullRequest,
  RawFinding,
  ReviewRound,
  Settings,
  Verdict
} from './domain'

export interface GitHubPort {
  /** Login of the authenticated user. */
  me(): Promise<string>
  /** Open PRs where my review is requested. */
  listReviewRequested(): Promise<PullRequest[]>
  /** Open PRs I authored. */
  listMine(): Promise<PullRequest[]>
  /** Fresh detail for one PR (state, headSha, counts), with its conversation comments when asked. */
  getPullRequest(fullName: string, number: number, opts?: { comments?: boolean }): Promise<PullRequestDetail>
  /** Unified diff of the PR against its base. */
  getDiff(fullName: string, number: number): Promise<string>
  postComment(fullName: string, number: number, body: string): Promise<{ url: string }>
}

export interface PullRequestDetail extends PullRequest {
  /** Present only when requested; never stored on the inbox or a mission snapshot. */
  comments?: PrComment[]
}

export interface PrepareWorktreeOptions {
  localRepoPath: string
  /** Absolute target path for the worktree. Must be idempotent if it exists. */
  worktreePath: string
  pr: PullRequest
  /** Runs inside the worktree after checkout, once per fresh worktree. */
  prepareCommand?: string
  linkNodeModules: boolean
  signal?: AbortSignal
  onActivity?: (text: string) => void
}

export interface WorktreePort {
  /** Create or update a worktree checked out at the PR head. */
  prepare(opts: PrepareWorktreeOptions): Promise<{ worktreePath: string; headSha: string }>
  remove(localRepoPath: string, worktreePath: string): Promise<void>
  exists(worktreePath: string): Promise<boolean>
}

export interface ReposPort {
  /** Scan roots (expanding `~`) for git repos and map them to `owner/name`. */
  discover(roots: string[]): Promise<LocalRepo[]>
  /** Folders directly under the roots that are not repos themselves but hold at least two. */
  discoverWorkspaces(roots: string[]): Promise<DetectedWorkspace[]>
  /**
   * Rendered markdown of the container's Claude memory: MEMORY.md, then each
   * note it links, capped in size. Undefined when the folder has no store.
   */
  readWorkspaceNotes(rootPath: string): Promise<string | undefined>
}

/** What a review gets to see beyond its own worktree. */
export interface WorkspaceContext {
  name: string
  rootPath?: string
  siblings: { fullName: string; path?: string; defaultBranch?: string }[]
  /** The reviewer's own unmerged PRs in sibling repos, whose changes this PR must still work with. */
  myOpenPrs: { fullName: string; number: number; title: string; headRef: string; baseRef: string; url: string }[]
  notes?: string
}

export interface ReviewRequest {
  mission: Mission
  round: ReviewRound
  loadout: Loadout
  worktreePath: string
  /** Full unified diff for round 1; delta since the previous round afterwards. */
  diff: string
  /** Previous round, so follow-up reviews can say what was fixed. */
  previousRound?: ReviewRound
  /** The author's replies to the previous round, oldest first. */
  replies?: PrComment[]
  /** Sibling repos, the reviewer's open PRs in them, and the container's notes; absent for single-repo reviews. */
  workspace?: WorkspaceContext
  settings: Settings
  signal?: AbortSignal
  onActivity?: (activity: Omit<Activity, 'missionId' | 'at'>) => void
  /** The model id the runner resolved, as soon as it is known rather than when the review ends. */
  onModel?: (model: string) => void
}

export interface ReviewResult {
  findings: RawFinding[]
  summary: string
  verdict: Verdict
  briefing?: string
  rawOutput?: string
  costUsd?: number
  durationMs?: number
  /** Model id the runner resolved, e.g. from the CLI's init event. */
  model?: string
}

export interface RunnerPort {
  review(req: ReviewRequest): Promise<ReviewResult>
}

export interface PersistedState {
  missions: Mission[]
  settings: Settings
  inbox: PullRequest[]
  lastPollAt?: string
}

export interface StorePort {
  load(): Promise<PersistedState | null>
  save(state: PersistedState): Promise<void>
}

export interface NotifierPort {
  notify(n: { title: string; body: string; missionId?: string }): void
  setBadge(count: number): void
}

export interface Clock {
  now(): Date
}

export const systemClock: Clock = { now: () => new Date() }

export interface Ports {
  github: GitHubPort
  worktree: WorktreePort
  repos: ReposPort
  runner: RunnerPort
  store: StorePort
  notifier: NotifierPort
  clock: Clock
}
