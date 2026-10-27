import { Route } from 'lucide-react'
import type { ReviewRound } from '@core/domain'
import { cn } from '@/lib/cn'
import { Card } from '@/components/ui/Card'
import { Markdown } from '@/components/ui/Markdown'

export interface BriefingCardProps {
  round: ReviewRound | undefined
  /** Follow-up rounds brief the delta, so they read "What changed". */
  title?: string
  className?: string
}

/** The reviewer's plain-language explanation of the PR, headed by its verdict on the approach. Renders nothing when the round has neither. */
export function BriefingCard({ round, title = 'What this PR does', className }: BriefingCardProps) {
  const briefing = round?.briefing?.trim()
  const approach = round?.approach
  if (!briefing && !approach) return null
  return (
    <Card className={className} data-testid="briefing" aria-label={title}>
      <div className="flex items-baseline gap-2">
        <span className="text-[10.5px] font-semibold uppercase tracking-wider text-faint">{title}</span>
        <span className="text-[11px] text-faint">for you, not posted</span>
      </div>
      {approach && (
        <div className={cn('mt-2 flex items-start gap-1.5 text-[12.5px]', approach.verdict === 'sound' ? 'text-muted' : 'text-amber')} data-approach={approach.verdict}>
          <Route className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          <span>
            <span className="font-medium text-ink">Approach: {approach.verdict === 'sound' ? 'sound' : 'alternative proposed'}.</span> {approach.note}
          </span>
        </div>
      )}
      {briefing && <Markdown className="mt-2 leading-relaxed">{briefing}</Markdown>}
    </Card>
  )
}
