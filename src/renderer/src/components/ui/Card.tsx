import type { HTMLAttributes } from 'react'
import { cn } from '@/lib/cn'

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  padded?: boolean
  raised?: boolean
}

export function Card({ padded = true, raised, className, ...rest }: CardProps) {
  return <div className={cn('rounded-lg border border-line', raised ? 'bg-raised' : 'bg-surface', padded && 'p-3', className)} {...rest} />
}
