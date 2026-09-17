/**
 * Renderer state. One zustand store holding the engine snapshot plus UI
 * state (current screen, selection, toasts, per-mission activity).
 * Screens call `api` directly for mutations; the engine pushes a new
 * snapshot after every change, so no optimistic updates are needed.
 */
import { create } from 'zustand'
import type { Activity, AppSnapshot, Mission, MissionState, Notification, PullRequest, Slot } from '@core/domain'
import { missionHoldsSlot } from '@core/domain'
import { api, onPush } from '@/lib/api'

export type Screen = 'floor' | 'inbox' | 'triage' | 'log' | 'settings'

export interface Toast {
  id: string
  kind: 'info' | 'success' | 'error'
  title: string
  body?: string
  missionId?: string
  createdAt: number
}

const MAX_ACTIVITY = 120

export interface AppState {
  snapshot: AppSnapshot | null
  loading: boolean
  error?: string
  screen: Screen
  selectedMissionId?: string
  /** Newest last, capped per mission. */
  activity: Record<string, Activity[]>
  toasts: Toast[]
  navigate: (screen: Screen, opts?: { missionId?: string }) => void
  selectMission: (missionId?: string) => void
  pushToast: (toast: Omit<Toast, 'id' | 'createdAt'>) => void
  dismissToast: (id: string) => void
  /** Load the first snapshot and subscribe to pushes. Safe to call once. */
  init: () => Promise<void>
  /** Re-fetch the snapshot (used after actions whose push may race). */
  refresh: () => Promise<void>
}

let initialised = false
let toastSeq = 0

export const useAppStore = create<AppState>((set, get) => ({
  snapshot: null,
  loading: true,
  screen: 'floor',
  activity: {},
  toasts: [],

  navigate: (screen, opts) => set({ screen, selectedMissionId: opts?.missionId ?? get().selectedMissionId }),

  selectMission: (missionId) => set({ selectedMissionId: missionId }),

  pushToast: (toast) => {
    const id = `toast-${++toastSeq}`
    set((s) => ({ toasts: [...s.toasts, { ...toast, id, createdAt: Date.now() }] }))
    setTimeout(() => get().dismissToast(id), toast.kind === 'error' ? 9000 : 5000)
  },

  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

  refresh: async () => {
    try {
      const snapshot = await api.getSnapshot()
      set({ snapshot, loading: false, error: undefined })
    } catch (e) {
      set({ error: (e as Error).message, loading: false })
    }
  },

  init: async () => {
    if (initialised) return
    initialised = true
    onPush('snapshot', (snapshot) => set({ snapshot, loading: false, error: undefined }))
    onPush('activity', (a) =>
      set((s) => {
        const list = [...(s.activity[a.missionId] ?? []), a]
        if (list.length > MAX_ACTIVITY) list.splice(0, list.length - MAX_ACTIVITY)
        return { activity: { ...s.activity, [a.missionId]: list } }
      })
    )
    onPush('navigate', (n) => {
      set({ screen: n.screen, selectedMissionId: n.missionId ?? get().selectedMissionId })
    })
    onPush('notification', (n: Notification) => {
      get().pushToast({ kind: 'info', title: n.title, body: n.body, missionId: n.missionId })
    })
    await get().refresh()
  }
}))

// ---- selectors -----------------------------------------------------------
// Selectors feed useSyncExternalStore, so they must return the same reference
// for the same state: a fresh `[]` per call would re-render forever.

const EMPTY_SLOTS: Slot[] = []
const EMPTY_MISSIONS: Mission[] = []
const EMPTY_INBOX: PullRequest[] = []
const EMPTY_ACTIVITY: Activity[] = []

const derivedMissions = new WeakMap<Mission[], Map<string, Mission[]>>()

/** Caches a list derived from `missions` until the engine pushes a new snapshot. */
function deriveMissions(missions: Mission[], key: string, compute: () => Mission[]): Mission[] {
  let byKey = derivedMissions.get(missions)
  if (!byKey) {
    byKey = new Map()
    derivedMissions.set(missions, byKey)
  }
  let list = byKey.get(key)
  if (!list) {
    list = compute()
    byKey.set(key, list)
  }
  return list
}

/** When a mission last entered `queued`; the scheduler orders the shelf by this, not by createdAt. */
function queuedAt(m: Mission): string {
  for (let i = m.timeline.length - 1; i >= 0; i--) {
    if (m.timeline[i].to === 'queued') return m.timeline[i].at
  }
  return m.createdAt
}

export const selectSnapshot = (s: AppState) => s.snapshot
export const selectSettings = (s: AppState) => s.snapshot?.settings
export const selectSlots = (s: AppState): Slot[] => s.snapshot?.slots ?? EMPTY_SLOTS
export const selectMissions = (s: AppState): Mission[] => s.snapshot?.missions ?? EMPTY_MISSIONS
export const selectInbox = (s: AppState): PullRequest[] => s.snapshot?.inbox ?? EMPTY_INBOX

export const selectMissionById = (id?: string) => (s: AppState) =>
  id ? s.snapshot?.missions.find((m) => m.id === id) : undefined

export const selectMissionForSlot = (slotId: string) => (s: AppState) =>
  s.snapshot?.missions.find((m) => m.slotId === slotId && missionHoldsSlot(m.state))

export const selectMissionForPr = (prId: string) => (s: AppState) =>
  s.snapshot?.missions.find((m) => m.prId === prId && m.state !== 'closed')

export const selectMissionsInState = (...states: MissionState[]) => (s: AppState): Mission[] => {
  const missions = s.snapshot?.missions
  if (!missions) return EMPTY_MISSIONS
  return deriveMissions(missions, `state:${states.join(',')}`, () => missions.filter((m) => states.includes(m.state)))
}

export const selectNeedsYouCount = (s: AppState) =>
  (s.snapshot?.missions ?? []).filter((m) => m.state === 'needs_you').length

export const selectActivityFor = (missionId?: string) => (s: AppState): Activity[] =>
  (missionId && s.activity[missionId]) || EMPTY_ACTIVITY

export const selectLastActivityFor = (missionId?: string) => (s: AppState): Activity | undefined => {
  if (!missionId) return undefined
  const list = s.activity[missionId]
  return list?.[list.length - 1]
}

/** Queued missions in the order the scheduler will pick them: follow-up rounds first, then FIFO by queue time. */
export const selectQueue = (s: AppState): Mission[] => {
  const missions = s.snapshot?.missions
  if (!missions) return EMPTY_MISSIONS
  return deriveMissions(missions, 'queue', () =>
    missions
      .filter((m) => m.state === 'queued')
      .sort((a, b) => {
        const followUp = Number(a.rounds.length === 0) - Number(b.rounds.length === 0)
        return followUp !== 0 ? followUp : queuedAt(a).localeCompare(queuedAt(b))
      })
  )
}
