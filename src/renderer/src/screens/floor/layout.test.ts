import { describe, expect, it } from 'vitest'
import {
  BUBBLE_HEIGHT,
  CAMERA_TARGET,
  CAMERA_ZOOM,
  CAMERA_ZOOM_RANGE,
  CHARACTER_SCALE,
  PLATFORM_TOP,
  VIEW_ABOVE,
  VIEW_HALF_WIDTH,
  VIEW_MARGIN,
  WALL_HEIGHT,
  cameraZoom,
  deskPosition,
  projectToScreen
} from './layout'

/** Canvas sizes for the 1440x900 default window and the 1024x640 minimum, less the 220px rail. */
const LARGE: [number, number] = [1220, 900]
const SMALL: [number, number] = [804, 640]

describe('projectToScreen', () => {
  it('puts the camera target at the origin and world-up on screen-up', () => {
    const [x, y] = projectToScreen(CAMERA_TARGET)
    expect(x).toBeCloseTo(0)
    expect(y).toBeCloseTo(0)
    const [ux, uy] = projectToScreen([CAMERA_TARGET[0], CAMERA_TARGET[1] + 1, CAMERA_TARGET[2]])
    expect(ux).toBeCloseTo(0)
    expect(uy).toBeGreaterThan(0)
  })

  it('measures the diorama from its wall top and platform side', () => {
    expect(VIEW_ABOVE).toBeGreaterThan(projectToScreen([0, PLATFORM_TOP + WALL_HEIGHT, 0])[1])
    expect(VIEW_HALF_WIDTH).toBeGreaterThan(0)
  })
})

describe('cameraZoom', () => {
  it.each([LARGE, SMALL])('keeps the wall top and platform sides inside a %ix%i canvas', (width, height) => {
    const zoom = cameraZoom(width, height)
    expect(height / 2 - zoom * VIEW_ABOVE).toBeGreaterThanOrEqual(VIEW_MARGIN - 1e-9)
    expect(width / 2 - zoom * VIEW_HALF_WIDTH).toBeGreaterThanOrEqual(VIEW_MARGIN - 1e-9)
  })

  it('stays within the range around the nominal zoom', () => {
    const [min, max] = CAMERA_ZOOM_RANGE
    expect(cameraZoom(200, 120)).toBeCloseTo(CAMERA_ZOOM * min)
    expect(cameraZoom(6000, 4000)).toBeCloseTo(CAMERA_ZOOM * max)
    expect(cameraZoom(...SMALL)).toBeLessThan(cameraZoom(...LARGE))
    expect(cameraZoom(...LARGE)).toBeLessThanOrEqual(CAMERA_ZOOM * max)
  })

  it.each([LARGE, SMALL])('centres the desks in the upper half of a %ix%i canvas, clear of the HUD cards', (width, height) => {
    const zoom = cameraZoom(width, height)
    const centre = height / 2
    const deskTops = [0, 1].map((i) => {
      const [x, y, z] = deskPosition(i)
      return centre - zoom * projectToScreen([x, y + 0.62, z])[1]
    })
    const midpoint = (deskTops[0] + deskTops[1]) / 2
    expect(midpoint).toBeGreaterThan(height * 0.3)
    expect(midpoint).toBeLessThan(height * 0.5)
    // The HUD cards take roughly the bottom 200px; the front desk must sit above them.
    expect(Math.max(...deskTops)).toBeLessThan(height - 200)
  })
})

describe('character proportions', () => {
  it('keeps the speech bubble above the antenna tip at the current scale', () => {
    const antennaTip = (0.42 + 0.98 + 0.56) * CHARACTER_SCALE
    expect(BUBBLE_HEIGHT).toBeGreaterThan(antennaTip + 0.15)
  })
})
