import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'

export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <kbd
      className={cn(
        'inline-flex h-[18px] min-w-[18px] items-center justify-center rounded border border-line bg-raised px-1 font-sans text-[10px] font-medium text-faint shadow-[0_1px_0_rgb(var(--bg))]',
        className
      )}
    >
      {children}
    </kbd>
  )
}
