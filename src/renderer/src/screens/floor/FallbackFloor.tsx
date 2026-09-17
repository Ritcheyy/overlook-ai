import { FloorHud } from './Hud'

/** DOM-only floor used when WebGL is missing or the canvas threw. */
export function FallbackFloor({ reason }: { reason: string }) {
  return (
    <div className="relative h-full w-full overflow-auto bg-bg" data-floor="fallback">
      <div className="absolute right-4 top-14 z-10 rounded-md border border-line/60 bg-surface/80 px-2 py-1 font-mono text-[10px] text-faint">{reason}</div>
      <FloorHud variant="static" />
    </div>
  )
}
