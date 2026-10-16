import type { RepoRef } from '@core/domain'
import { cn } from '@/lib/cn'

/** A stable hue per repository, so the same repo reads the same colour on every screen. */
export function repoHue(fullName: string): number {
  let hash = 0
  for (const c of fullName) hash = (hash * 31 + c.charCodeAt(0)) >>> 0
  return hash % 360
}

export function repoColor(fullName: string): string {
  return `hsl(${repoHue(fullName)} 65% 62%)`
}

export interface RepoBadgeProps {
  repo: RepoRef
  number: number
  /** Leave the repo name out where the surroundings already say it. */
  name?: boolean
  size?: 'xs' | 'sm'
  className?: string
}

/** The repository and PR number in the repo's own colour: what to recognise a PR by at a glance. */
export function RepoBadge({ repo, number, name = true, size = 'xs', className }: RepoBadgeProps) {
  const hue = repoHue(repo.fullName)
  return (
    <span
      className={cn('inline-flex max-w-full items-center gap-1 whitespace-nowrap rounded-md border px-1.5 font-medium', size === 'sm' ? 'h-6 text-[12.5px]' : 'h-5 text-[11px]', className)}
      style={{ color: `hsl(${hue} 70% 74%)`, background: `hsl(${hue} 60% 50% / 0.14)`, borderColor: `hsl(${hue} 60% 60% / 0.35)` }}
      title={`${repo.fullName}#${number}`}
    >
      {name && <span className="truncate">{repo.name}</span>}
      <span className="font-mono tabular-nums">#{number}</span>
    </span>
  )
}
