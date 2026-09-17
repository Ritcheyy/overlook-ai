import { useRef, useState } from 'react'
import { useFrame, type ThreeEvent } from '@react-three/fiber'
import { ContactShadows, Edges, Float, Html, RoundedBox, Sparkles, useCursor } from '@react-three/drei'
import * as THREE from 'three'
import type { Mission } from '@core/domain'
import { useAppStore } from '@/state/store'
import { TOKENS, pinFor, pulseLevel } from './animation'
import { hasUnreviewedPush } from './floor-selectors'
import { NewPushChip } from './Hud'
import {
  CAMERA_POSITION,
  CAMERA_TARGET,
  CORKBOARD_POS,
  MAX_CORKBOARD_CARDS,
  MAX_QUEUE_CARDS,
  PARALLAX,
  PLATFORM_SIZE,
  PLATFORM_TOP,
  SHELF_POS,
  WALL_HEIGHT,
  WALL_WIDTH,
  WALL_Z,
  WINDOW_POS,
  cameraZoom
} from './layout'
import { Station } from './Station'
import { useQueue, useSlots, useWatching } from './useFloorData'

const HTML_Z: [number, number] = [20, 11]

const BASE = new THREE.Vector3(...CAMERA_POSITION)
const TARGET = new THREE.Vector3(...CAMERA_TARGET)
const UP = new THREE.Vector3(0, 1, 0)
const pos = new THREE.Vector3()
const right = new THREE.Vector3()

function CameraRig() {
  const cur = useRef({ yaw: 0, pitch: 0 })
  useFrame((state, delta) => {
    const dt = Math.min(delta, 0.1)
    const cam = state.camera
    cur.current.yaw = THREE.MathUtils.damp(cur.current.yaw, state.pointer.x * PARALLAX, 2.5, dt)
    cur.current.pitch = THREE.MathUtils.damp(cur.current.pitch, -state.pointer.y * PARALLAX, 2.5, dt)
    pos.copy(BASE).applyAxisAngle(UP, cur.current.yaw)
    right.crossVectors(UP, pos).normalize()
    pos.applyAxisAngle(right, cur.current.pitch)
    cam.position.copy(pos).add(TARGET)
    cam.lookAt(TARGET)
    const zoom = cameraZoom(state.size.width, state.size.height)
    if (Math.abs(cam.zoom - zoom) > 0.01) {
      cam.zoom = zoom
      cam.updateProjectionMatrix()
    }
  })
  return null
}

function Lights() {
  return (
    <>
      <ambientLight intensity={0.35} />
      <hemisphereLight args={['#aab6ff', '#1a1d29', 0.8]} />
      <directionalLight
        position={[8, 12, 6]}
        intensity={3.4}
        color="#fff3e0"
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0004}
        shadow-normalBias={0.02}
      >
        <orthographicCamera attach="shadow-camera" args={[-8, 8, 8, -8, 1, 40]} />
      </directionalLight>
      <pointLight position={[WINDOW_POS[0], WINDOW_POS[1], WINDOW_POS[2] + 0.7]} color="#8fb0ff" intensity={10} distance={7} decay={2} />
    </>
  )
}

function Platform() {
  return (
    <>
      <RoundedBox args={PLATFORM_SIZE} radius={0.12} smoothness={4} castShadow receiveShadow>
        <meshStandardMaterial color="#1c2130" roughness={0.9} />
      </RoundedBox>
      <mesh position={[0, PLATFORM_TOP + 0.004, 0.25]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[6.8, 3.8]} />
        <meshStandardMaterial color="#2b3245" roughness={0.95} />
      </mesh>
      <mesh position={[0, PLATFORM_TOP + 0.006, 0.25]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[6.2, 3.2]} />
        <meshStandardMaterial color="#323a4f" roughness={0.95} />
      </mesh>
    </>
  )
}

function BackWall() {
  const [wx, wy, wz] = WINDOW_POS
  return (
    <>
      <mesh position={[0, PLATFORM_TOP + WALL_HEIGHT / 2, WALL_Z]} castShadow receiveShadow>
        <boxGeometry args={[WALL_WIDTH, WALL_HEIGHT, 0.16]} />
        <meshStandardMaterial color="#1b202c" roughness={0.95} />
      </mesh>

      <group position={[wx, wy, wz]}>
        <mesh position={[0, 0, 0]}>
          <planeGeometry args={[1.6, 1.2]} />
          <meshBasicMaterial color="#9fbcff" toneMapped={false} />
        </mesh>
        <mesh position={[0, 0.635, 0.03]}>
          <boxGeometry args={[1.74, 0.07, 0.08]} />
          <meshStandardMaterial color="#2c3346" roughness={0.8} />
        </mesh>
        <mesh position={[0, -0.635, 0.03]}>
          <boxGeometry args={[1.74, 0.07, 0.08]} />
          <meshStandardMaterial color="#2c3346" roughness={0.8} />
        </mesh>
        <mesh position={[-0.835, 0, 0.03]}>
          <boxGeometry args={[0.07, 1.34, 0.08]} />
          <meshStandardMaterial color="#2c3346" roughness={0.8} />
        </mesh>
        <mesh position={[0.835, 0, 0.03]}>
          <boxGeometry args={[0.07, 1.34, 0.08]} />
          <meshStandardMaterial color="#2c3346" roughness={0.8} />
        </mesh>
        <mesh position={[0, 0, 0.02]}>
          <boxGeometry args={[0.04, 1.2, 0.05]} />
          <meshStandardMaterial color="#2c3346" roughness={0.8} />
        </mesh>
        <mesh position={[0, 0, 0.02]}>
          <boxGeometry args={[1.6, 0.04, 0.05]} />
          <meshStandardMaterial color="#2c3346" roughness={0.8} />
        </mesh>
      </group>
    </>
  )
}

function QueueCard({ mission, index }: { mission: Mission; index: number }) {
  const navigate = useAppStore((s) => s.navigate)
  const [hovered, setHovered] = useState(false)
  useCursor(hovered)
  const x = -0.76 + index * 0.38
  return (
    <Float speed={2} rotationIntensity={0.15} floatIntensity={0.5} floatingRange={[-0.04, 0.04]}>
      <group
        position={[x, 0.32, 0]}
        rotation={[0, 0.25, 0]}
        onPointerOver={(e: ThreeEvent<PointerEvent>) => {
          e.stopPropagation()
          setHovered(true)
        }}
        onPointerOut={() => setHovered(false)}
        onClick={(e: ThreeEvent<MouseEvent>) => {
          e.stopPropagation()
          navigate('triage', { missionId: mission.id })
        }}
      >
        <mesh>
          <boxGeometry args={[0.26, 0.34, 0.03]} />
          <meshStandardMaterial color={hovered ? '#eef1f8' : '#d9deea'} roughness={0.85} />
          <Edges visible={hovered} color={TOKENS.accent} threshold={15} />
        </mesh>
        <mesh position={[-0.07, 0.19, 0]}>
          <boxGeometry args={[0.1, 0.05, 0.03]} />
          <meshStandardMaterial color={TOKENS.muted} roughness={0.85} />
        </mesh>
        {hovered && (
          <Html position={[0, 0.3, 0]} center zIndexRange={HTML_Z} pointerEvents="none">
            <div className="pointer-events-none whitespace-nowrap rounded border border-line bg-raised/90 px-1.5 py-0.5 font-mono text-[10px] text-ink">
              #{mission.pr.number} · queued
            </div>
          </Html>
        )}
      </group>
    </Float>
  )
}

function Shelf() {
  const queue = useQueue()
  const [sx, sy, sz] = SHELF_POS
  const shown = queue.slice(0, MAX_QUEUE_CARDS)
  const extra = queue.length - shown.length
  return (
    <group position={[sx, sy, sz]}>
      <mesh position={[0, 0.475, 0]} castShadow receiveShadow>
        <boxGeometry args={[1.7, 0.95, 0.42]} />
        <meshStandardMaterial color="#20263a" roughness={0.9} />
      </mesh>
      <mesh position={[0, 0.975, 0]} castShadow receiveShadow>
        <boxGeometry args={[1.8, 0.05, 0.5]} />
        <meshStandardMaterial color="#2c3346" roughness={0.9} />
      </mesh>
      <group position={[0, 0.975, 0]}>
        {shown.map((m, i) => (
          <QueueCard key={m.id} mission={m} index={i} />
        ))}
        {extra > 0 && (
          <Html position={[1.15, 0.32, 0]} center zIndexRange={HTML_Z} pointerEvents="none">
            <div className="pointer-events-none whitespace-nowrap rounded-full border border-line bg-raised/90 px-1.5 py-0.5 font-mono text-[10px] text-muted">
              +{extra}
            </div>
          </Html>
        )}
      </group>
    </group>
  )
}

/** Where the "new push" tag hangs off a card, per column: from its left edge, centred, or from its right edge, so it stays on the board. */
const TAG_ANCHORS: [number, string][] = [
  [-0.21, 'none'],
  [0, 'translateX(-50%)'],
  [0.21, 'translateX(-100%)']
]

function CorkCard({ mission, index }: { mission: Mission; index: number }) {
  const navigate = useAppStore((s) => s.navigate)
  const [hovered, setHovered] = useState(false)
  useCursor(hovered)
  const col = index % 3
  const row = Math.floor(index / 3)
  const x = -0.5 + col * 0.5
  const y = 0.22 - row * 0.42
  const tilt = ((index * 7) % 5) * 0.02 - 0.04
  const newPush = hasUnreviewedPush(mission)
  const pin = pinFor(newPush)
  const pinMat = useRef<THREE.MeshStandardMaterial>(null)
  const haloMat = useRef<THREE.MeshBasicMaterial>(null)
  useFrame((state) => {
    if (!pin.pulse) return
    const level = pulseLevel(state.clock.elapsedTime)
    if (pinMat.current) pinMat.current.emissiveIntensity = pin.intensity * (0.5 + level)
    if (haloMat.current) haloMat.current.opacity = 0.12 + level * 0.3
  })
  const [tagX, tagShift] = TAG_ANCHORS[col]
  return (
    <group
      position={[x, y, 0.04]}
      rotation={[0, 0, tilt]}
      onPointerOver={(e: ThreeEvent<PointerEvent>) => {
        e.stopPropagation()
        setHovered(true)
      }}
      onPointerOut={() => setHovered(false)}
      onClick={(e: ThreeEvent<MouseEvent>) => {
        e.stopPropagation()
        navigate('triage', { missionId: mission.id })
      }}
    >
      {newPush && (
        // Sits between the cork face and the card, so it only shows as a halo around the card's edges.
        <mesh position={[0, 0, -0.004]}>
          <planeGeometry args={[0.52, 0.4]} />
          <meshBasicMaterial ref={haloMat} color={TOKENS.amber} transparent opacity={0.3} depthWrite={false} toneMapped={false} />
        </mesh>
      )}
      <mesh>
        <boxGeometry args={[0.42, 0.3, 0.02]} />
        <meshStandardMaterial color={hovered ? '#ffffff' : '#e8eaf0'} roughness={0.9} />
      </mesh>
      <mesh position={[0, 0.12, 0.02]}>
        <sphereGeometry args={[newPush ? 0.04 : 0.03, 10, 8]} />
        <meshStandardMaterial ref={pinMat} color={pin.color} emissive={pin.color} emissiveIntensity={pin.intensity} roughness={0.4} />
      </mesh>
      <Html position={[0, -0.03, 0.02]} center zIndexRange={HTML_Z} pointerEvents="none">
        <div className="pointer-events-none whitespace-nowrap font-mono text-[10px] text-bg">#{mission.pr.number}</div>
      </Html>
      {newPush && (
        <Html position={[tagX, -0.21, 0.03]} zIndexRange={HTML_Z} pointerEvents="none">
          <div className="pointer-events-none" style={{ transform: tagShift }}>
            <NewPushChip className="bg-bg/90 shadow-[0_0_10px_rgba(245,181,68,0.55)]" />
          </div>
        </Html>
      )}
    </group>
  )
}

function Corkboard() {
  const watching = useWatching()
  const [cx, cy, cz] = CORKBOARD_POS
  const shown = watching.slice(0, MAX_CORKBOARD_CARDS)
  const extra = watching.length - shown.length
  return (
    <group position={[cx, cy, cz]}>
      <mesh position={[0, 0, 0]} castShadow>
        <boxGeometry args={[1.8, 1.2, 0.04]} />
        <meshStandardMaterial color="#3a2f28" roughness={0.9} />
      </mesh>
      <mesh position={[0, 0, 0.015]}>
        <boxGeometry args={[1.68, 1.08, 0.04]} />
        <meshStandardMaterial color="#8a6a4b" roughness={1} />
      </mesh>
      {shown.map((m, i) => (
        <CorkCard key={m.id} mission={m} index={i} />
      ))}
      {extra > 0 && (
        <Html position={[0.75, -0.48, 0.05]} center zIndexRange={HTML_Z} pointerEvents="none">
          <div className="pointer-events-none whitespace-nowrap rounded-full border border-line bg-raised/90 px-1.5 py-0.5 font-mono text-[10px] text-muted">
            +{extra}
          </div>
        </Html>
      )}
    </group>
  )
}

export function FloorScene() {
  const slots = useSlots()
  return (
    <>
      <color attach="background" args={[TOKENS.bg]} />
      <CameraRig />
      <Lights />
      <Platform />
      <BackWall />
      <Shelf />
      <Corkboard />
      {slots.slice(0, 2).map((slot, i) => (
        <Station key={slot.id} slot={slot} index={i} />
      ))}
      <Sparkles count={50} scale={[8, 3, 5]} position={[0, PLATFORM_TOP + 1.6, -0.3]} size={1.6} speed={0.25} opacity={0.3} color="#c9d2ff" noise={0.4} />
      <ContactShadows position={[0, -0.95, 0]} scale={[18, 12]} blur={2.6} opacity={0.6} far={4} resolution={512} frames={1} color="#000000" />
    </>
  )
}
