/**
 * Pure mapping from mission state to what the floor shows: character pose,
 * screen and lamp behaviour, bubble, colours, and the small time-based curves
 * the scene samples every frame. No three.js here so it can be unit-tested.
 */
import type { ActivityKind, Mission, MissionState } from '@core/domain'

export const TOKENS = {
  amber: '#f5b544',
  accent: '#7c8aff',
  teal: '#4fd1c5',
  rose: '#f4728c',
  lime: '#a3e635',
  muted: '#969db0',
  faint: '#606a7a',
  ink: '#e8eaf0',
  bg: '#0b0d12'
} as const

export type VisualState = 'idle' | 'preparing' | 'reading' | 'thinking' | 'writing' | 'needs_you' | 'posting' | 'failed'

export const IDLE_SLEEP_MS = 60_000
export const DROP_SECONDS = 1.2
export const PLANE_SECONDS = 2.4
export const FLASH_SECONDS = 1.4

export function reviewingSubState(kind?: ActivityKind): 'reading' | 'thinking' | 'writing' {
  switch (kind) {
    case 'thinking':
      return 'thinking'
    case 'writing':
    case 'running':
      return 'writing'
    default:
      return 'reading'
  }
}

/** Which animation a slot plays for the mission it holds (or none). */
export function visualStateFor(state: MissionState | undefined, lastActivity?: ActivityKind): VisualState {
  switch (state) {
    case 'preparing':
      return 'preparing'
    case 'reviewing':
      return reviewingSubState(lastActivity)
    case 'needs_you':
      return 'needs_you'
    case 'posting':
      return 'posting'
    case 'failed':
      return 'failed'
    default:
      return 'idle'
  }
}

export function missionStateColor(state?: MissionState): string {
  switch (state) {
    case 'preparing':
    case 'reviewing':
    case 'posting':
      return TOKENS.accent
    case 'needs_you':
      return TOKENS.amber
    case 'failed':
      return TOKENS.rose
    case 'watching':
      return TOKENS.teal
    default:
      return TOKENS.muted
  }
}

export function visualColor(v: VisualState): string {
  switch (v) {
    case 'idle':
      return TOKENS.muted
    case 'needs_you':
      return TOKENS.amber
    case 'failed':
      return TOKENS.rose
    default:
      return TOKENS.accent
  }
}

export function chipFor(state?: MissionState): { label: string; color: string } {
  switch (state) {
    case 'queued':
      return { label: 'Queued', color: TOKENS.muted }
    case 'preparing':
      return { label: 'Preparing', color: TOKENS.accent }
    case 'reviewing':
      return { label: 'Reviewing', color: TOKENS.accent }
    case 'needs_you':
      return { label: 'Needs you', color: TOKENS.amber }
    case 'posting':
      return { label: 'Posting', color: TOKENS.accent }
    case 'watching':
      return { label: 'Watching', color: TOKENS.teal }
    case 'failed':
      return { label: 'Failed', color: TOKENS.rose }
    case 'closed':
      return { label: 'Closed', color: TOKENS.faint }
    default:
      return { label: 'Idle', color: TOKENS.faint }
  }
}

export interface ArmPose {
  /** Forward raise at the shoulder, radians. 0 hangs straight down. */
  pitch: number
  /** Outward swing, radians. Positive moves the hand away from the body. */
  yaw: number
  /** Elbow fold, radians. 0 is a straight arm. */
  bend: number
}

export interface Pose {
  /** Body yaw in desk space, radians. 0 faces the front of the desk. */
  bodyYaw: number
  /** Forward lean, radians. Negative leans back. */
  lean: number
  headYaw: number
  /** Positive looks down. */
  headPitch: number
  headRoll: number
  armL: ArmPose
  armR: ArmPose
  /** 0..1 typing bob amplitude on both arms. */
  typing: number
  /** 0..1 waving amplitude on the right forearm. */
  wave: number
  /** 0..1 breathing amplitude. */
  breathe: number
  lookAround: boolean
  mouth: 'smile' | 'neutral' | 'frown'
}

/** Yaw of the monitor as seen from the seat. */
export const MONITOR_YAW = 0.6
/** Yaw of the camera as seen from the seat (camera azimuth minus desk rotation). */
export const CAMERA_YAW = Math.PI / 4 - Math.PI / 6

const REST: ArmPose = { pitch: 1.05, yaw: 0.1, bend: 0.35 }
const TYPE: ArmPose = { pitch: 1.15, yaw: 0.15, bend: 0.55 }
const HANG: ArmPose = { pitch: 0.08, yaw: 0.05, bend: 0.05 }
const CHIN: ArmPose = { pitch: 0.75, yaw: -0.45, bend: 2.15 }
const WAVE: ArmPose = { pitch: 2.7, yaw: 0.55, bend: 0.5 }

const POSES: Record<VisualState, Pose> = {
  idle: {
    bodyYaw: 0.15,
    lean: 0,
    headYaw: 0,
    headPitch: 0.05,
    headRoll: 0,
    armL: REST,
    armR: REST,
    typing: 0,
    wave: 0,
    breathe: 1,
    lookAround: true,
    mouth: 'neutral'
  },
  preparing: {
    bodyYaw: MONITOR_YAW,
    lean: 0.22,
    headYaw: 0.05,
    headPitch: 0.25,
    headRoll: 0,
    armL: REST,
    armR: REST,
    typing: 0,
    wave: 0,
    breathe: 0.6,
    lookAround: false,
    mouth: 'neutral'
  },
  reading: {
    bodyYaw: MONITOR_YAW,
    lean: 0.08,
    headYaw: 0.05,
    headPitch: 0.32,
    headRoll: 0.14,
    armL: REST,
    armR: REST,
    typing: 0,
    wave: 0,
    breathe: 0.6,
    lookAround: false,
    mouth: 'neutral'
  },
  thinking: {
    bodyYaw: MONITOR_YAW - 0.15,
    lean: -0.06,
    headYaw: -0.12,
    headPitch: -0.08,
    headRoll: -0.08,
    armL: REST,
    armR: CHIN,
    typing: 0,
    wave: 0,
    breathe: 0.6,
    lookAround: false,
    mouth: 'neutral'
  },
  writing: {
    bodyYaw: MONITOR_YAW,
    lean: 0.16,
    headYaw: 0.03,
    headPitch: 0.22,
    headRoll: 0,
    armL: TYPE,
    armR: TYPE,
    typing: 1,
    wave: 0,
    breathe: 0.4,
    lookAround: false,
    mouth: 'smile'
  },
  needs_you: {
    bodyYaw: CAMERA_YAW,
    lean: -0.04,
    headYaw: 0,
    headPitch: -0.22,
    headRoll: 0,
    armL: REST,
    armR: WAVE,
    typing: 0,
    wave: 1,
    breathe: 0.6,
    lookAround: false,
    mouth: 'smile'
  },
  posting: {
    bodyYaw: CAMERA_YAW + 0.1,
    lean: -0.12,
    headYaw: 0.05,
    headPitch: -0.45,
    headRoll: 0,
    armL: REST,
    armR: { pitch: 1.9, yaw: 0.3, bend: 0.2 },
    typing: 0,
    wave: 0,
    breathe: 0.6,
    lookAround: false,
    mouth: 'smile'
  },
  failed: {
    bodyYaw: 0.2,
    lean: 0.3,
    headYaw: 0,
    headPitch: 0.65,
    headRoll: 0.05,
    armL: HANG,
    armR: HANG,
    typing: 0,
    wave: 0,
    breathe: 0.3,
    lookAround: false,
    mouth: 'frown'
  }
}

export function poseFor(v: VisualState): Pose {
  return POSES[v]
}

export type ScreenMode = 'off' | 'loading' | 'code' | 'alert' | 'sending' | 'flash'

export interface ScreenSpec {
  mode: ScreenMode
  /** Lines per second for the code scroll. */
  scrollSpeed: number
  color: string
}

export function screenFor(v: VisualState): ScreenSpec {
  switch (v) {
    case 'idle':
      return { mode: 'off', scrollSpeed: 0, color: TOKENS.faint }
    case 'preparing':
      return { mode: 'loading', scrollSpeed: 0, color: TOKENS.accent }
    case 'reading':
      return { mode: 'code', scrollSpeed: 1.4, color: TOKENS.accent }
    case 'thinking':
      return { mode: 'code', scrollSpeed: 0.3, color: TOKENS.accent }
    case 'writing':
      return { mode: 'code', scrollSpeed: 3.2, color: TOKENS.teal }
    case 'needs_you':
      return { mode: 'alert', scrollSpeed: 0, color: TOKENS.amber }
    case 'posting':
      return { mode: 'sending', scrollSpeed: 0, color: TOKENS.accent }
    case 'failed':
      return { mode: 'flash', scrollSpeed: 0, color: TOKENS.rose }
  }
}

export interface LampSpec {
  intensity: number
  color: string
  pulse: boolean
}

export function lampFor(v: VisualState): LampSpec {
  switch (v) {
    case 'idle':
      return { intensity: 1.0, color: '#ffd9a0', pulse: false }
    case 'needs_you':
      return { intensity: 4.5, color: TOKENS.amber, pulse: true }
    case 'failed':
      return { intensity: 1.8, color: TOKENS.rose, pulse: false }
    default:
      return { intensity: 5, color: '#ffd9a0', pulse: false }
  }
}

export interface PinSpec {
  color: string
  intensity: number
  pulse: boolean
}

/** Colour and glow of a corkboard pin; a push nobody has reviewed yet turns it amber and makes it throb. */
export function pinFor(newPush: boolean): PinSpec {
  return newPush ? { color: TOKENS.amber, intensity: 1.2, pulse: true } : { color: TOKENS.teal, intensity: 0.4, pulse: false }
}

/** 0..1 slow throb shared by the amber pin and its halo. */
export function pulseLevel(t: number, hz = 0.9): number {
  return 0.5 + 0.5 * Math.sin(t * Math.PI * 2 * hz)
}

export type Bubble = 'none' | 'dots' | 'alert' | 'error' | 'sleep'

export function bubbleFor(v: VisualState, idleForMs = 0): Bubble {
  switch (v) {
    case 'thinking':
      return 'dots'
    case 'needs_you':
      return 'alert'
    case 'failed':
      return 'error'
    case 'idle':
      return idleForMs >= IDLE_SLEEP_MS ? 'sleep' : 'none'
    default:
      return 'none'
  }
}

export const showsCube = (v: VisualState): boolean =>
  v === 'preparing' || v === 'reading' || v === 'thinking' || v === 'writing' || v === 'needs_you'

export const showsPaper = (v: VisualState): boolean => v === 'reading'

export const facesCamera = (v: VisualState): boolean => v === 'needs_you' || v === 'posting'

export const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x)

/**
 * Height factor of the falling PR cube: 1 at release, 0 once it has settled,
 * with two decaying bounces in between. `p` is progress 0..1.
 */
export function dropBounce(p: number): number {
  if (p <= 0) return 1
  if (p >= 1) return 0
  if (p < 0.55) {
    const q = p / 0.55
    return 1 - q * q
  }
  if (p < 0.8) return 0.28 * Math.sin((Math.PI * (p - 0.55)) / 0.25)
  return 0.08 * Math.sin((Math.PI * (p - 0.8)) / 0.2)
}

function easeInOut(x: number): number {
  const q = clamp01(x)
  return q < 0.5 ? 2 * q * q : 1 - Math.pow(-2 * q + 2, 2) / 2
}

/** Half-turn flips, one per `period`, each taking the first third of it. */
export function paperFlipAngle(t: number, period = 2): number {
  if (period <= 0) return 0
  const n = Math.floor(t / period)
  const phase = (t - n * period) / period
  return n * Math.PI + easeInOut(phase * 3) * Math.PI
}

/** Alternating vertical offsets for the left and right hand; written into `out` to avoid allocations. */
export function typingBob(t: number, hz = 6, amplitude = 0.06, out: [number, number] = [0, 0]): [number, number] {
  const s = Math.sin(t * Math.PI * 2 * hz) * amplitude
  out[0] = s
  out[1] = -s
  return out
}

export function waveAngle(t: number, amplitude = 0.45): number {
  return Math.sin(t * 9) * amplitude
}

export function loadingProgress(sinceSec: number): number {
  return sinceSec <= 0 ? 0 : 1 - Math.exp(-sinceSec / 2.2)
}

/** Rose flash right after a failure: strobes a few times, then dark. */
export function flashIntensity(sinceSec: number): number {
  if (sinceSec < 0 || sinceSec >= FLASH_SECONDS) return 0
  const strobe = 0.5 + 0.5 * Math.cos(sinceSec * 22)
  return strobe * (1 - sinceSec / FLASH_SECONDS)
}

export interface PlanePoint {
  x: number
  y: number
  z: number
  roll: number
  pitch: number
}

/** Arc of the paper plane in desk space; written into `out` to avoid allocations. */
export function paperPlaneArc(p: number, out: PlanePoint): PlanePoint {
  const q = clamp01(p)
  out.x = 0.2 + q * 3.2
  out.y = 0.9 + q * 8.5 - 1.2 * Math.sin(q * Math.PI)
  out.z = 0.4 + q * 2.6
  out.roll = -0.35 + 0.5 * Math.sin(q * Math.PI * 2)
  out.pitch = 0.55 - q * 0.9
  return out
}

export interface SlotGlimpse {
  missionId?: string
  visual: VisualState
}

/**
 * Id of the mission whose comment should fly off as a paper plane, given two
 * consecutive views of a slot. Posting usually completes between two
 * snapshots, so a mission that leaves the slot straight into `watching` is
 * launched on its way out; one seen entering `posting` launches immediately
 * and is not launched twice.
 */
export function planeLaunch(prev: SlotGlimpse, next: SlotGlimpse, leftMissionState?: MissionState): string | undefined {
  if (next.visual === 'posting' && next.missionId) {
    return prev.visual === 'posting' && prev.missionId === next.missionId ? undefined : next.missionId
  }
  if (prev.missionId && prev.missionId !== next.missionId && prev.visual !== 'posting' && leftMissionState === 'watching') {
    return prev.missionId
  }
  return undefined
}

/** Milliseconds the mission has been in its current state. */
export function elapsedInState(mission: Pick<Mission, 'state' | 'timeline' | 'updatedAt'>, nowMs: number): number {
  let at: string | undefined
  for (let i = mission.timeline.length - 1; i >= 0; i--) {
    const e = mission.timeline[i]
    // A note recorded without a state change repeats `to`; only the opening event enters a state without `from`.
    if (e.to === mission.state && (e.from !== undefined || i === 0)) {
      at = e.at
      break
    }
  }
  const t = Date.parse(at ?? mission.updatedAt)
  if (Number.isNaN(t)) return 0
  return Math.max(0, nowMs - t)
}

export function formatElapsed(ms: number): string {
  const s = Math.floor(Math.max(0, ms) / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${s % 60}s`
  const h = Math.floor(m / 60)
  return `${h}h ${m % 60}m`
}

export function truncate(text: string, max: number): string {
  if (text.length <= max) return text
  return `${text.slice(0, Math.max(0, max - 1)).trimEnd()}…`
}
