/**
 * The API surface between the UI and the engine. In Electron the renderer
 * reaches it over IPC (preload bridge); in the browser demo it is called
 * directly. Both sides share this file, so keep it free of Node imports.
 */
import type {
  Activity,
  AppSnapshot,
  DropReason,
  EnvironmentCheck,
  FindingDecision,
  LocalRepo,
  Mission,
  Notification,
  Settings
} from './domain'

export interface DispatchArgs {
  prId: string
  loadoutId?: string
  /** Overrides the per-repo autoPost setting for this mission. */
  autoPost?: boolean
}

export interface FindingDecisionArgs {
  missionId: string
  roundId: string
  findingId: string
  decision: FindingDecision
  dropReason?: DropReason
  dropNote?: string
}

export interface BulkFindingDecisionArgs {
  missionId: string
  roundId: string
  decision: FindingDecision
  /** Restrict to these finding ids; all findings in the round when omitted. */
  findingIds?: string[]
  /** For `dropped`: applied to every affected finding. Findings keep their own reason when omitted. */
  dropReason?: DropReason
  dropNote?: string
}

export interface SetRoundSummaryArgs {
  missionId: string
  roundId: string
  summary: string
}

export interface SetAutoFollowUpArgs {
  missionId: string
  enabled: boolean
}

export type ScreenName = 'floor' | 'inbox' | 'triage' | 'log' | 'settings'

export interface NavigateArgs {
  screen: ScreenName
  missionId?: string
}

export type DemoEventKind = 'push' | 'close' | 'merge' | 'new_pr' | 'fail_next_review'

export interface DemoSimulateArgs {
  kind: DemoEventKind
  /** Required for push/close/merge. */
  prId?: string
}

export interface Api {
  getSnapshot(): Promise<AppSnapshot>
  /** Poll GitHub now instead of waiting for the interval. */
  refreshInbox(): Promise<AppSnapshot>
  dispatch(args: DispatchArgs): Promise<Mission>
  /** Abort a running mission; it ends in `failed` and can be retried. */
  cancelMission(missionId: string): Promise<void>
  /** `failed` -> `queued`. */
  retryMission(missionId: string): Promise<void>
  /** Start a fresh round on the current head (from `needs_you`, `watching` or `failed`), optionally with another loadout. */
  rerunMission(missionId: string, loadoutId?: string): Promise<void>
  /** Remove the worktree and end the mission. */
  closeMission(missionId: string): Promise<void>
  setFindingDecision(args: FindingDecisionArgs): Promise<void>
  setFindingDecisions(args: BulkFindingDecisionArgs): Promise<void>
  /** Markdown of the comment that `postComment` would send. */
  /** Edit the summary that heads the posted comment; allowed while the round is un-posted. */
  setRoundSummary(args: SetRoundSummaryArgs): Promise<void>
  setAutoFollowUp(args: SetAutoFollowUpArgs): Promise<void>
  previewComment(missionId: string): Promise<string>
  postComment(missionId: string): Promise<{ url: string }>
  getActivity(missionId: string): Promise<Activity[]>
  updateSettings(patch: Partial<Settings>): Promise<Settings>
  discoverRepos(): Promise<LocalRepo[]>
  openExternal(url: string): Promise<void>
  openPath(path: string): Promise<void>
  /** Only honoured in demo mode; a no-op otherwise. */
  demoSimulate(args: DemoSimulateArgs): Promise<void>
  /** Real-mode preflight: gh login, claude binary, git, writable worktree root. Cached on the snapshot. */
  checkEnvironment(): Promise<EnvironmentCheck>
  /** Restart the app (needed after toggling demo mode). No-op in the browser. */
  relaunch(): Promise<void>
}

export type ApiMethod = keyof Api
export type ApiArgs<M extends ApiMethod> = Parameters<Api[M]>
export type ApiResult<M extends ApiMethod> = Awaited<ReturnType<Api[M]>>

export interface PushEvents {
  snapshot: AppSnapshot
  activity: Activity
  notification: Notification
  /** Main asks the UI to move (e.g. an OS notification was clicked). */
  navigate: NavigateArgs
}
export type PushEvent = keyof PushEvents

export const API_METHODS: readonly ApiMethod[] = [
  'getSnapshot',
  'refreshInbox',
  'dispatch',
  'cancelMission',
  'retryMission',
  'rerunMission',
  'closeMission',
  'setFindingDecision',
  'setFindingDecisions',
  'setRoundSummary',
  'setAutoFollowUp',
  'previewComment',
  'postComment',
  'getActivity',
  'updateSettings',
  'discoverRepos',
  'openExternal',
  'openPath',
  'demoSimulate',
  'checkEnvironment',
  'relaunch'
]

export const PUSH_EVENTS: readonly PushEvent[] = ['snapshot', 'activity', 'notification', 'navigate']

export function apiChannel(method: ApiMethod): string {
  return `api:${method}`
}

export function pushChannel(event: PushEvent): string {
  return `push:${event}`
}

/** What the preload script exposes on `window.bridge`. */
export interface Bridge {
  invoke<M extends ApiMethod>(method: M, ...args: ApiArgs<M>): Promise<ApiResult<M>>
  on<E extends PushEvent>(event: E, cb: (payload: PushEvents[E]) => void): () => void
}

export interface Engine {
  api: Api
  subscribe<E extends PushEvent>(event: E, cb: (payload: PushEvents[E]) => void): () => void
  /** Begin polling and scheduling. */
  start(): Promise<void>
  stop(): Promise<void>
}
