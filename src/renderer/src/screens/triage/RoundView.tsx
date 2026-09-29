import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { ChevronRight, ExternalLink, MessageSquareReply, Undo2 } from 'lucide-react'
import type { DropReason, Finding, FindingDecision, Mission, ReviewRound, RoundTrigger, Settings } from '@core/domain'
import { SEVERITY_ORDER, shortSha } from '@core/domain'
import { postedFindings } from '@core/comment-builder'
import { api } from '@/lib/api'
import { EDITOR_LABELS, editorFileUrl, githubBlobUrl, relatedPrUrl } from '@/lib/links'
import { formatClock, plural, relativeTime } from '@/lib/format'
import { selectInbox, selectMissions, useAppStore } from '@/state/store'
import { BriefingCard } from '@/components/app/BriefingCard'
import { VerdictLabel } from '@/components/app/PrMarkers'
import { RoundDetails } from '@/components/app/RoundDetails'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Chip } from '@/components/ui/Chip'
import { EmptyState } from '@/components/ui/EmptyState'
import { Markdown } from '@/components/ui/Markdown'
import { Textarea } from '@/components/ui/Textarea'
import { FindingRow, type DecisionPatch, type FileLinks } from './FindingRow'
import { useMissionActions } from './useMissionActions'

export function sortFindings(findings: Finding[]): Finding[] {
  return [...findings].sort((a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity))
}

export function SectionLabel({ children }: { children: string }) {
  return <div className="text-[10.5px] font-semibold uppercase tracking-wider text-faint">{children}</div>
}

const TRIGGER_TEXT: Record<RoundTrigger, string> = {
  dispatch: 'first review',
  rerun: 're-run by you',
  retry: 'retry',
  reply: "started by the author's reply"
}

function SummaryCard({ mission, round, editable }: { mission: Mission; round: ReviewRound; editable: boolean }) {
  const actions = useMissionActions()
  const ref = useRef<HTMLTextAreaElement>(null)
  const [draft, setDraft] = useState(round.summary)
  useEffect(() => setDraft(round.summary), [round.summary])
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight + el.offsetHeight - el.clientHeight}px`
  }, [draft, editable])
  const edited = round.originalSummary !== undefined && round.originalSummary !== round.summary
  const commit = () => {
    if (draft !== round.summary) void actions.setSummary(mission.id, round.id, draft)
  }
  return (
    <Card className="flex flex-col gap-2" aria-label="Summary">
      <div className="flex items-center gap-2">
        <SectionLabel>Summary</SectionLabel>
        <VerdictLabel verdict={round.verdict} title="The reviewer's verdict" />
        {edited && <Chip tone="amber">edited</Chip>}
        <div className="flex-1" />
        {edited && editable && (
          <Button size="sm" variant="ghost" icon={<Undo2 className="h-3.5 w-3.5" />} onClick={() => void actions.setSummary(mission.id, round.id, round.originalSummary!)}>
            Restore original
          </Button>
        )}
      </div>
      {editable ? (
        <>
          <Textarea
            ref={ref}
            aria-label="Summary"
            rows={1}
            className="min-h-0 resize-none overflow-hidden text-ink/90"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setDraft(round.summary)
            }}
          />
          <p className="text-[11.5px] leading-snug text-faint">This heads the posted comment. Edit it when you drop a finding the summary still asserts.</p>
        </>
      ) : (
        <p className="text-[13px] leading-relaxed text-ink/90">{round.summary || 'No summary was returned.'}</p>
      )}
    </Card>
  )
}

function RepliesCard({ round }: { round: ReviewRound }) {
  const replies = round.replies ?? []
  if (replies.length === 0) return null
  return (
    <details className="group rounded-lg border border-teal/25 bg-teal/5" open>
      <summary className="flex cursor-pointer select-none list-none items-center gap-2 px-3 py-2 text-[12.5px] text-teal [&::-webkit-details-marker]:hidden">
        <ChevronRight className="h-3.5 w-3.5 transition-transform group-open:rotate-90" aria-hidden />
        <MessageSquareReply className="h-3.5 w-3.5" aria-hidden />
        <span className="font-medium">{replies[0].author}'s reply</span>
        <span className="text-teal/70">that this round checked</span>
      </summary>
      <div className="flex flex-col gap-3 border-t border-teal/20 px-3.5 py-3">
        {replies.map((r) => (
          <div key={r.url} className="flex flex-col gap-1">
            <div className="flex items-center gap-2 text-[11.5px] text-faint">
              <span title={r.createdAt}>{formatClock(r.createdAt)}</span>
              <button type="button" className="inline-flex items-center gap-1 hover:text-accent" onClick={() => void api.openExternal(r.url)}>
                <ExternalLink className="h-3 w-3" aria-hidden />
                View on GitHub
              </button>
            </div>
            <Markdown className="text-[12.5px]">{r.body}</Markdown>
          </div>
        ))}
      </div>
    </details>
  )
}

function PostedComment({ round, now }: { round: ReviewRound; now: number }) {
  if (!round.postedBody && !round.postedCommentUrl) return null
  return (
    <details className="group rounded-lg border border-line bg-surface">
      <summary className="flex cursor-pointer select-none list-none items-center gap-2 px-3 py-2 text-[12.5px] text-muted hover:text-ink [&::-webkit-details-marker]:hidden">
        <ChevronRight className="h-3.5 w-3.5 transition-transform group-open:rotate-90" aria-hidden />
        <span className="font-medium text-ink">Posted comment</span>
        {round.postedAt && <span title={round.postedAt}>{relativeTime(round.postedAt, now)}</span>}
        <div className="flex-1" />
        {round.postedCommentUrl && (
          <span
            role="button"
            tabIndex={0}
            className="inline-flex items-center gap-1 text-[12px] hover:text-accent"
            onClick={(e) => {
              e.preventDefault()
              void api.openExternal(round.postedCommentUrl!)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void api.openExternal(round.postedCommentUrl!)
            }}
          >
            <ExternalLink className="h-3.5 w-3.5" aria-hidden />
            View on GitHub
          </span>
        )}
      </summary>
      {round.postedBody && (
        <div className="border-t border-line px-3.5 py-3">
          <Markdown>{round.postedBody}</Markdown>
        </div>
      )}
    </details>
  )
}

export interface RoundViewProps {
  mission: Mission
  round: ReviewRound
  settings: Settings
  /** The round waits for decisions; findings get Approve/Drop and the summary is editable. */
  triage: boolean
  readOnly?: boolean
  now: number
}

/** Everything one round produced: what it was given, what it found, and what reached the PR. */
export function RoundView({ mission, round, settings, triage, readOnly, now }: RoundViewProps) {
  const pushToast = useAppStore((s) => s.pushToast)
  const openDetails = useAppStore((s) => s.openDetails)
  const inbox = useAppStore(selectInbox)
  const missions = useAppStore(selectMissions)
  // A PR the app knows opens its details here; any other goes to GitHub.
  const openRelated = (ref: string) => {
    if (inbox.some((p) => p.id === ref) || missions.some((m) => m.prId === ref)) openDetails({ prId: ref })
    else void api.openExternal(relatedPrUrl(ref))
  }
  const findings = useMemo(() => (triage ? sortFindings(round.findings) : [...postedFindings(round), ...sortFindings(round.findings.filter((f) => f.decision !== 'approved'))]), [round, triage])
  const numbers = useMemo(() => new Map(postedFindings(round).map((f, i) => [f.id, i + 1])), [round])
  const [open, setOpen] = useState<Set<string>>(() => new Set())
  useEffect(() => setOpen(new Set()), [round.id])
  const allOpen = findings.length > 0 && findings.every((f) => open.has(f.id))
  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const fail = (title: string) => (e: Error) => pushToast({ kind: 'error', title, body: e.message })
  const decide = (finding: Finding, patch: DecisionPatch) =>
    api.setFindingDecision({ missionId: mission.id, roundId: round.id, findingId: finding.id, ...patch }).catch(fail('Could not save the decision'))
  const bulk = (decision: FindingDecision, findingIds?: string[], dropReason?: DropReason) =>
    api.setFindingDecisions({ missionId: mission.id, roundId: round.id, decision, findingIds, dropReason }).catch(fail('Could not apply the decision'))

  const blockersAndMajors = findings.filter((f) => f.severity === 'blocker' || f.severity === 'major')
  const pendingNits = findings.filter((f) => f.severity === 'nit' && f.decision === 'pending')
  const canEditSummary = triage && !readOnly && !round.postedAt
  const linksFor = (f: Finding): FileLinks | undefined =>
    f.file
      ? {
          editor: editorFileUrl(settings.fileLinks, mission.worktreePath, f.file, f.line),
          editorLabel: EDITOR_LABELS[settings.fileLinks],
          github: githubBlobUrl(mission, round, f.file, f.line)
        }
      : undefined

  return (
    <div className="flex flex-col gap-4" data-round={round.index}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-faint">
        <span className="font-medium text-muted">Round {round.index}</span>
        {round.trigger && (
          <>
            <span aria-hidden>·</span>
            <span>{TRIGGER_TEXT[round.trigger]}</span>
          </>
        )}
        <span aria-hidden>·</span>
        <span className="font-mono" title={round.headSha}>
          {round.previousHeadSha ? `${shortSha(round.previousHeadSha)}..${shortSha(round.headSha)}` : shortSha(round.headSha)}
        </span>
        <span aria-hidden>·</span>
        <span title={round.startedAt}>started {relativeTime(round.startedAt, now)}</span>
      </div>
      <RepliesCard round={round} />
      <BriefingCard round={round} title={round.previousHeadSha ? 'What changed' : undefined} />
      <SummaryCard mission={mission} round={round} editable={canEditSummary} />

      <section aria-label="Findings" className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[12px] text-muted">{plural(findings.length, 'finding')}</span>
          {findings.length > 0 && (
            <Button size="sm" variant="ghost" onClick={() => setOpen(allOpen ? new Set() : new Set(findings.map((f) => f.id)))}>
              {allOpen ? 'Collapse all' : 'Expand all'}
            </Button>
          )}
          <div className="flex-1" />
          {triage && (
            <>
              <Button size="sm" variant="ghost" disabled={readOnly || findings.length === 0} onClick={() => void bulk('approved')}>
                Approve all
              </Button>
              <Button size="sm" variant="ghost" disabled={readOnly || blockersAndMajors.length === 0} onClick={() => void bulk('approved', blockersAndMajors.map((f) => f.id))}>
                Approve blockers & majors
              </Button>
              <Button size="sm" variant="ghost" disabled={readOnly || pendingNits.length === 0} onClick={() => void bulk('dropped', pendingNits.map((f) => f.id), 'not_worth_it')}>
                Drop remaining nits
              </Button>
            </>
          )}
        </div>
        {findings.length === 0 ? (
          <EmptyState compact title="No findings" description={triage ? 'The reviewer had nothing to report. Posting sends the summary only.' : 'The reviewer had nothing to report.'} />
        ) : (
          <ol className="flex flex-col gap-1.5" aria-label="Findings">
            {findings.map((f) => (
              <FindingRow
                key={f.id}
                finding={f}
                number={triage ? undefined : numbers.get(f.id)}
                triage={triage}
                readOnly={readOnly}
                expanded={open.has(f.id)}
                onToggle={() => toggle(f.id)}
                links={linksFor(f)}
                onDecision={(patch) => void decide(f, patch)}
                onOpenRelated={openRelated}
              />
            ))}
          </ol>
        )}
      </section>

      <PostedComment round={round} now={now} />
      <RoundDetails round={round} />
    </div>
  )
}
