import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Eye, EyeOff, GitCommitHorizontal, RotateCcw, Send, TriangleAlert, Undo2 } from 'lucide-react'
import type { DropReason, Finding, FindingDecision, Loadout, Mission, ReviewRound, Slot, Verdict } from '@core/domain'
import { SEVERITY_ORDER } from '@core/domain'
import { api } from '@/lib/api'
import { cn } from '@/lib/cn'
import { plural, shortSha } from '@/lib/format'
import { useAppStore } from '@/state/store'
import { BriefingCard } from '@/components/app/BriefingCard'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Chip, type Tone } from '@/components/ui/Chip'
import { ConfirmButton } from '@/components/ui/ConfirmButton'
import { EmptyState } from '@/components/ui/EmptyState'
import { Markdown } from '@/components/ui/Markdown'
import { RoundDetails } from '@/components/app/RoundDetails'
import { Textarea } from '@/components/ui/Textarea'
import { FindingCard, type DecisionPatch } from './FindingCard'
import { MissionHeader } from './MissionHeader'
import { RerunControl } from './RerunControl'
import { blobUrl } from './shared'
import { useMissionActions } from './useMissionActions'

const VERDICT: Record<Verdict, { label: string; tone: Tone }> = {
  approve: { label: 'Approve', tone: 'lime' },
  request_changes: { label: 'Request changes', tone: 'rose' },
  comment: { label: 'Comment', tone: 'accent' }
}

export function VerdictChip({ verdict }: { verdict: Verdict }) {
  const v = VERDICT[verdict]
  return (
    <Chip tone={v.tone} size="sm">
      {v.label}
    </Chip>
  )
}

export function sortFindings(findings: Finding[]): Finding[] {
  return [...findings].sort((a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity))
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
    <Card className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <span className="text-[10.5px] font-semibold uppercase tracking-wider text-faint">Summary</span>
        {edited && <Chip tone="amber">edited</Chip>}
        <div className="flex-1" />
        {edited && editable && (
          <Button
            size="sm"
            variant="ghost"
            icon={<Undo2 className="h-3.5 w-3.5" />}
            onClick={() => void actions.setSummary(mission.id, round.id, round.originalSummary!)}
          >
            Restore original
          </Button>
        )}
        <VerdictChip verdict={round.verdict} />
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

export interface ReviewPaneProps {
  mission: Mission
  round: ReviewRound
  slot?: Slot
  loadout?: Loadout
  /** True while the engine is posting; decisions are frozen. */
  readOnly?: boolean
}

export function ReviewPane({ mission, round, slot, loadout, readOnly }: ReviewPaneProps) {
  const pushToast = useAppStore((s) => s.pushToast)
  const actions = useMissionActions()
  const findings = useMemo(() => sortFindings(round.findings), [round.findings])
  const counts = useMemo(
    () => ({
      approved: findings.filter((f) => f.decision === 'approved').length,
      dropped: findings.filter((f) => f.decision === 'dropped').length,
      pending: findings.filter((f) => f.decision === 'pending').length
    }),
    [findings]
  )
  const [preview, setPreview] = useState(false)
  const [previewMd, setPreviewMd] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [posting, setPosting] = useState(false)
  const previewRef = useRef<HTMLDivElement>(null)
  const decisionKey = round.findings.map((f) => `${f.id}:${f.decision}:${f.dropReason ?? ''}:${f.dropNote ?? ''}`).join('|')

  useEffect(() => {
    if (!preview) return
    let cancelled = false
    api
      .previewComment(mission.id)
      .then((md) => {
        if (!cancelled) setPreviewMd(md)
      })
      .catch((e: Error) => {
        if (!cancelled) pushToast({ kind: 'error', title: 'Could not build the preview', body: e.message })
      })
    return () => {
      cancelled = true
    }
  }, [preview, decisionKey, round.summary, mission.id, pushToast])

  useEffect(() => {
    if (preview && previewMd !== null) previewRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [preview, previewMd])

  useEffect(() => setConfirming(false), [decisionKey, mission.id])

  const fail = (title: string) => (e: Error) => pushToast({ kind: 'error', title, body: e.message })

  const decide = (finding: Finding, patch: DecisionPatch) =>
    api.setFindingDecision({ missionId: mission.id, roundId: round.id, findingId: finding.id, ...patch }).catch(fail('Could not save the decision'))

  const bulk = (decision: FindingDecision, findingIds?: string[]) =>
    api.setFindingDecisions({ missionId: mission.id, roundId: round.id, decision, findingIds }).catch(fail('Could not apply the bulk decision'))

  const dropRemainingNits = () => {
    const reason: DropReason = 'not_worth_it'
    const findingIds = findings.filter((x) => x.severity === 'nit' && x.decision === 'pending').map((f) => f.id)
    return api
      .setFindingDecisions({ missionId: mission.id, roundId: round.id, decision: 'dropped', findingIds, dropReason: reason })
      .catch(fail('Could not drop the nits'))
  }

  const post = async () => {
    setPosting(true)
    try {
      const { url } = await api.postComment(mission.id)
      pushToast({ kind: 'success', title: `Posted to #${mission.pr.number}`, body: url })
    } catch (e) {
      pushToast({ kind: 'error', title: 'Posting failed', body: (e as Error).message, missionId: mission.id })
    } finally {
      setPosting(false)
      setConfirming(false)
    }
  }

  const blockersAndMajors = findings.filter((f) => f.severity === 'blocker' || f.severity === 'major')
  const pendingNits = findings.filter((f) => f.severity === 'nit' && f.decision === 'pending')
  const canPost = !readOnly && (findings.length === 0 || counts.approved + counts.dropped > 0)
  const canEditSummary = !readOnly && (mission.state === 'needs_you' || mission.state === 'failed') && !round.postedAt

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <MissionHeader mission={mission} round={round} slot={slot} loadout={loadout} />
      <div className="min-h-0 flex-1 overflow-auto">
        <div className="mx-auto flex max-w-[920px] flex-col gap-4 px-5 py-4">
          {mission.error && (
            <div className="flex items-start gap-3 rounded-lg border border-rose/30 bg-rose/10 px-3.5 py-2.5 text-[12.5px] text-rose" role="alert">
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <span className="min-w-0 flex-1 break-words">{mission.error}</span>
            </div>
          )}
          {mission.stale && (
            <div className="flex items-center gap-3 rounded-lg border border-amber/30 bg-amber/10 px-3.5 py-2.5 text-[12.5px] text-amber" role="status">
              <GitCommitHorizontal className="h-4 w-4 shrink-0" aria-hidden />
              <span className="flex-1">
                The author pushed <span className="font-mono">{shortSha(mission.pr.headSha)}</span> after this review. Re-run to review the delta.
              </span>
              <Button size="sm" variant="secondary" icon={<RotateCcw className="h-3.5 w-3.5" />} onClick={() => void actions.rerun(mission.id)}>
                Re-run
              </Button>
            </div>
          )}

          <BriefingCard round={round} />
          <SummaryCard mission={mission} round={round} editable={canEditSummary} />

          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[12px] text-muted">{plural(findings.length, 'finding')}</span>
            <div className="flex-1" />
            <Button size="sm" variant="ghost" disabled={readOnly || findings.length === 0} onClick={() => void bulk('approved')}>
              Approve all
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={readOnly || blockersAndMajors.length === 0}
              onClick={() => void bulk('approved', blockersAndMajors.map((f) => f.id))}
            >
              Approve blockers & majors
            </Button>
            <Button size="sm" variant="ghost" disabled={readOnly || pendingNits.length === 0} onClick={() => void dropRemainingNits()}>
              Drop all remaining nits
            </Button>
          </div>

          {findings.length === 0 ? (
            <EmptyState compact title="No findings" description="The reviewer had nothing to report. Posting sends the summary only." />
          ) : (
            <ol className="flex flex-col gap-2" aria-label="Findings">
              {findings.map((f) => (
                <FindingCard
                  key={f.id}
                  finding={f}
                  readOnly={readOnly}
                  blobUrl={f.file ? blobUrl(mission, round, f.file, f.line) : undefined}
                  onDecision={(patch) => void decide(f, patch)}
                />
              ))}
            </ol>
          )}

          {preview && (
            <div ref={previewRef}>
              <Card padded={false}>
                <div className="flex items-center gap-2 border-b border-line px-3.5 py-2">
                  <span className="text-[10.5px] font-semibold uppercase tracking-wider text-faint">Comment preview</span>
                  <span className="text-[11px] text-faint">as it will be posted to GitHub</span>
                </div>
                <div className="px-3.5 py-3">
                  {previewMd === null ? <div className="text-[12px] text-faint">Building preview…</div> : <Markdown>{previewMd}</Markdown>}
                </div>
              </Card>
            </div>
          )}

          <RoundDetails round={round} />
        </div>
      </div>

      <footer className="flex shrink-0 flex-wrap items-center gap-2 border-t border-line bg-surface px-5 py-2.5">
        <div className="flex items-center gap-3 text-[12px] tabular-nums">
          <span className={cn(counts.approved > 0 ? 'text-lime' : 'text-faint')}>{counts.approved} approved</span>
          <span className={cn(counts.dropped > 0 ? 'text-muted' : 'text-faint')}>{counts.dropped} dropped</span>
          <span className={cn(counts.pending > 0 ? 'text-amber' : 'text-faint')}>{counts.pending} pending</span>
        </div>
        <Button
          size="sm"
          variant="ghost"
          aria-pressed={preview}
          icon={preview ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
          onClick={() => setPreview((p) => !p)}
        >
          Preview comment
        </Button>
        <div className="flex-1" />
        <RerunControl mission={mission} disabled={readOnly} />
        <ConfirmButton size="sm" variant="ghost" confirmLabel="Close and remove worktree?" disabled={readOnly} onConfirm={() => void actions.close(mission.id)}>
          Close mission
        </ConfirmButton>
        {confirming ? (
          <span className="inline-flex items-center gap-1.5 rounded-md border border-accent/30 bg-accent/10 py-0.5 pl-2.5 pr-1 text-[12.5px] text-ink" role="alertdialog" aria-label="Confirm posting">
            <span>{counts.approved === 0 ? 'Post the summary only?' : `Post ${plural(counts.approved, 'finding')}?`}</span>
            <Button size="sm" variant="primary" loading={posting} onClick={() => void post()} autoFocus>
              Post
            </Button>
            <Button size="sm" variant="ghost" disabled={posting} onClick={() => setConfirming(false)}>
              Cancel
            </Button>
          </span>
        ) : (
          <Button
            size="md"
            variant="primary"
            icon={<Send className="h-3.5 w-3.5" />}
            disabled={!canPost}
            loading={posting || readOnly}
            title={canPost ? undefined : 'Decide on at least one finding first'}
            onClick={() => setConfirming(true)}
          >
            {readOnly ? 'Posting…' : 'Post to GitHub'}
          </Button>
        )}
      </footer>
    </div>
  )
}
