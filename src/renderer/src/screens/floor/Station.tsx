import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useFrame, type ThreeEvent } from '@react-three/fiber'
import { Edges, useCursor } from '@react-three/drei'
import * as THREE from 'three'
import type { Slot } from '@core/domain'
import { useAppStore } from '@/state/store'
import type { Bubble, PlanePoint, SlotGlimpse } from './animation'
import {
  DROP_SECONDS,
  IDLE_SLEEP_MS,
  PLANE_SECONDS,
  TOKENS,
  bubbleFor,
  clamp01,
  dropBounce,
  flashIntensity,
  lampFor,
  loadingProgress,
  paperFlipAngle,
  paperPlaneArc,
  planeLaunch,
  poseFor,
  screenFor,
  showsCube,
  showsPaper,
  visualColor
} from './animation'
import { BUBBLE_HEIGHT, DESK_HEIGHT, DESK_ROTATION, DESK_SIZE, MONITOR_OFFSET, MONITOR_YAW_WORLD, SCREEN_SIZE, SEAT_OFFSET, deskPosition } from './layout'
import { Character } from './Character'
import { FloorLabel } from './FloorLabel'
import { hasUnreviewedPush } from './floor-selectors'
import { NewPushChip } from './Hud'
import { ScreenPainter } from './screen-painter'
import { useIdleSince, useSlotView } from './useFloorData'

const HTML_Z: [number, number] = [20, 11]

interface Props {
  slot: Slot
  index: number
}

export function Station({ slot, index }: Props) {
  const { mission, visual, findingCount } = useSlotView(slot)
  const openDetails = useAppStore((s) => s.openDetails)
  const [hovered, setHovered] = useState(false)
  useCursor(hovered && !!mission)

  const idleSince = useIdleSince(!!mission)
  const [asleep, setAsleep] = useState(false)
  useEffect(() => {
    setAsleep(false)
    if (idleSince === undefined) return
    const id = setTimeout(() => setAsleep(true), IDLE_SLEEP_MS)
    return () => clearTimeout(id)
  }, [idleSince])

  const pose = poseFor(visual)
  const stateColor = visualColor(visual)
  const bubble = bubbleFor(visual, asleep ? IDLE_SLEEP_MS : 0)
  const screen = screenFor(visual)
  const lampSpec = lampFor(visual)

  const painter = useMemo(() => new ScreenPainter(), [])
  useEffect(() => () => painter.dispose(), [painter])
  const planeGeometry = useMemo(() => {
    const g = new THREE.BufferGeometry()
    const nose = [0, 0, 0.26]
    const left = [-0.13, 0, -0.14]
    const right = [0.13, 0, -0.14]
    const keel = [0, -0.09, -0.14]
    g.setAttribute('position', new THREE.Float32BufferAttribute([...nose, ...left, ...keel, ...nose, ...keel, ...right], 3))
    g.computeVertexNormals()
    return g
  }, [])
  useEffect(() => () => planeGeometry.dispose(), [planeGeometry])

  const lamp = useRef<THREE.PointLight>(null)
  const bulbMat = useRef<THREE.MeshStandardMaterial>(null)
  const cube = useRef<THREE.Mesh>(null)
  const cubeMat = useRef<THREE.MeshStandardMaterial>(null)
  const paper = useRef<THREE.Mesh>(null)
  const plane = useRef<THREE.Mesh>(null)

  const spec = useRef({ visual, screen, lampSpec })
  spec.current = { visual, screen, lampSpec }
  const enteredAt = useRef(-1)
  // Layout effect so no frame samples `since` against the previous state.
  useLayoutEffect(() => {
    enteredAt.current = -1
  }, [visual])

  // Posting often completes between two snapshots, so the flight is latched
  // from slot transitions rather than read off the current visual state.
  const glimpse = useRef<SlotGlimpse>({ visual: 'idle' })
  const pendingLaunch = useRef<string | undefined>(undefined)
  const flightStart = useRef(-1)
  const missionId = mission?.id
  useLayoutEffect(() => {
    const prev = glimpse.current
    const next: SlotGlimpse = { missionId, visual }
    glimpse.current = next
    const left = prev.missionId && prev.missionId !== missionId ? prev.missionId : undefined
    const leftState = left ? useAppStore.getState().snapshot?.missions.find((m) => m.id === left)?.state : undefined
    const launch = planeLaunch(prev, next, leftState)
    if (launch) pendingLaunch.current = launch
  }, [missionId, visual])

  // Only the first colours go through React; later ones are lerped per frame,
  // and re-applying the props would snap them straight to the target.
  const [initial] = useState(() => ({ lamp: lampSpec, cubeEmissive: stateColor }))
  const lampTarget = useRef(new THREE.Color(lampSpec.color))
  useEffect(() => {
    lampTarget.current.set(lampSpec.color)
  }, [lampSpec.color])
  const cubeTarget = useRef(new THREE.Color(stateColor))
  useEffect(() => {
    cubeTarget.current.set(stateColor)
  }, [stateColor])
  const lampLevel = useRef(lampSpec.intensity)
  const arc = useRef<PlanePoint>({ x: 0, y: 0, z: 0, roll: 0, pitch: 0 })

  useFrame((state, delta) => {
    const dt = Math.min(delta, 0.1)
    const t = state.clock.elapsedTime
    if (enteredAt.current < 0) enteredAt.current = t
    const since = t - enteredAt.current
    const { visual: v, screen: sc, lampSpec: ls } = spec.current

    let level = ls.intensity
    if (ls.pulse) level *= 0.75 + 0.45 * Math.sin(t * 4.5)
    // A slow ramp reads as the lamp warming up while the worktree is prepared.
    lampLevel.current = THREE.MathUtils.damp(lampLevel.current, level, v === 'preparing' ? 1.6 : 6, dt)
    if (lamp.current) {
      lamp.current.intensity = lampLevel.current
      lamp.current.color.lerp(lampTarget.current, 1 - Math.exp(-4 * dt))
      if (bulbMat.current) {
        bulbMat.current.emissive.copy(lamp.current.color)
        bulbMat.current.emissiveIntensity = 0.2 + lampLevel.current * 0.45
      }
    }

    let screenLevel = 0
    if (sc.mode === 'code') painter.advance(sc.scrollSpeed * dt)
    else if (sc.mode === 'loading') screenLevel = loadingProgress(since)
    else if (sc.mode === 'sending') screenLevel = clamp01(since / PLANE_SECONDS)
    else if (sc.mode === 'flash') screenLevel = flashIntensity(since)
    painter.paint(sc.mode, sc.color, screenLevel)

    if (cube.current) {
      const show = showsCube(v)
      cube.current.visible = show
      if (show) {
        const h = v === 'preparing' ? dropBounce(since / DROP_SECONDS) : 0
        cube.current.position.y = DESK_HEIGHT + 0.11 + h * 2.4
        cube.current.rotation.y += dt * 0.7
        cube.current.rotation.x = h * 1.4
        if (cubeMat.current) {
          cubeMat.current.emissive.lerp(cubeTarget.current, 1 - Math.exp(-5 * dt))
          cubeMat.current.emissiveIntensity = 0.55 + 0.3 * Math.sin(t * 3)
        }
      }
    }

    if (paper.current) {
      const show = showsPaper(v)
      paper.current.visible = show
      if (show) {
        paper.current.rotation.y = paperFlipAngle(since)
        paper.current.position.y = DESK_HEIGHT + 0.5 + Math.sin(t * 1.7) * 0.04
      }
    }

    if (plane.current) {
      if (pendingLaunch.current) {
        pendingLaunch.current = undefined
        flightStart.current = t
      }
      const p = flightStart.current < 0 ? 1 : (t - flightStart.current) / PLANE_SECONDS
      const show = p < 1
      if (!show) flightStart.current = -1
      plane.current.visible = show
      if (show) {
        const a = paperPlaneArc(p, arc.current)
        plane.current.position.set(a.x, a.y, a.z)
        plane.current.rotation.set(a.pitch, 0.35, a.roll)
      }
    }
  })

  const open = () => {
    if (mission) openDetails({ missionId: mission.id })
  }
  const onClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation()
    open()
  }

  return (
    <group
      position={deskPosition(index)}
      rotation={[0, DESK_ROTATION, 0]}
      onPointerOver={(e) => {
        e.stopPropagation()
        setHovered(true)
      }}
      onPointerOut={() => setHovered(false)}
      onClick={onClick}
    >
      <mesh position={[0, DESK_HEIGHT - DESK_SIZE[1] / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={DESK_SIZE} />
        <meshStandardMaterial color="#434c63" roughness={0.85} />
        <Edges visible={hovered} color={TOKENS.ink} transparent opacity={0.45} threshold={15} />
      </mesh>
      <mesh position={[-0.88, (DESK_HEIGHT - 0.06) / 2, 0]} castShadow>
        <boxGeometry args={[0.06, DESK_HEIGHT - 0.06, 0.8]} />
        <meshStandardMaterial color="#262c3c" roughness={0.9} />
      </mesh>
      <mesh position={[0.88, (DESK_HEIGHT - 0.06) / 2, 0]} castShadow>
        <boxGeometry args={[0.06, DESK_HEIGHT - 0.06, 0.8]} />
        <meshStandardMaterial color="#262c3c" roughness={0.9} />
      </mesh>
      <mesh position={[0, 0.38, -0.42]}>
        <boxGeometry args={[1.7, 0.32, 0.04]} />
        <meshStandardMaterial color="#262c3c" roughness={0.9} />
      </mesh>

      <group position={MONITOR_OFFSET} rotation={[-0.08, MONITOR_YAW_WORLD, 0]}>
        <mesh position={[0, 0.01, 0]}>
          <boxGeometry args={[0.34, 0.02, 0.2]} />
          <meshStandardMaterial color="#1b2030" roughness={0.6} metalness={0.2} />
        </mesh>
        <mesh position={[0, 0.12, -0.03]}>
          <boxGeometry args={[0.06, 0.22, 0.04]} />
          <meshStandardMaterial color="#1b2030" roughness={0.6} metalness={0.2} />
        </mesh>
        <mesh position={[0, 0.46, 0]} castShadow>
          <boxGeometry args={[0.82, 0.54, 0.04]} />
          <meshStandardMaterial color="#0f1219" roughness={0.5} />
        </mesh>
        <mesh position={[0, 0.46, 0.021]}>
          <planeGeometry args={SCREEN_SIZE} />
          <meshBasicMaterial map={painter.texture} toneMapped={false} />
        </mesh>
      </group>

      <group position={[-0.12, DESK_HEIGHT, 0.12]} rotation={[0, 0.15, 0]}>
        <mesh position={[0, 0.015, 0]}>
          <boxGeometry args={[0.5, 0.03, 0.18]} />
          <meshStandardMaterial color="#1b2030" roughness={0.8} />
        </mesh>
        <mesh position={[0, 0.031, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[0.44, 0.13]} />
          <meshStandardMaterial color="#2c3346" roughness={0.8} />
        </mesh>
      </group>

      <group position={[0.42, DESK_HEIGHT, 0.32]}>
        <mesh position={[0, 0.06, 0]}>
          <cylinderGeometry args={[0.055, 0.05, 0.12, 16]} />
          <meshStandardMaterial color={slot.color} roughness={0.5} />
        </mesh>
        <mesh position={[0.07, 0.06, 0]}>
          <torusGeometry args={[0.035, 0.011, 6, 12]} />
          <meshStandardMaterial color={slot.color} roughness={0.5} />
        </mesh>
      </group>

      <group position={[-0.72, DESK_HEIGHT, -0.26]}>
        <mesh position={[0, 0.012, 0]}>
          <cylinderGeometry args={[0.1, 0.11, 0.025, 20]} />
          <meshStandardMaterial color="#2a3042" roughness={0.6} metalness={0.3} />
        </mesh>
        <mesh position={[0.06, 0.26, 0.04]} rotation={[0.15, 0, -0.25]}>
          <cylinderGeometry args={[0.014, 0.014, 0.5, 8]} />
          <meshStandardMaterial color="#3a4258" roughness={0.5} metalness={0.4} />
        </mesh>
        <mesh position={[0.18, 0.5, 0.1]} rotation={[0.4, 0, -0.45]} castShadow>
          <coneGeometry args={[0.14, 0.17, 16, 1, true]} />
          <meshStandardMaterial color="#2f3548" roughness={0.6} side={THREE.DoubleSide} />
        </mesh>
        <mesh position={[0.2, 0.44, 0.12]}>
          <sphereGeometry args={[0.045, 12, 10]} />
          <meshStandardMaterial ref={bulbMat} color="#fff1d6" emissive="#ffd9a0" emissiveIntensity={0.6} toneMapped={false} />
        </mesh>
        <pointLight ref={lamp} position={[0.24, 0.4, 0.16]} color={initial.lamp.color} intensity={initial.lamp.intensity} distance={3.2} decay={2} />
      </group>

      {index % 2 === 0 ? (
        <group position={[0.8, DESK_HEIGHT, -0.32]}>
          <mesh position={[0, 0.075, 0]}>
            <cylinderGeometry args={[0.08, 0.06, 0.15, 14]} />
            <meshStandardMaterial color="#4a3b33" roughness={0.9} />
          </mesh>
          <mesh position={[0, 0.25, 0]} scale={[1, 1.3, 1]} castShadow>
            <sphereGeometry args={[0.11, 10, 8]} />
            <meshStandardMaterial color="#4f9d5d" roughness={0.8} />
          </mesh>
          <mesh position={[-0.08, 0.2, 0.05]}>
            <sphereGeometry args={[0.07, 10, 8]} />
            <meshStandardMaterial color="#5cb36a" roughness={0.8} />
          </mesh>
          <mesh position={[0.08, 0.21, -0.04]}>
            <sphereGeometry args={[0.065, 10, 8]} />
            <meshStandardMaterial color="#5cb36a" roughness={0.8} />
          </mesh>
        </group>
      ) : (
        <group position={[0.8, DESK_HEIGHT, -0.3]}>
          <mesh position={[0, 0.006, 0]} rotation={[0, 0.05, 0]}>
            <boxGeometry args={[0.28, 0.012, 0.36]} />
            <meshStandardMaterial color="#e8eaf0" roughness={0.9} />
          </mesh>
          <mesh position={[0, 0.018, 0]} rotation={[0, -0.08, 0]}>
            <boxGeometry args={[0.28, 0.012, 0.36]} />
            <meshStandardMaterial color="#dfe3ee" roughness={0.9} />
          </mesh>
          <mesh position={[0, 0.03, 0]} rotation={[0, 0.12, 0]}>
            <boxGeometry args={[0.28, 0.012, 0.36]} />
            <meshStandardMaterial color="#e8eaf0" roughness={0.9} />
          </mesh>
        </group>
      )}

      <mesh ref={cube} position={[-0.68, DESK_HEIGHT + 0.11, 0.14]} visible={false} castShadow>
        <boxGeometry args={[0.2, 0.2, 0.2]} />
        <meshStandardMaterial ref={cubeMat} color="#2a2f45" emissive={initial.cubeEmissive} emissiveIntensity={0.6} roughness={0.4} />
      </mesh>
      <mesh ref={paper} position={[-0.4, DESK_HEIGHT + 0.5, 0.25]} visible={false}>
        <planeGeometry args={[0.2, 0.26]} />
        <meshStandardMaterial color="#e8eaf0" roughness={0.9} side={THREE.DoubleSide} />
      </mesh>
      <mesh ref={plane} geometry={planeGeometry} visible={false}>
        <meshStandardMaterial color="#e8eaf0" roughness={0.7} side={THREE.DoubleSide} />
      </mesh>

      <group position={SEAT_OFFSET}>
        <Character color={slot.color} pose={pose} accent={stateColor} hovered={hovered} />
      </group>

      {bubble !== 'none' && (
        <FloorLabel position={[SEAT_OFFSET[0], BUBBLE_HEIGHT, SEAT_OFFSET[2]]} center zIndexRange={HTML_Z}>
          <BubbleView kind={bubble} onClick={bubble === 'alert' || bubble === 'error' ? open : undefined} />
        </FloorLabel>
      )}
      {visual === 'needs_you' && (
        <FloorLabel position={[MONITOR_OFFSET[0] + 0.55, DESK_HEIGHT + 0.95, MONITOR_OFFSET[2]]} center zIndexRange={HTML_Z}>
          <div className="pointer-events-none whitespace-nowrap rounded-md border border-amber/40 bg-bg/85 px-2 py-0.5 font-mono text-[11px] text-amber">
            {findingCount} finding{findingCount === 1 ? '' : 's'}
          </div>
        </FloorLabel>
      )}
      {visual === 'needs_you' && mission && hasUnreviewedPush(mission) && (
        <FloorLabel position={[SEAT_OFFSET[0], BUBBLE_HEIGHT - 0.5, SEAT_OFFSET[2]]} center zIndexRange={HTML_Z}>
          <NewPushChip className="pointer-events-none bg-bg/90 shadow-[0_0_10px_rgba(245,181,68,0.55)]" />
        </FloorLabel>
      )}
    </group>
  )
}

function BubbleView({ kind, onClick }: { kind: Bubble; onClick?: () => void }) {
  switch (kind) {
    case 'dots':
      return (
        <div className="pointer-events-none select-none rounded-full border border-line bg-raised/90 px-2.5 py-0.5 text-sm leading-none tracking-[0.2em] text-ink">
          …
        </div>
      )
    case 'alert':
      return (
        <button
          type="button"
          onClick={onClick}
          className="pointer-events-auto relative flex h-8 w-8 items-center justify-center"
          title="Findings are waiting for you"
          aria-label="Open the details: findings are waiting for you"
        >
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber opacity-50" />
          <span className="relative flex h-6 w-6 items-center justify-center rounded-full bg-amber text-sm font-bold leading-none text-bg shadow-[0_0_12px_rgba(245,181,68,0.7)]">
            !
          </span>
        </button>
      )
    case 'error':
      return (
        <button
          type="button"
          onClick={onClick}
          className="pointer-events-auto relative flex h-8 w-8 items-center justify-center"
          title="This review failed"
          aria-label="Open the details: this review failed"
        >
          <span className="relative flex h-6 w-6 items-center justify-center rounded-full bg-rose text-sm font-bold leading-none text-bg shadow-[0_0_12px_rgba(244,114,142,0.6)]">
            ×
          </span>
        </button>
      )
    case 'sleep':
      return <div className="pointer-events-none animate-pulse select-none font-mono text-xs italic text-muted">zZ</div>
    default:
      return null
  }
}
