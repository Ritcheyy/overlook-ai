let cached: boolean | undefined

/** Probe once with a throwaway canvas; Electron with GPU disabled returns null contexts. */
export function hasWebGL(): boolean {
  if (cached !== undefined) return cached
  try {
    if (typeof document === 'undefined') return (cached = false)
    const canvas = document.createElement('canvas')
    const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl')
    cached = !!gl
    const ext = gl?.getExtension('WEBGL_lose_context')
    ext?.loseContext()
  } catch {
    cached = false
  }
  return cached
}
