import type { ComponentProps } from 'react'
import { Html } from '@react-three/drei'

/**
 * drei's Html honours `pointerEvents` only in transform mode; otherwise its
 * wrappers take clicks meant for the mesh underneath, such as a card's own
 * number label. Both wrappers pass events through, so only children that ask
 * for them (pointer-events-auto) are clickable.
 */
export function FloorLabel({ style, ...props }: ComponentProps<typeof Html>) {
  return <Html wrapperClass="pointer-events-none" style={{ pointerEvents: 'none', ...style }} {...props} />
}
