import type { ReviewRound } from '@core/domain'
import { Card } from '@/components/ui/Card'
import { Markdown } from '@/components/ui/Markdown'

export interface BriefingCardProps {
  round: ReviewRound | undefined
  /** Follow-up rounds brief the delta, so they read "What changed". */
  title?: string
  className?: string
}

/** The reviewer's plain-language explanation of the PR. Renders nothing when the round has none. */
export function BriefingCard({ round, title = 'What this PR does', className }: BriefingCardProps) {
  const briefing = round?.briefing?.trim()
  if (!briefing) return null
  return (
    <Card className={className} data-testid="briefing" aria-label={title}>
      <div className="flex items-baseline gap-2">
        <span className="text-[10.5px] font-semibold uppercase tracking-wider text-faint">{title}</span>
        <span className="text-[11px] text-faint">for you, not posted</span>
      </div>
      <Markdown className="mt-2 leading-relaxed">{briefing}</Markdown>
    </Card>
  )
}
