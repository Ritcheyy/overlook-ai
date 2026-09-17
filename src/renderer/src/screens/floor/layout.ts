/** World-space layout of the diorama. Everything sits on the platform top. */
export const PLATFORM_SIZE: [number, number, number] = [9, 0.5, 6]
export const PLATFORM_TOP = PLATFORM_SIZE[1] / 2

export const DESK_ROTATION = Math.PI / 6
export const DESK_X = [-2.2, 2.2] as const
export const DESK_Z = 0.35
export const DESK_HEIGHT = 0.62
export const DESK_SIZE: [number, number, number] = [1.9, 0.06, 0.95]

/** Where the character sits, in desk space. */
export const SEAT_OFFSET: [number, number, number] = [-0.2, 0, -0.78]
/** Where the monitor stands, in desk space. */
export const MONITOR_OFFSET: [number, number, number] = [0.38, DESK_HEIGHT, -0.12]
export const MONITOR_YAW_WORLD = -0.55
export const SCREEN_SIZE: [number, number] = [0.72, 0.46]

export const CHARACTER_SCALE = 0.83
/** Height of the speech bubble above the seat, in desk space; clears the antenna at any character scale. */
export const BUBBLE_HEIGHT = 2.25 * CHARACTER_SCALE

export const WALL_Z = -2.7
export const WALL_HEIGHT = 2.6
export const WALL_WIDTH = PLATFORM_SIZE[0] - 0.4
export const WINDOW_POS: [number, number, number] = [-1.9, PLATFORM_TOP + 1.7, WALL_Z + 0.1]
export const CORKBOARD_POS: [number, number, number] = [2.0, PLATFORM_TOP + 1.55, WALL_Z + 0.1]
export const SHELF_POS: [number, number, number] = [0, PLATFORM_TOP, -2.15]

export const MAX_QUEUE_CARDS = 5
export const MAX_CORKBOARD_CARDS = 6

export const CAMERA_POSITION: [number, number, number] = [12, 12, 12]
export const CAMERA_ZOOM = 70
export const CAMERA_TARGET: [number, number, number] = [0, 0, 0]
/** The zoom may stretch this far either side of CAMERA_ZOOM to fit the canvas. */
export const CAMERA_ZOOM_RANGE: [number, number] = [0.5, 1.2]
/** Pixels kept between the diorama's outermost point and the canvas edge. */
export const VIEW_MARGIN = 18
/** Parallax range on mouse move, radians. */
export const PARALLAX = (2 * Math.PI) / 180

export function deskPosition(index: number): [number, number, number] {
  return [DESK_X[index] ?? 0, PLATFORM_TOP, DESK_Z]
}

type Vec3 = [number, number, number]

const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const normalize = (a: Vec3): Vec3 => {
  const l = Math.hypot(a[0], a[1], a[2])
  return [a[0] / l, a[1] / l, a[2] / l]
}

const VIEW_DIR = normalize([-CAMERA_POSITION[0], -CAMERA_POSITION[1], -CAMERA_POSITION[2]])
const SCREEN_RIGHT = normalize(cross(VIEW_DIR, [0, 1, 0]))
const SCREEN_UP = cross(SCREEN_RIGHT, VIEW_DIR)

/** Where a world point lands on screen without parallax: world units right of and above the camera target. */
export function projectToScreen(p: Vec3): [number, number] {
  const rel: Vec3 = [p[0] - CAMERA_TARGET[0], p[1] - CAMERA_TARGET[1], p[2] - CAMERA_TARGET[2]]
  return [dot(rel, SCREEN_RIGHT), dot(rel, SCREEN_UP)]
}

/** The diorama's outermost points: the wall's far top corner and the platform's side corner. */
const WALL_TOP_CORNER: Vec3 = [-WALL_WIDTH / 2, PLATFORM_TOP + WALL_HEIGHT, WALL_Z]
const PLATFORM_SIDE_CORNER: Vec3 = [PLATFORM_SIZE[0] / 2, -PLATFORM_TOP, -PLATFORM_SIZE[2] / 2]
export const VIEW_ABOVE = projectToScreen(WALL_TOP_CORNER)[1]
export const VIEW_HALF_WIDTH = projectToScreen(PLATFORM_SIDE_CORNER)[0]

/**
 * Largest zoom that keeps the wall top and the platform's sides inside a
 * canvas of this size. The platform's front corner is allowed to run under
 * the HUD cards, which is what centres the desks in the space above them.
 */
export function cameraZoom(width: number, height: number): number {
  const byHeight = (height / 2 - VIEW_MARGIN) / VIEW_ABOVE
  const byWidth = (width / 2 - VIEW_MARGIN) / VIEW_HALF_WIDTH
  const [min, max] = CAMERA_ZOOM_RANGE
  return Math.min(Math.max(Math.min(byHeight, byWidth), CAMERA_ZOOM * min), CAMERA_ZOOM * max)
}
