import { useState } from 'react'
import { ChevronRight } from 'lucide-react'
import type { ReviewRound } from '@core/domain'
import { cn } from '@/lib/cn'
import { formatCost, formatDuration } from '@/lib/format'

export interface RoundDetailsProps {
  round: ReviewRound
  className?: string
}

/** Cost, duration, model and the collapsed raw reviewer output for one round. Renders nothing when the round has none of them. */
export function RoundDetails({ round, className }: RoundDetailsProps) {
  const [open, setOpen] = useState(false)
  const parts: string[] = []
  if (round.costUsd !== undefined) parts.push(`Cost ${formatCost(round.costUsd)}`)
  if (round.durationMs !== undefined) parts.push(`took ${formatDuration(round.durationMs)}`)
  if (round.model) parts.push(round.effort ? `${round.model} (effort ${round.effort})` : round.model)
  else if (round.effort) parts.push(`effort ${round.effort}`)
  if (round.budgetUsd !== undefined) parts.push(`budget ${formatCost(round.budgetUsd)}`)
  if (parts.length === 0 && !round.rawOutput) return null
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      {parts.length > 0 && <div className="text-[11.5px] tabular-nums text-faint">{parts.join(' · ')}</div>}
      {round.rawOutput && (
        <details className="group rounded-md border border-line bg-bg/60" onToggle={(e) => setOpen(e.currentTarget.open)}>
          <summary className="flex cursor-pointer select-none list-none items-center gap-1 px-2 py-1 text-[11.5px] font-medium text-muted hover:text-ink [&::-webkit-details-marker]:hidden">
            <ChevronRight className="h-3.5 w-3.5 transition-transform group-open:rotate-90" aria-hidden />
            Raw reviewer output
          </summary>
          {open && (
            <pre className="max-h-[320px] overflow-auto whitespace-pre-wrap break-words border-t border-line px-2.5 py-2 font-mono text-[11.5px] leading-[1.6] text-muted">
              {round.rawOutput}
            </pre>
          )}
        </details>
      )}
    </div>
  )
}
