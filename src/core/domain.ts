/**
 * Domain model shared by the Electron main process, the renderer, and the
 * in-browser demo engine. Everything here must stay free of Node/Electron
 * imports so it can run in a plain browser.
 */

export type HostKind = 'github'

export interface RepoRef {
  host: HostKind
  owner: string
  name: string
  /** `owner/name` */
  fullName: string
}

/** A repository the app found on disk, mapped to its remote. */
export interface LocalRepo {
  fullName: string
  path: string
  defaultBranch?: string
}

export type PullRequestState = 'open' | 'closed' | 'merged'

export interface PullRequest {
  /** `${repo.fullName}#${number}` */
  id: string
  repo: RepoRef
  number: number
  title: string
  body?: string
  author: string
  url: string
  headRef: string
  headSha: string
  baseRef: string
  isDraft: boolean
  state: PullRequestState
  createdAt: string
  updatedAt: string
  additions?: number
  deletions?: number
  changedFiles?: number
  labels: string[]
  /** My review was requested on this PR. */
  reviewRequested: boolean
  /** I authored this PR (self-review candidate). */
  mine: boolean
  /** GitHub's own review decision, from every reviewer on the PR; absent when GitHub reports none. */
  reviewDecision?: ReviewDecision
}

export type ReviewDecision = 'approved' | 'changes_requested' | 'review_required'

/** A conversation comment on a pull request. */
export interface PrComment {
  /** The URL GitHub gives the comment (`…#issuecomment-<id>`). */
  url: string
  author: string
  body: string
  createdAt: string
}

/**
 * Mission lifecycle (a "review" in the UI):
 *
 *   queued ──▶ preparing ──▶ reviewing ──▶ needs_you ──▶ posting ──▶ watching
 *                 │              │             ▲                        │
 *                 ▼              ▼             │ (rerun)  (reply + push)│
 *               failed ◀───── failed          └────────────────────────┘
 *
 *   any ──▶ closed   (PR merged/closed, or user closes the mission)
 *
 * A mission occupies a slot (a character at a desk) from `preparing` until it
 * reaches `watching`, `failed`, or `closed`. `watching` keeps the worktree but
 * frees the slot; the author's reply to the posted round plus a push re-queues
 * the mission (preferring its old slot) while the automatic round cap allows.
 */
export type MissionState =
  | 'queued'
  | 'preparing'
  | 'reviewing'
  | 'needs_you'
  | 'posting'
  | 'watching'
  | 'failed'
  | 'closed'

/** States in which a mission holds a slot. */
export const SLOT_HOLDING_STATES: readonly MissionState[] = ['preparing', 'reviewing', 'needs_you', 'posting']

export type FindingSeverity = 'blocker' | 'major' | 'minor' | 'nit' | 'praise'
export type FindingCategory =
  | 'correctness'
  | 'security'
  | 'performance'
  | 'maintainability'
  | 'testing'
  | 'product'
  | 'style'
  /** Breaks against another repository of the same workspace, usually one of the reviewer's own open PRs. */
  | 'integration'
  | 'other'

export type FindingDecision = 'pending' | 'approved' | 'dropped'
export type DropReason = 'product_decision' | 'false_positive' | 'already_known' | 'not_worth_it' | 'other'

export interface Finding {
  id: string
  severity: FindingSeverity
  category: FindingCategory
  title: string
  /** Markdown. The "why" and the evidence. */
  body: string
  file?: string
  line?: number
  /** Markdown, usually a fenced code block with the proposed change. */
  suggestion?: string
  /** `owner/name#number` of a PR in another repo this finding depends on. */
  relatedPr?: string
  decision: FindingDecision
  dropReason?: DropReason
  dropNote?: string
}

/** What the runner returns before the user has triaged anything. */
export type RawFinding = Omit<Finding, 'id' | 'decision' | 'dropReason' | 'dropNote'>

export type Verdict = 'approve' | 'request_changes' | 'comment'

/** What started a round: the first review, the user, a retry, or the author's reply to the last posted round. */
export type RoundTrigger = 'dispatch' | 'rerun' | 'retry' | 'reply'

/**
 * Choices made for one run in place of the settings defaults. Empty strings
 * mean "let the CLI decide", unlike an absent key, which keeps the setting.
 */
export interface RunOptions {
  model?: string
  effort?: '' | NonNullable<Settings['claudeEffort']>
  maxBudgetUsd?: number
  /** Post the findings without stopping for triage. */
  autoPost?: boolean
}

export interface ReviewRound {
  id: string
  /** 1-based; a new push after posting starts round n+1. */
  index: number
  headSha: string
  /** For rounds after the first: the sha the previous round reviewed. */
  previousHeadSha?: string
  startedAt: string
  finishedAt?: string
  findings: Finding[]
  summary: string
  /** Markdown explanation of the PR for the reviewer's own awareness; never posted. */
  briefing?: string
  /** The reviewer's summary before the user edited it in triage. */
  originalSummary?: string
  verdict: Verdict
  postedAt?: string
  postedCommentUrl?: string
  postedBody?: string
  error?: string
  rawOutput?: string
  costUsd?: number
  durationMs?: number
  /** The last lines of activity captured for the round, for post-mortems after a restart; kept small. */
  activity?: Activity[]
  /** Which workspace context the round used, for the log. */
  workspaceName?: string
  /** Model the round ran on: the settings alias until the runner reports the id the CLI resolved. */
  model?: string
  /** Effort level the round ran with; `default` when the CLI chose. */
  effort?: string
  /** The budget cap the round ran under. */
  budgetUsd?: number
  trigger?: RoundTrigger
  /** The author's replies to the previous round that this round was given; bodies are trimmed. */
  replies?: PrComment[]
}

export interface MissionEvent {
  at: string
  from?: MissionState
  to: MissionState
  note?: string
}

export interface Mission {
  id: string
  prId: string
  /** Snapshot of the PR as last seen by the poller. */
  pr: PullRequest
  loadoutId: string
  state: MissionState
  /** The character (slot) working this mission while it holds a slot. */
  slotId?: string
  /**
   * Slot that last worked this mission; preferred when it re-queues. Kept
   * through `watching`, `failed` and `closed`, so the floor can show a failure
   * on the character that produced it.
   */
  preferredSlotId?: string
  worktreePath?: string
  rounds: ReviewRound[]
  /** True when a push arrived while findings were waiting for triage. */
  stale: boolean
  autoPost: boolean
  /** Start follow-up rounds on their own when the author replies and pushes. Undefined means true. */
  autoFollowUp?: boolean
  /** The PR author's comments since the last posted round, excluding the app's own; refreshed every poll. */
  authorReplies?: PrComment[]
  /**
   * When the conversation was last read for replies, set from the moment a
   * round is posted. Absent on reviews watched before replies were tracked,
   * whose first read only records what is there, without notifying.
   */
  repliesCheckedAt?: string
  /** Options for the next run only; cleared once a run produces a review. */
  runOptions?: RunOptions
  /** What queued the next run; recorded on the round it starts. */
  nextTrigger?: RoundTrigger
  error?: string
  createdAt: string
  updatedAt: string
  timeline: MissionEvent[]
}

export type ActivityKind = 'preparing' | 'reading' | 'thinking' | 'searching' | 'writing' | 'running' | 'done' | 'error'

/** Fine-grained progress used to animate the character and fill the HUD log. */
export interface Activity {
  missionId: string
  at: string
  kind: ActivityKind
  text: string
}

/** A character on the floor. */
export interface Slot {
  id: string
  name: string
  /** Hex color used for the character and its HUD accent. */
  color: string
  missionId?: string
}

export interface Loadout {
  id: string
  name: string
  tagline: string
  /** Full instruction block appended to the review prompt. */
  prompt: string
  /**
   * When set, the user message sent to Claude is this text with {number}
   * replaced by the PR number, and the generated review prompt is passed as an
   * appended system prompt instead. Prose that invokes a skill by name works;
   * a bare slash command runs outside the conversation and returns nothing.
   */
  slashCommand?: string
  builtIn: boolean
}

/**
 * Several repositories that ship together and should be reviewed with each
 * other in view. Detected ones come from discovery: a folder under a projects
 * root that is not itself a git repo and holds at least two git repos. Manual
 * ones are put together by the user in Settings.
 */
export interface Workspace {
  id: string
  name: string
  /** The container folder; absent for manual workspaces. */
  rootPath?: string
  /** `owner/name` of every repo in the workspace. */
  repos: string[]
  enabled: boolean
  source: 'detected' | 'manual'
  /** Hand the container's Claude memory notes to reviews. */
  includeNotes: boolean
}

/** A container folder discovery found under a projects root. */
export interface DetectedWorkspace {
  rootPath: string
  name: string
  repos: string[]
  /** A CLAUDE.md at the root marks a folder the user already treats as one workspace. */
  hasClaudeMd: boolean
}

export interface Settings {
  /** Folders scanned (two levels deep) for git repos. `~` is expanded. */
  projectsRoots: string[]
  /** `owner/name` -> absolute path overrides for repos discovery gets wrong. */
  repoPaths: Record<string, string>
  pollIntervalSec: number
  slots: Slot[]
  loadouts: Loadout[]
  defaultLoadoutId: string
  /** Executable name or absolute path of the Claude Code CLI. */
  claudePath: string
  /** Alias (`opus`) or full model id passed to `--model`; empty leaves the CLI default. */
  claudeModel?: string
  claudeEffort?: 'low' | 'medium' | 'high' | 'max'
  /** Alias passed to `--fallback-model`, used when the main model is overloaded; unset for none. */
  claudeFallbackModel?: string
  maxBudgetUsdPerReview: number
  /** Where worktrees live: `<worktreeRoot>/<owner>/<name>/pr-<number>` */
  worktreeRoot: string
  /** Repos whose approved findings post without a triage stop. */
  autoPostRepos: string[]
  /**
   * How many follow-up rounds a mission may start on its own, each needing
   * the author's reply to the last posted round plus a push. Past this the
   * mission waits for a manual re-run, so an active author cannot burn budget
   * unattended.
   */
  maxAutoRoundsPerMission: number
  /** Shell command run inside a fresh worktree, keyed by `owner/name`. */
  prepareCommands: Record<string, string>
  /** Symlink node_modules from the main checkout into new worktrees. */
  linkNodeModules: boolean
  notifications: boolean
  /** Fake GitHub + fake runner. No tokens are ever spent in demo mode. */
  demoMode: boolean
  /**
   * Template for the trailing line of every posted comment. Placeholders:
   * {loadout}, {character}, {login}, {approval}, {round}, {sha}. Blank
   * once rendered means no signature.
   */
  signature: string
  /**
   * Closing request in comments that post findings, asking the author to
   * reply with a disposition per finding once fixes are pushed. Empty for none.
   */
  replyRequest: string
  /** Where a finding's file link opens: an editor at the line in the worktree, or GitHub. */
  fileLinks: FileLinkTarget
  /** Include PRs I authored in the inbox for self-review. */
  includeMine: boolean
  /** `owner/name` repos switched off in Settings: hidden from the inbox and never fetched in detail. */
  inactiveRepos: string[]
  /** PRs not updated within this many days are ignored. 0 disables the cut-off. */
  maxPrAgeDays: number
  /** Groups of repos reviewed with each other in view; detected entries are refreshed on every scan. */
  workspaces: Workspace[]
}

export type FileLinkTarget = 'vscode' | 'cursor' | 'github'

export interface AppSnapshot {
  inbox: PullRequest[]
  missions: Mission[]
  slots: Slot[]
  settings: Settings
  localRepos: LocalRepo[]
  lastPollAt?: string
  pollError?: string
  githubLogin?: string
  version: string
  /** Last real-mode preflight result; absent until checked. */
  environment?: EnvironmentCheck
}

export type EnvironmentCheckId = 'gh' | 'claude' | 'git' | 'worktreeRoot'

export interface EnvironmentCheckItem {
  id: EnvironmentCheckId
  label: string
  ok: boolean
  /** Version, resolved path, or the error text. */
  detail: string
}

export interface EnvironmentCheck {
  checkedAt: string
  ok: boolean
  items: EnvironmentCheckItem[]
}

/** Row labels shared by the real preflight and the demo so Settings reads the same in both. */
export const ENVIRONMENT_CHECK_LABELS: Record<EnvironmentCheckId, string> = {
  gh: 'GitHub CLI',
  claude: 'Claude Code',
  git: 'Git',
  worktreeRoot: 'Worktree root'
}

export type Notification = {
  title: string
  body: string
  missionId?: string
}

export const SEVERITY_ORDER: readonly FindingSeverity[] = ['blocker', 'major', 'minor', 'nit', 'praise']

export function prIdOf(fullName: string, number: number): string {
  return `${fullName}#${number}`
}

export function repoRefFromFullName(fullName: string, host: HostKind = 'github'): RepoRef {
  const [owner, name] = fullName.split('/')
  return { host, owner, name, fullName }
}

export function shortSha(sha: string): string {
  return sha.slice(0, 7)
}

export function missionHoldsSlot(state: MissionState): boolean {
  return SLOT_HOLDING_STATES.includes(state)
}

export function latestRound(mission: Mission): ReviewRound | undefined {
  return mission.rounds[mission.rounds.length - 1]
}

/** The newest round that reached the PR; follow-ups build on it and replies are counted from it. */
export function lastPostedRound(mission: Pick<Mission, 'rounds'>): ReviewRound | undefined {
  for (let i = mission.rounds.length - 1; i >= 0; i--) {
    if (mission.rounds[i].postedAt) return mission.rounds[i]
  }
  return undefined
}

/** Queue note of an automatic follow-up started by versions before rounds recorded their trigger. */
const LEGACY_AUTO_ROUND = /^new push [0-9a-f]{7}$/

/** Rounds the mission started on its own; the cap in settings counts only these. */
export function autoRoundsUsed(mission: Pick<Mission, 'rounds' | 'timeline'>): number {
  const recorded = mission.rounds.filter((r) => r.trigger === 'reply').length
  const legacy = mission.timeline.filter((e) => e.from === 'watching' && e.to === 'queued' && !!e.note && LEGACY_AUTO_ROUND.test(e.note)).length
  return recorded + legacy
}

/** The numeric id at the end of a comment URL, so URLs that differ only in host or path still match. */
export function commentIdOf(url: string): string {
  return /issuecomment-(\d+)/.exec(url)?.[1] ?? url
}
