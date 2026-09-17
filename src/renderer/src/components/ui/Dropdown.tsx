import { useEffect, useLayoutEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '@/lib/cn'

export interface DropdownProps {
  open: boolean
  onClose: () => void
  anchorRef: RefObject<HTMLElement>
  align?: 'start' | 'end'
  width?: number
  className?: string
  children: ReactNode
}

const GAP = 4

/**
 * Portalled so it escapes scroll containers. Position is measured from the
 * anchor when opened and flips above it when there is no room below.
 */
export function Dropdown({ open, onClose, anchorRef, align = 'end', width = 260, className, children }: DropdownProps) {
  const menuRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)

  useLayoutEffect(() => {
    if (!open) return
    const anchor = anchorRef.current
    if (!anchor) return
    const r = anchor.getBoundingClientRect()
    const menuH = menuRef.current?.offsetHeight ?? 0
    const below = r.bottom + GAP + menuH <= window.innerHeight || r.top - GAP - menuH < 0
    const top = below ? r.bottom + GAP : r.top - GAP - menuH
    const left = align === 'end' ? Math.max(8, r.right - width) : Math.min(r.left, window.innerWidth - width - 8)
    setPos({ top, left })
  }, [open, anchorRef, align, width])

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node
      if (menuRef.current?.contains(t) || anchorRef.current?.contains(t)) return
      onClose()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
        anchorRef.current?.focus()
      }
    }
    const onScroll = (e: Event) => {
      if (menuRef.current?.contains(e.target as Node)) return
      onClose()
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    window.addEventListener('resize', onClose)
    document.addEventListener('scroll', onScroll, true)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', onClose)
      document.removeEventListener('scroll', onScroll, true)
    }
  }, [open, onClose, anchorRef])

  useEffect(() => {
    if (!open) return
    const first = menuRef.current?.querySelector<HTMLElement>('[role="menuitem"], button, input, [tabindex="0"]')
    first?.focus()
  }, [open, pos])

  if (!open) return null
  return createPortal(
    <div
      ref={menuRef}
      className={cn(
        'fixed z-50 rounded-lg border border-line bg-raised p-1 shadow-[0_8px_30px_rgba(0,0,0,0.45),0_0_0_1px_rgba(0,0,0,0.3)]',
        pos ? 'opacity-100' : 'opacity-0',
        className
      )}
      style={{ top: pos?.top ?? 0, left: pos?.left ?? 0, width }}
    >
      {children}
    </div>,
    document.body
  )
}

export interface MenuItemProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon?: ReactNode
  hint?: ReactNode
  active?: boolean
  tone?: 'default' | 'danger'
}

export function MenuItem({ icon, hint, active, tone = 'default', className, children, ...rest }: MenuItemProps) {
  return (
    <button
      type="button"
      role="menuitem"
      className={cn(
        'flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left text-[12.5px] transition-colors focus:bg-surface focus:outline-none hover:bg-surface disabled:pointer-events-none disabled:opacity-40',
        tone === 'danger' ? 'text-rose' : 'text-ink',
        active && 'bg-surface',
        className
      )}
      {...rest}
    >
      {icon && <span className="mt-0.5 shrink-0 text-faint [&>svg]:h-3.5 [&>svg]:w-3.5">{icon}</span>}
      <span className="min-w-0 flex-1">{children}</span>
      {hint && <span className="shrink-0 text-[11px] text-faint">{hint}</span>}
    </button>
  )
}

export function MenuLabel({ children }: { children: ReactNode }) {
  return <div className="px-2 pb-1 pt-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-faint">{children}</div>
}

export function MenuSeparator() {
  return <div className="my-1 border-t border-line" />
}
