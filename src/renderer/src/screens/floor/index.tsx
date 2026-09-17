import { Component, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Canvas } from '@react-three/fiber'
import { CAMERA_POSITION, CAMERA_ZOOM } from './layout'
import { FloorScene } from './Scene'
import { FloorHud } from './Hud'
import { FallbackFloor } from './FallbackFloor'
import { hasWebGL } from './webgl'

class CanvasBoundary extends Component<{ children: ReactNode; onError: (error: Error) => void }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true }
  }

  componentDidCatch(error: Error): void {
    this.props.onError(error)
  }

  render(): ReactNode {
    return this.state.failed ? null : this.props.children
  }
}

function useDocumentVisible(): boolean {
  const [visible, setVisible] = useState(() => typeof document === 'undefined' || !document.hidden)
  useEffect(() => {
    const onChange = () => setVisible(!document.hidden)
    document.addEventListener('visibilitychange', onChange)
    return () => document.removeEventListener('visibilitychange', onChange)
  }, [])
  return visible
}

const VIGNETTE = 'radial-gradient(ellipse at 50% 45%, rgba(11,13,18,0) 45%, rgba(11,13,18,0.55) 100%)'

export function FloorScreen() {
  const webgl = useMemo(() => hasWebGL(), [])
  const visible = useDocumentVisible()
  const [failure, setFailure] = useState<string | null>(null)

  if (!webgl) return <FallbackFloor reason="3D floor unavailable: WebGL is off in this window" />
  if (failure) return <FallbackFloor reason={`3D floor unavailable: ${failure}`} />

  return (
    <div className="relative h-full w-full overflow-hidden bg-bg" data-floor="3d">
      <CanvasBoundary onError={(e) => setFailure(e.message || 'the scene failed to render')}>
        <Canvas
          shadows
          dpr={[1, 2]}
          orthographic
          camera={{ position: CAMERA_POSITION, zoom: CAMERA_ZOOM, near: 0.1, far: 100 }}
          gl={{ antialias: true, preserveDrawingBuffer: true, powerPreference: 'high-performance' }}
          frameloop={visible ? 'always' : 'never'}
          style={{ position: 'absolute', inset: 0 }}
          onCreated={({ gl }) => {
            gl.domElement.addEventListener('webglcontextlost', (e) => {
              e.preventDefault()
              setFailure('the GPU context was lost')
            })
          }}
        >
          <FloorScene />
        </Canvas>
      </CanvasBoundary>
      <div className="pointer-events-none absolute inset-0 z-[5]" style={{ background: VIGNETTE }} />
      <FloorHud variant="overlay" />
    </div>
  )
}
