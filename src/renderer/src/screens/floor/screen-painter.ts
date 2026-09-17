import * as THREE from 'three'
import type { ScreenMode } from './animation'
import { TOKENS } from './animation'

interface CodeLine {
  indent: number
  width: number
  tone: number
}

const LINE_H = 9
const LINE_COUNT = 16
const TONES = [TOKENS.accent, TOKENS.teal, TOKENS.ink, TOKENS.muted, TOKENS.amber]

/**
 * Paints a monitor screen into a canvas texture. Repaints only when what it
 * would draw actually changes, so idle screens cost nothing per frame.
 */
export class ScreenPainter {
  readonly texture: THREE.CanvasTexture
  private readonly canvas: HTMLCanvasElement
  private readonly ctx: CanvasRenderingContext2D | null
  private readonly lines: CodeLine[] = []
  private scroll = 0
  private generation = 0
  private lastMode: ScreenMode | '' = ''
  private lastColor = ''
  private lastStep = -1
  private lastGeneration = -1

  constructor(
    private readonly width = 192,
    private readonly height = 124,
    private readonly random: () => number = Math.random
  ) {
    this.canvas = document.createElement('canvas')
    this.canvas.width = width
    this.canvas.height = height
    this.ctx = this.canvas.getContext('2d')
    for (let i = 0; i < LINE_COUNT + 2; i++) this.lines.push(this.makeLine({ indent: 0, width: 0, tone: 0 }))
    this.texture = new THREE.CanvasTexture(this.canvas)
    this.texture.colorSpace = THREE.SRGBColorSpace
    this.texture.minFilter = THREE.LinearFilter
    this.texture.generateMipmaps = false
    this.paintOff()
  }

  dispose(): void {
    this.texture.dispose()
  }

  private makeLine(line: CodeLine): CodeLine {
    const r = this.random()
    line.indent = r < 0.25 ? 0 : r < 0.6 ? 1 : r < 0.9 ? 2 : 3
    line.width = 0.2 + this.random() * 0.65
    line.tone = Math.floor(this.random() * TONES.length)
    return line
  }

  /** Advances the code scroll by `lines` lines, recycling lines that left the top. */
  advance(lines: number): void {
    if (lines <= 0) return
    this.scroll += lines
    while (this.scroll >= 1) {
      this.scroll -= 1
      this.generation++
      const first = this.lines.shift()
      if (first) this.lines.push(this.makeLine(first))
    }
  }

  paint(mode: ScreenMode, color: string, level: number): void {
    const step = mode === 'code' ? Math.floor(this.scroll * LINE_H) : Math.round(level * 40)
    const generation = mode === 'code' ? this.generation : 0
    if (mode === this.lastMode && color === this.lastColor && step === this.lastStep && generation === this.lastGeneration) return
    this.lastMode = mode
    this.lastColor = color
    this.lastStep = step
    this.lastGeneration = generation
    switch (mode) {
      case 'off':
        this.paintOff()
        break
      case 'code':
        this.paintCode()
        break
      case 'loading':
      case 'sending':
        this.paintBar(color, level, mode === 'sending' ? 'sending' : 'checking out')
        break
      case 'alert':
        this.paintAlert(color)
        break
      case 'flash':
        this.paintFlash(color, level)
        break
    }
    this.texture.needsUpdate = true
  }

  private paintOff(): void {
    const ctx = this.ctx
    if (!ctx) return
    ctx.fillStyle = '#12151d'
    ctx.fillRect(0, 0, this.width, this.height)
    ctx.fillStyle = 'rgba(255,255,255,0.03)'
    ctx.fillRect(8, 8, this.width - 16, this.height - 16)
  }

  private paintBase(): void {
    const ctx = this.ctx
    if (!ctx) return
    ctx.fillStyle = '#0e1118'
    ctx.fillRect(0, 0, this.width, this.height)
    ctx.fillStyle = '#161a24'
    ctx.fillRect(0, 0, this.width, 10)
    ctx.fillStyle = TOKENS.rose
    ctx.fillRect(5, 3, 4, 4)
    ctx.fillStyle = TOKENS.amber
    ctx.fillRect(12, 3, 4, 4)
    ctx.fillStyle = TOKENS.lime
    ctx.fillRect(19, 3, 4, 4)
  }

  private paintCode(): void {
    const ctx = this.ctx
    if (!ctx) return
    this.paintBase()
    const offset = this.scroll * LINE_H
    const usable = this.width - 20
    for (let i = 0; i < this.lines.length; i++) {
      const line = this.lines[i]
      const y = 14 + i * LINE_H - offset
      if (y < 10 || y > this.height) continue
      ctx.fillStyle = TONES[line.tone]
      ctx.globalAlpha = line.tone === 2 ? 0.9 : 0.75
      const x = 10 + line.indent * 9
      ctx.fillRect(x, y, Math.max(6, usable * line.width - line.indent * 9), 4)
    }
    ctx.globalAlpha = 1
    ctx.fillStyle = TOKENS.ink
    ctx.fillRect(10, this.height - 8, 5, 4)
  }

  private paintBar(color: string, level: number, caption: string): void {
    const ctx = this.ctx
    if (!ctx) return
    this.paintBase()
    const w = this.width - 40
    const y = this.height / 2 - 4
    ctx.fillStyle = '#1b2030'
    ctx.fillRect(20, y, w, 8)
    ctx.fillStyle = color
    ctx.fillRect(20, y, Math.max(2, w * Math.min(1, Math.max(0, level))), 8)
    ctx.fillStyle = TOKENS.muted
    ctx.font = '9px monospace'
    ctx.textAlign = 'center'
    ctx.fillText(caption, this.width / 2, y + 22)
    ctx.textAlign = 'left'
  }

  private paintAlert(color: string): void {
    const ctx = this.ctx
    if (!ctx) return
    this.paintBase()
    ctx.fillStyle = color
    ctx.globalAlpha = 0.18
    ctx.fillRect(0, 10, this.width, this.height - 10)
    ctx.globalAlpha = 1
    const cx = this.width / 2
    const cy = this.height / 2 + 4
    ctx.strokeStyle = color
    ctx.lineWidth = 3
    ctx.beginPath()
    ctx.arc(cx, cy, 18, 0, Math.PI * 2)
    ctx.stroke()
    ctx.fillStyle = color
    ctx.fillRect(cx - 2, cy - 11, 4, 13)
    ctx.fillRect(cx - 2, cy + 5, 4, 4)
  }

  private paintFlash(color: string, level: number): void {
    const ctx = this.ctx
    if (!ctx) return
    if (level <= 0.02) {
      this.paintOff()
      return
    }
    ctx.fillStyle = '#12151d'
    ctx.fillRect(0, 0, this.width, this.height)
    ctx.fillStyle = color
    ctx.globalAlpha = Math.min(1, level)
    ctx.fillRect(0, 0, this.width, this.height)
    ctx.globalAlpha = 1
    ctx.fillStyle = '#12151d'
    const cx = this.width / 2
    const cy = this.height / 2
    ctx.lineWidth = 4
    ctx.strokeStyle = '#12151d'
    ctx.beginPath()
    ctx.moveTo(cx - 12, cy - 12)
    ctx.lineTo(cx + 12, cy + 12)
    ctx.moveTo(cx + 12, cy - 12)
    ctx.lineTo(cx - 12, cy + 12)
    ctx.stroke()
  }
}
