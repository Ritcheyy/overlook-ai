import { useEffect, useMemo, useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import type { Pose } from './animation'
import { typingBob, waveAngle } from './animation'
import { CHARACTER_SCALE } from './layout'

const WHITE = new THREE.Color('#ffffff')
const DARK = new THREE.Color('#141821')
const scratch = new THREE.Color()

function lighten(hex: string, amount: number): string {
  return `#${scratch.set(hex).lerp(WHITE, amount).getHexString()}`
}

function darken(hex: string, amount: number): string {
  return `#${scratch.set(hex).lerp(DARK, amount).getHexString()}`
}

interface Props {
  color: string
  pose: Pose
  /** Emissive colour of the antenna tip. */
  accent: string
  hovered: boolean
}

interface Current {
  bodyYaw: number
  lean: number
  headYaw: number
  headPitch: number
  headRoll: number
  lPitch: number
  lYaw: number
  lBend: number
  rPitch: number
  rYaw: number
  rBend: number
  typing: number
  wave: number
  breathe: number
  glow: number
}

const BLINK_SECONDS = 0.16
const SPEED = 5

export function Character({ color, pose, accent, hovered }: Props) {
  const body = useRef<THREE.Group>(null)
  const head = useRef<THREE.Group>(null)
  const eyeL = useRef<THREE.Mesh>(null)
  const eyeR = useRef<THREE.Mesh>(null)
  const armL = useRef<THREE.Group>(null)
  const armR = useRef<THREE.Group>(null)
  const foreL = useRef<THREE.Group>(null)
  const foreR = useRef<THREE.Group>(null)
  const mouthSmile = useRef<THREE.Mesh>(null)
  const mouthNeutral = useRef<THREE.Mesh>(null)
  const mouthFrown = useRef<THREE.Mesh>(null)
  const tipMat = useRef<THREE.MeshStandardMaterial>(null)
  const bodyMat = useRef<THREE.MeshStandardMaterial>(null)

  const poseRef = useRef(pose)
  poseRef.current = pose
  const hoveredRef = useRef(hovered)
  hoveredRef.current = hovered

  // Only the first accent goes through React; later ones are lerped per frame,
  // and re-applying the prop would snap the tip straight to the target.
  const [initialAccent] = useState(accent)
  const tipTarget = useRef(new THREE.Color(accent))
  useEffect(() => {
    tipTarget.current.set(accent)
  }, [accent])

  const cur = useRef<Current>({
    bodyYaw: pose.bodyYaw,
    lean: pose.lean,
    headYaw: pose.headYaw,
    headPitch: pose.headPitch,
    headRoll: pose.headRoll,
    lPitch: pose.armL.pitch,
    lYaw: pose.armL.yaw,
    lBend: pose.armL.bend,
    rPitch: pose.armR.pitch,
    rYaw: pose.armR.yaw,
    rBend: pose.armR.bend,
    typing: pose.typing,
    wave: pose.wave,
    breathe: pose.breathe,
    glow: 0
  })
  const blink = useRef({ nextAt: 2, start: -10 })
  const look = useRef({ nextAt: 3, yaw: 0, pitch: 0 })
  const bob = useRef<[number, number]>([0, 0])

  const headColor = useMemo(() => lighten(color, 0.38), [color])
  const legColor = useMemo(() => darken(color, 0.55), [color])

  useEffect(() => {
    if (body.current) body.current.rotation.order = 'YXZ'
    if (head.current) head.current.rotation.order = 'YXZ'
    if (armL.current) armL.current.rotation.order = 'ZXY'
    if (armR.current) armR.current.rotation.order = 'ZXY'
  }, [])

  useFrame((state, delta) => {
    const dt = Math.min(delta, 0.1)
    const t = state.clock.elapsedTime
    const target = poseRef.current
    const c = cur.current
    const damp = THREE.MathUtils.damp

    if (target.lookAround) {
      if (t >= look.current.nextAt) {
        look.current.yaw = (Math.random() - 0.5) * 1.1
        look.current.pitch = (Math.random() - 0.5) * 0.35
        look.current.nextAt = t + 4.5 + Math.random() * 3
      }
    } else {
      look.current.yaw = 0
      look.current.pitch = 0
      look.current.nextAt = t + 2
    }

    c.bodyYaw = damp(c.bodyYaw, target.bodyYaw, SPEED, dt)
    c.lean = damp(c.lean, target.lean, SPEED, dt)
    c.headYaw = damp(c.headYaw, target.headYaw + look.current.yaw, 3.5, dt)
    c.headPitch = damp(c.headPitch, target.headPitch + look.current.pitch, 3.5, dt)
    c.headRoll = damp(c.headRoll, target.headRoll, SPEED, dt)
    c.lPitch = damp(c.lPitch, target.armL.pitch, SPEED, dt)
    c.lYaw = damp(c.lYaw, target.armL.yaw, SPEED, dt)
    c.lBend = damp(c.lBend, target.armL.bend, SPEED, dt)
    c.rPitch = damp(c.rPitch, target.armR.pitch, SPEED, dt)
    c.rYaw = damp(c.rYaw, target.armR.yaw, SPEED, dt)
    c.rBend = damp(c.rBend, target.armR.bend, SPEED, dt)
    c.typing = damp(c.typing, target.typing, SPEED, dt)
    c.wave = damp(c.wave, target.wave, SPEED, dt)
    c.breathe = damp(c.breathe, target.breathe, SPEED, dt)
    c.glow = damp(c.glow, hoveredRef.current ? 0.22 : 0, 8, dt)

    const [bobL, bobR] = typingBob(t, 6, 0.06, bob.current)

    if (body.current) {
      body.current.rotation.y = c.bodyYaw
      body.current.rotation.x = c.lean
      body.current.scale.y = 1 + Math.sin(t * 2.4) * 0.02 * c.breathe
    }
    if (head.current) {
      head.current.rotation.y = c.headYaw
      head.current.rotation.x = c.headPitch
      head.current.rotation.z = c.headRoll
    }
    if (armL.current) {
      armL.current.rotation.x = -(c.lPitch + bobL * c.typing)
      armL.current.rotation.z = -c.lYaw
    }
    if (armR.current) {
      armR.current.rotation.x = -(c.rPitch + bobR * c.typing)
      armR.current.rotation.z = c.rYaw
    }
    if (foreL.current) foreL.current.rotation.x = -c.lBend
    if (foreR.current) {
      foreR.current.rotation.x = -c.rBend
      foreR.current.rotation.z = waveAngle(t) * c.wave
    }

    if (t >= blink.current.nextAt) {
      blink.current.start = t
      blink.current.nextAt = t + 3 + Math.random() * 2
    }
    const sinceBlink = t - blink.current.start
    const closed = sinceBlink < BLINK_SECONDS ? Math.sin((Math.PI * sinceBlink) / BLINK_SECONDS) : 0
    const eyeScale = Math.max(0.08, 1 - closed)
    if (eyeL.current) eyeL.current.scale.y = eyeScale
    if (eyeR.current) eyeR.current.scale.y = eyeScale

    if (mouthSmile.current) mouthSmile.current.visible = target.mouth === 'smile'
    if (mouthNeutral.current) mouthNeutral.current.visible = target.mouth === 'neutral'
    if (mouthFrown.current) mouthFrown.current.visible = target.mouth === 'frown'

    if (tipMat.current) tipMat.current.emissive.lerp(tipTarget.current, 1 - Math.exp(-6 * dt))
    if (bodyMat.current) bodyMat.current.emissiveIntensity = c.glow
  })

  return (
    <group scale={CHARACTER_SCALE}>
      <mesh position={[0, 0.015, 0]} receiveShadow>
        <cylinderGeometry args={[0.2, 0.24, 0.03, 20]} />
        <meshStandardMaterial color="#2a3042" roughness={0.9} />
      </mesh>
      <mesh position={[0, 0.2, 0]}>
        <cylinderGeometry args={[0.035, 0.035, 0.36, 10]} />
        <meshStandardMaterial color="#3a4258" metalness={0.4} roughness={0.5} />
      </mesh>
      <mesh position={[0, 0.4, 0]} castShadow>
        <cylinderGeometry args={[0.26, 0.26, 0.07, 24]} />
        <meshStandardMaterial color="#2f3548" roughness={0.9} />
      </mesh>

      <group ref={body} position={[0, 0.42, 0]}>
        <mesh castShadow position={[0, 0.36, 0]}>
          <capsuleGeometry args={[0.27, 0.4, 6, 20]} />
          <meshStandardMaterial ref={bodyMat} color={color} emissive={color} emissiveIntensity={0} roughness={0.65} />
        </mesh>
        <mesh position={[-0.13, 0.04, 0.24]} rotation={[Math.PI / 2, 0, 0]}>
          <capsuleGeometry args={[0.085, 0.3, 4, 12]} />
          <meshStandardMaterial color={legColor} roughness={0.8} />
        </mesh>
        <mesh position={[0.13, 0.04, 0.24]} rotation={[Math.PI / 2, 0, 0]}>
          <capsuleGeometry args={[0.085, 0.3, 4, 12]} />
          <meshStandardMaterial color={legColor} roughness={0.8} />
        </mesh>

        <group ref={head} position={[0, 0.98, 0]}>
          <mesh castShadow>
            <sphereGeometry args={[0.31, 28, 20]} />
            <meshStandardMaterial color={headColor} roughness={0.55} />
          </mesh>
          <mesh ref={eyeL} position={[-0.11, 0.03, 0.27]}>
            <sphereGeometry args={[0.045, 12, 10]} />
            <meshStandardMaterial color="#141821" roughness={0.3} />
          </mesh>
          <mesh ref={eyeR} position={[0.11, 0.03, 0.27]}>
            <sphereGeometry args={[0.045, 12, 10]} />
            <meshStandardMaterial color="#141821" roughness={0.3} />
          </mesh>
          <mesh ref={mouthSmile} position={[0, -0.08, 0.28]} rotation={[0, 0, Math.PI]}>
            <torusGeometry args={[0.075, 0.014, 6, 14, Math.PI]} />
            <meshStandardMaterial color="#141821" />
          </mesh>
          <mesh ref={mouthFrown} position={[0, -0.14, 0.28]}>
            <torusGeometry args={[0.07, 0.014, 6, 14, Math.PI]} />
            <meshStandardMaterial color="#141821" />
          </mesh>
          <mesh ref={mouthNeutral} position={[0, -0.1, 0.29]}>
            <boxGeometry args={[0.1, 0.02, 0.02]} />
            <meshStandardMaterial color="#141821" />
          </mesh>

          <mesh position={[0, 0.04, 0]}>
            <torusGeometry args={[0.33, 0.028, 8, 28, Math.PI]} />
            <meshStandardMaterial color="#1b2030" roughness={0.6} />
          </mesh>
          <mesh position={[-0.32, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
            <cylinderGeometry args={[0.1, 0.1, 0.07, 16]} />
            <meshStandardMaterial color="#1b2030" roughness={0.6} />
          </mesh>
          <mesh position={[0.32, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
            <cylinderGeometry args={[0.1, 0.1, 0.07, 16]} />
            <meshStandardMaterial color="#1b2030" roughness={0.6} />
          </mesh>

          <mesh position={[0.1, 0.43, 0]} rotation={[0, 0, -0.25]}>
            <cylinderGeometry args={[0.012, 0.012, 0.24, 8]} />
            <meshStandardMaterial color="#3a4258" metalness={0.5} roughness={0.4} />
          </mesh>
          <mesh position={[0.13, 0.56, 0]}>
            <sphereGeometry args={[0.045, 12, 10]} />
            <meshStandardMaterial ref={tipMat} color="#111319" emissive={initialAccent} emissiveIntensity={2.2} toneMapped={false} />
          </mesh>
        </group>

        <group ref={armL} position={[-0.31, 0.66, 0]}>
          <mesh castShadow position={[0, -0.15, 0]}>
            <capsuleGeometry args={[0.075, 0.2, 4, 12]} />
            <meshStandardMaterial color={color} roughness={0.65} />
          </mesh>
          <group ref={foreL} position={[0, -0.3, 0]}>
            <mesh position={[0, -0.12, 0]}>
              <capsuleGeometry args={[0.065, 0.17, 4, 12]} />
              <meshStandardMaterial color={color} roughness={0.65} />
            </mesh>
            <mesh position={[0, -0.27, 0]}>
              <sphereGeometry args={[0.08, 12, 10]} />
              <meshStandardMaterial color={headColor} roughness={0.55} />
            </mesh>
          </group>
        </group>
        <group ref={armR} position={[0.31, 0.66, 0]}>
          <mesh castShadow position={[0, -0.15, 0]}>
            <capsuleGeometry args={[0.075, 0.2, 4, 12]} />
            <meshStandardMaterial color={color} roughness={0.65} />
          </mesh>
          <group ref={foreR} position={[0, -0.3, 0]}>
            <mesh position={[0, -0.12, 0]}>
              <capsuleGeometry args={[0.065, 0.17, 4, 12]} />
              <meshStandardMaterial color={color} roughness={0.65} />
            </mesh>
            <mesh position={[0, -0.27, 0]}>
              <sphereGeometry args={[0.08, 12, 10]} />
              <meshStandardMaterial color={headColor} roughness={0.55} />
            </mesh>
          </group>
        </group>
      </group>
    </group>
  )
}
