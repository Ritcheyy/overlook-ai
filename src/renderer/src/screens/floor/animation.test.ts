import { describe, expect, it } from 'vitest'
import type { Mission } from '@core/domain'
import {
  CAMERA_YAW,
  DROP_SECONDS,
  FLASH_SECONDS,
  IDLE_SLEEP_MS,
  MONITOR_YAW,
  TOKENS,
  bubbleFor,
  chipFor,
  dropBounce,
  elapsedInState,
  facesCamera,
  flashIntensity,
  formatElapsed,
  lampFor,
  loadingProgress,
  missionStateColor,
  paperFlipAngle,
  paperPlaneArc,
  pinFor,
  planeLaunch,
  poseFor,
  pulseLevel,
  reviewingSubState,
  screenFor,
  showsCube,
  showsPaper,
  truncate,
  typingBob,
  visualColor,
  visualStateFor,
  waveAngle
} from './animation'

describe('visualStateFor', () => {
  it('maps an empty slot to idle', () => {
    expect(visualStateFor(undefined)).toBe('idle')
  })

  it('maps states that do not hold a slot to idle', () => {
    expect(visualStateFor('queued')).toBe('idle')
    expect(visualStateFor('watching')).toBe('idle')
    expect(visualStateFor('closed')).toBe('idle')
  })

  it('maps slot-holding states directly', () => {
    expect(visualStateFor('preparing')).toBe('preparing')
    expect(visualStateFor('needs_you')).toBe('needs_you')
    expect(visualStateFor('posting')).toBe('posting')
    expect(visualStateFor('failed')).toBe('failed')
  })

  it('splits reviewing by the last activity kind, defaulting to reading', () => {
    expect(visualStateFor('reviewing')).toBe('reading')
    expect(visualStateFor('reviewing', 'reading')).toBe('reading')
    expect(visualStateFor('reviewing', 'searching')).toBe('reading')
    expect(visualStateFor('reviewing', 'thinking')).toBe('thinking')
    expect(visualStateFor('reviewing', 'writing')).toBe('writing')
    expect(visualStateFor('reviewing', 'running')).toBe('writing')
    expect(visualStateFor('reviewing', 'preparing')).toBe('reading')
    expect(visualStateFor('reviewing', 'done')).toBe('reading')
  })

  it('reviewingSubState falls back to reading', () => {
    expect(reviewingSubState(undefined)).toBe('reading')
    expect(reviewingSubState('error')).toBe('reading')
  })
})

describe('colours', () => {
  it('uses the UI tokens per mission state', () => {
    expect(missionStateColor('queued')).toBe(TOKENS.muted)
    expect(missionStateColor('preparing')).toBe(TOKENS.accent)
    expect(missionStateColor('reviewing')).toBe(TOKENS.accent)
    expect(missionStateColor('needs_you')).toBe(TOKENS.amber)
    expect(missionStateColor('posting')).toBe(TOKENS.accent)
    expect(missionStateColor('watching')).toBe(TOKENS.teal)
    expect(missionStateColor('failed')).toBe(TOKENS.rose)
    expect(missionStateColor(undefined)).toBe(TOKENS.muted)
  })

  it('token values match the stylesheet', () => {
    expect(TOKENS.amber).toBe('#f5b544')
    expect(TOKENS.accent).toBe('#7c8aff')
    expect(TOKENS.teal).toBe('#4fd1c5')
    expect(TOKENS.rose).toBe('#f4728c')
    expect(TOKENS.lime).toBe('#a3e635')
    expect(TOKENS.muted).toBe('#969db0')
  })

  it('visual colours follow the same palette', () => {
    expect(visualColor('idle')).toBe(TOKENS.muted)
    expect(visualColor('reading')).toBe(TOKENS.accent)
    expect(visualColor('needs_you')).toBe(TOKENS.amber)
    expect(visualColor('failed')).toBe(TOKENS.rose)
  })

  it('chips carry a label and the state colour', () => {
    expect(chipFor('needs_you')).toEqual({ label: 'Needs you', color: TOKENS.amber })
    expect(chipFor('failed').color).toBe(TOKENS.rose)
    expect(chipFor(undefined).label).toBe('Idle')
  })
})

describe('poseFor', () => {
  it('faces the monitor while working and the camera when it needs you', () => {
    expect(poseFor('reading').bodyYaw).toBe(MONITOR_YAW)
    expect(poseFor('writing').bodyYaw).toBe(MONITOR_YAW)
    expect(poseFor('needs_you').bodyYaw).toBe(CAMERA_YAW)
    expect(facesCamera('needs_you')).toBe(true)
    expect(facesCamera('reading')).toBe(false)
  })

  it('leans forward when preparing and looks down at the screen when reading', () => {
    expect(poseFor('preparing').lean).toBeGreaterThan(poseFor('idle').lean)
    expect(poseFor('reading').headPitch).toBeGreaterThan(0)
    expect(poseFor('reading').headRoll).not.toBe(0)
  })

  it('only types while writing and only waves when it needs you', () => {
    const all = ['idle', 'preparing', 'reading', 'thinking', 'writing', 'needs_you', 'posting', 'failed'] as const
    for (const v of all) {
      expect(poseFor(v).typing > 0).toBe(v === 'writing')
      expect(poseFor(v).wave > 0).toBe(v === 'needs_you')
    }
  })

  it('brings a hand to the chin while thinking', () => {
    const p = poseFor('thinking')
    expect(p.armR.bend).toBeGreaterThan(1.5)
    expect(p.armL.bend).toBeLessThan(1)
  })

  it('drops the head and hangs the arms on failure', () => {
    const p = poseFor('failed')
    expect(p.headPitch).toBeGreaterThan(poseFor('reading').headPitch)
    expect(p.armL.pitch).toBeLessThan(0.2)
    expect(p.armR.pitch).toBeLessThan(0.2)
    expect(p.mouth).toBe('frown')
  })

  it('only looks around when idle', () => {
    expect(poseFor('idle').lookAround).toBe(true)
    expect(poseFor('reading').lookAround).toBe(false)
  })
})

describe('screen, lamp and bubble', () => {
  it('switches the screen by state', () => {
    expect(screenFor('idle').mode).toBe('off')
    expect(screenFor('preparing').mode).toBe('loading')
    expect(screenFor('reading').mode).toBe('code')
    expect(screenFor('thinking').mode).toBe('code')
    expect(screenFor('writing').mode).toBe('code')
    expect(screenFor('needs_you').mode).toBe('alert')
    expect(screenFor('posting').mode).toBe('sending')
    expect(screenFor('failed').mode).toBe('flash')
  })

  it('scrolls faster while writing than while reading', () => {
    expect(screenFor('writing').scrollSpeed).toBeGreaterThan(screenFor('reading').scrollSpeed)
    expect(screenFor('reading').scrollSpeed).toBeGreaterThan(screenFor('thinking').scrollSpeed)
  })

  it('dims the lamp when idle and pulses amber when it needs you', () => {
    expect(lampFor('idle').intensity).toBeLessThan(lampFor('reading').intensity)
    expect(lampFor('needs_you')).toMatchObject({ color: TOKENS.amber, pulse: true })
    expect(lampFor('failed').color).toBe(TOKENS.rose)
  })

  it('shows the right bubble', () => {
    expect(bubbleFor('thinking')).toBe('dots')
    expect(bubbleFor('needs_you')).toBe('alert')
    expect(bubbleFor('failed')).toBe('error')
    expect(bubbleFor('reading')).toBe('none')
    expect(bubbleFor('idle', IDLE_SLEEP_MS - 1)).toBe('none')
    expect(bubbleFor('idle', IDLE_SLEEP_MS)).toBe('sleep')
  })

  it('turns the corkboard pin amber and throbbing for a push nobody has reviewed', () => {
    expect(pinFor(false)).toEqual({ color: TOKENS.teal, intensity: 0.4, pulse: false })
    expect(pinFor(true)).toMatchObject({ color: TOKENS.amber, pulse: true })
    expect(pinFor(true).intensity).toBeGreaterThan(pinFor(false).intensity)
  })

  it('pulseLevel throbs between 0 and 1 once per period', () => {
    expect(pulseLevel(0)).toBeCloseTo(0.5)
    expect(pulseLevel(0.25, 1)).toBeCloseTo(1)
    expect(pulseLevel(0.75, 1)).toBeCloseTo(0)
    for (let t = 0; t < 5; t += 0.05) {
      expect(pulseLevel(t)).toBeGreaterThanOrEqual(0)
      expect(pulseLevel(t)).toBeLessThanOrEqual(1)
    }
  })

  it('shows the PR cube while a review is on the desk and the paper only while reading', () => {
    expect(showsCube('preparing')).toBe(true)
    expect(showsCube('needs_you')).toBe(true)
    expect(showsCube('posting')).toBe(false)
    expect(showsCube('idle')).toBe(false)
    expect(showsPaper('reading')).toBe(true)
    expect(showsPaper('writing')).toBe(false)
  })
})

describe('curves', () => {
  it('dropBounce starts high, settles at zero, and bounces in between', () => {
    expect(dropBounce(0)).toBe(1)
    expect(dropBounce(1)).toBe(0)
    expect(dropBounce(2)).toBe(0)
    expect(dropBounce(0.55)).toBeCloseTo(0, 5)
    expect(dropBounce(0.675)).toBeGreaterThan(0.2)
    expect(dropBounce(0.9)).toBeGreaterThan(0)
    expect(dropBounce(0.9)).toBeLessThan(dropBounce(0.675))
    expect(DROP_SECONDS).toBeGreaterThan(0)
  })

  it('paperFlipAngle advances by half a turn per period', () => {
    expect(paperFlipAngle(0)).toBeCloseTo(0)
    expect(paperFlipAngle(1.9, 2)).toBeCloseTo(Math.PI)
    expect(paperFlipAngle(2, 2)).toBeCloseTo(Math.PI)
    expect(paperFlipAngle(3.9, 2)).toBeCloseTo(2 * Math.PI)
    expect(paperFlipAngle(5, 0)).toBe(0)
  })

  it('typingBob alternates the hands', () => {
    const [l, r] = typingBob(1 / 24, 6)
    expect(l).toBeCloseTo(0.06)
    expect(r).toBeCloseTo(-0.06)
    const [l0, r0] = typingBob(0)
    expect(l0).toBeCloseTo(0)
    expect(r0).toBeCloseTo(0)
  })

  it('typingBob writes into the given tuple so frames do not allocate', () => {
    const out: [number, number] = [9, 9]
    expect(typingBob(1 / 24, 6, 0.06, out)).toBe(out)
    expect(out[0]).toBeCloseTo(0.06)
    expect(out[1]).toBeCloseTo(-0.06)
  })

  it('waveAngle stays within its amplitude', () => {
    for (let t = 0; t < 5; t += 0.1) {
      expect(Math.abs(waveAngle(t, 0.45))).toBeLessThanOrEqual(0.45)
    }
  })

  it('loadingProgress climbs towards one without reaching it', () => {
    expect(loadingProgress(0)).toBe(0)
    expect(loadingProgress(1)).toBeGreaterThan(0.3)
    expect(loadingProgress(10)).toBeGreaterThan(0.95)
    expect(loadingProgress(10)).toBeLessThan(1)
  })

  it('flashIntensity strobes then goes dark', () => {
    expect(flashIntensity(0)).toBeCloseTo(1)
    expect(flashIntensity(FLASH_SECONDS / 2)).toBeLessThan(1)
    expect(flashIntensity(FLASH_SECONDS)).toBe(0)
    expect(flashIntensity(-1)).toBe(0)
  })

  it('paperPlaneArc rises and moves off the desk, writing into the given object', () => {
    const out = { x: 0, y: 0, z: 0, roll: 0, pitch: 0 }
    const start = { ...paperPlaneArc(0, out) }
    const end = paperPlaneArc(1, out)
    expect(end).toBe(out)
    expect(end.y).toBeGreaterThan(start.y + 5)
    expect(end.x).toBeGreaterThan(start.x)
    expect(paperPlaneArc(5, out).y).toBe(end.y)
  })
})

describe('planeLaunch', () => {
  it('launches when a mission is seen entering posting, once', () => {
    expect(planeLaunch({ missionId: 'm1', visual: 'needs_you' }, { missionId: 'm1', visual: 'posting' })).toBe('m1')
    expect(planeLaunch({ missionId: 'm1', visual: 'posting' }, { missionId: 'm1', visual: 'posting' })).toBeUndefined()
    expect(planeLaunch({ visual: 'idle' }, { missionId: 'm2', visual: 'posting' })).toBe('m2')
  })

  it('launches on the way out when posting finished between two snapshots', () => {
    expect(planeLaunch({ missionId: 'm1', visual: 'needs_you' }, { visual: 'idle' }, 'watching')).toBe('m1')
    expect(planeLaunch({ missionId: 'm1', visual: 'writing' }, { visual: 'idle' }, 'watching')).toBe('m1')
    expect(planeLaunch({ missionId: 'm1', visual: 'needs_you' }, { missionId: 'm2', visual: 'preparing' }, 'watching')).toBe('m1')
  })

  it('does not launch twice for a mission already seen posting', () => {
    expect(planeLaunch({ missionId: 'm1', visual: 'posting' }, { visual: 'idle' }, 'watching')).toBeUndefined()
  })

  it('does not launch when the mission left for any other reason', () => {
    expect(planeLaunch({ missionId: 'm1', visual: 'needs_you' }, { visual: 'idle' }, 'closed')).toBeUndefined()
    expect(planeLaunch({ missionId: 'm1', visual: 'reading' }, { missionId: 'm1', visual: 'failed' }, undefined)).toBeUndefined()
    expect(planeLaunch({ missionId: 'm1', visual: 'needs_you' }, { visual: 'idle' }, undefined)).toBeUndefined()
    expect(planeLaunch({ visual: 'idle' }, { visual: 'idle' })).toBeUndefined()
  })
})

describe('elapsed time', () => {
  const base: Mission = {
    id: 'm1',
    prId: 'acme/x#1',
    pr: {} as Mission['pr'],
    loadoutId: 'blind',
    state: 'reviewing',
    rounds: [],
    stale: false,
    autoPost: false,
    createdAt: '2026-09-13T12:00:00Z',
    updatedAt: '2026-09-13T12:03:00Z',
    timeline: [
      { at: '2026-09-13T12:00:00Z', to: 'queued' },
      { at: '2026-09-13T12:01:00Z', from: 'queued', to: 'preparing' },
      { at: '2026-09-13T12:02:00Z', from: 'preparing', to: 'reviewing' }
    ]
  }

  it('measures from the last timeline entry for the current state', () => {
    const now = Date.parse('2026-09-13T12:02:45Z')
    expect(elapsedInState(base, now)).toBe(45_000)
  })

  it('ignores notes recorded without a state change', () => {
    const annotated = {
      ...base,
      state: 'watching' as const,
      updatedAt: '2026-09-13T12:10:00Z',
      timeline: [...base.timeline, { at: '2026-09-13T12:05:00Z', from: 'posting' as const, to: 'watching' as const }, { at: '2026-09-13T12:10:00Z', to: 'watching' as const, note: 'new push; auto follow-up paused' }]
    }
    expect(elapsedInState(annotated, Date.parse('2026-09-13T12:11:00Z'))).toBe(6 * 60_000)
  })

  it('falls back to updatedAt when the timeline has no entry for the state', () => {
    const now = Date.parse('2026-09-13T12:03:10Z')
    expect(elapsedInState({ ...base, state: 'posting' }, now)).toBe(10_000)
  })

  it('never goes negative', () => {
    expect(elapsedInState(base, Date.parse('2026-09-13T11:00:00Z'))).toBe(0)
  })

  it('formats elapsed durations compactly', () => {
    expect(formatElapsed(0)).toBe('0s')
    expect(formatElapsed(59_000)).toBe('59s')
    expect(formatElapsed(61_000)).toBe('1m 1s')
    expect(formatElapsed(3_725_000)).toBe('1h 2m')
  })

  it('truncates long titles with an ellipsis', () => {
    expect(truncate('short', 10)).toBe('short')
    expect(truncate('a very long pull request title', 12)).toBe('a very long…')
  })
})
