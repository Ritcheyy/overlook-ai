// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ScreenPainter } from './screen-painter'

/** jsdom has no 2D canvas; this records the calls the painter makes. */
function fakeContext() {
  const calls: string[] = []
  const record = (name: string) => () => void calls.push(name)
  const ctx = {
    calls,
    fillStyle: '',
    strokeStyle: '',
    globalAlpha: 1,
    lineWidth: 1,
    font: '',
    textAlign: 'left',
    fillRect: record('fillRect'),
    fillText: record('fillText'),
    beginPath: record('beginPath'),
    arc: record('arc'),
    moveTo: record('moveTo'),
    lineTo: record('lineTo'),
    stroke: record('stroke')
  }
  return ctx
}

function mockContext(ctx: ReturnType<typeof fakeContext> | null) {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as unknown as CanvasRenderingContext2D)
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('ScreenPainter', () => {
  it('constructs without a 2D context and paints every mode without throwing', () => {
    mockContext(null)
    const painter = new ScreenPainter(64, 40, () => 0.5)
    for (const mode of ['off', 'loading', 'code', 'alert', 'sending', 'flash'] as const) {
      expect(() => painter.paint(mode, '#7c8aff', 0.5)).not.toThrow()
    }
    painter.dispose()
  })

  it('actually draws something for every mode', () => {
    const ctx = fakeContext()
    mockContext(ctx)
    const painter = new ScreenPainter(64, 40, () => 0.5)
    expect(ctx.calls.length).toBeGreaterThan(0)
    for (const mode of ['loading', 'code', 'alert', 'sending', 'flash', 'off'] as const) {
      ctx.calls.length = 0
      painter.paint(mode, '#7c8aff', 0.5)
      expect(ctx.calls.length, mode).toBeGreaterThan(0)
    }
    painter.paint('loading', '#7c8aff', 0.5)
    ctx.calls.length = 0
    painter.paint('loading', '#7c8aff', 0.5)
    expect(ctx.calls).toEqual([])
    painter.dispose()
  })

  it('repaints code when a whole line is recycled even if the sub-line offset repeats', () => {
    const ctx = fakeContext()
    mockContext(ctx)
    const painter = new ScreenPainter(64, 40, () => 0.5)
    painter.paint('code', '#7c8aff', 0)
    const before = painter.texture.version
    painter.advance(1)
    painter.paint('code', '#7c8aff', 0)
    expect(painter.texture.version).toBeGreaterThan(before)
    painter.dispose()
  })

  it('advances the scroll and recycles lines only on whole-line steps', () => {
    mockContext(null)
    let calls = 0
    const painter = new ScreenPainter(64, 40, () => {
      calls++
      return 0.3
    })
    const initial = calls
    painter.advance(0.4)
    expect(calls).toBe(initial)
    painter.advance(0.7)
    expect(calls).toBe(initial + 3)
    painter.advance(-1)
    expect(calls).toBe(initial + 3)
    painter.dispose()
  })

  it('marks the texture for upload only when the frame changes', () => {
    mockContext(null)
    const painter = new ScreenPainter(64, 40, () => 0.5)
    painter.texture.needsUpdate = false
    painter.paint('alert', '#f5b544', 0)
    const afterFirst = painter.texture.version
    painter.paint('alert', '#f5b544', 0)
    expect(painter.texture.version).toBe(afterFirst)
    painter.paint('flash', '#f4728c', 1)
    expect(painter.texture.version).toBeGreaterThan(afterFirst)
    painter.dispose()
  })
})
