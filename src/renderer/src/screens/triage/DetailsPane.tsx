import { useEffect, useMemo, useRef, useState } from 'react'
import { Eye, EyeOff, RotateCcw, ScrollText, Send, TriangleAlert } from 'lucide-react'
import type { Mission, MissionState, PullRequest, ReviewRound } from '@core/domain'
import { api } from '@/lib/api'
import { cn } from '@/lib/cn'
import { plural } from '@/lib/format'
import { VERDICT_META } from '@/lib/review'
import { selectLastActivityFor, selectMissions, selectSettings, selectSlots, useAppStore } from '@/state/store'
import { ActivityLog } from '@/components/app/ActivityLog'
import { BriefingCard } from '@/components/app/BriefingCard'
import { ReviewSplitButton } from '@/components/app/ReviewSplitButton'
import { RoundDetails } from '@/components/app/RoundDetails'
import { useActivityFor } from '@/components/app/useActivity'
import { useNow } from '@/components/app/useNow'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { DOT_TONE } from '@/components/ui/Chip'
import { EmptyState } from '@/components/ui/EmptyState'
import { Markdown } from '@/components/ui/Markdown'
import { DetailsSide } from './DetailsSide'
import { PrHeader } from './PrHeader'
import { RoundView, SectionLabel } from './RoundView'
import { StatusLine } from './StatusLine'
import { useMissionActions } from './useMissionActions'

const RUNNING: readonly MissionState[] = ['queued', 'preparing', 'reviewing']

function roundTone(round: ReviewRound, running: boolean): string {
  if (running) return DOT_TONE.accent
  if (round.error) return DOT_TONE.rose
  return DOT_TONE[VERDICT_META[round.verdict].tone]
}

function RoundTabs({ rounds, selectedId, runningId, onSelect }: { rounds: ReviewRound[]; selectedId?: string; runningId?: string; onSelect: (id: string) => void }) {
  return (
    <div role="tablist" aria-label="Rounds" className="flex flex-wrap items-center gap-1">
      {rounds.map((r, i) => {
        const selected = r.id === selectedId
        const latest = i === rounds.length - 1
        return (
          <button
            key={r.id}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => onSelect(r.id)}
            className={cn(
              'inline-flex h-7 items-center gap-1.5 rounded-md border px-2.5 text-[12px] transition-colors',
              selected ? 'border-line bg-raised text-ink' : 'border-transparent text-muted hover:bg-raised/60 hover:text-ink'
            )}
          >
            <span className={cn('h-1.5 w-1.5 rounded-full', roundTone(r, r.id === runningId))} aria-hidden />
            Round {r.index}
            {latest && <span className="text-[10.5px] text-faint">latest</span>}
          </button>
        )
      })}
    </div>
  )
}

function LiveActivity({ mission }: { mission: Mission }) {
  const activity = useActivityFor(mission.id)
  const last = useAppStore(selectLastActivityFor(mission.id))
  return (
    <div className="flex flex-col gap-2">
      <SectionLabel>Activity</SectionLabel>
      <ActivityLog items={activity} className="max-h-[460px]" emptyText={mission.state === 'queued' ? 'Waiting for a free reviewer.' : (last?.text ?? 'Starting…')} />
    </div>
  )
}

function ErrorBox({ error }: { error: string }) {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-rose/30 bg-rose/10 px-3.5 py-3" role="alert">
      <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-rose" aria-hidden />
      <pre className="min-w-0 whitespace-pre-wrap break-words font-mono text-[12px] leading-relaxed text-ink/85">{error}</pre>
    </div>
  )
}

function ErrorPanel({ mission, round }: { mission: Mission; round?: ReviewRound }) {
  const activity = useActivityFor(mission.id, round?.activity)
  return (
    <div className="flex flex-col gap-4">
      <ErrorBox error={round?.error ?? mission.error ?? 'Unknown error'} />
      <BriefingCard round={round} />
      {round && <RoundDetails round={round} />}
      <div className="flex flex-col gap-2">
        <SectionLabel>Activity</SectionLabel>
        <ActivityLog items={activity} className="max-h-[320px]" follow={false} />
      </div>
    </div>
  )
}

function CommentPreview({ mission, round }: { mission: Mission; round: ReviewRound }) {
  const pushToast = useAppStore((s) => s.pushToast)
  const [md, setMd] = useState<string | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  const key = round.findings.map((f) => `${f.id}:${f.decision}:${f.dropReason ?? ''}`).join('|')
  useEffect(() => {
    let cancelled = false
    api
      .previewComment(mission.id)
      .then((text) => {
        if (!cancelled) setMd(text)
      })
      .catch((e: Error) => {
        if (!cancelled) pushToast({ kind: 'error', title: 'Could not build the preview', body: e.message })
      })
    return () => {
      cancelled = true
    }
  }, [key, round.summary, mission.id, pushToast])
  useEffect(() => {
    if (md !== null) ref.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [md])
  return (
    <div ref={ref}>
      <Card padded={false} aria-label="Comment preview">
        <div className="flex items-center gap-2 border-b border-line px-3.5 py-2">
          <SectionLabel>Comment preview</SectionLabel>
          <span className="text-[11px] text-faint">as it will be posted to GitHub</span>
        </div>
        <div className="px-3.5 py-3">{md === null ? <div className="text-[12px] text-faint">Building preview…</div> : <Markdown>{md}</Markdown>}</div>
      </Card>
    </div>
  )
}

function TriageFooter({ mission, round, readOnly, preview, onPreview }: { mission: Mission; round: ReviewRound; readOnly: boolean; preview: boolean; onPreview: () => void }) {
  const pushToast = useAppStore((s) => s.pushToast)
  const actions = useMissionActions()
  const [confirming, setConfirming] = useState(false)
  const [posting, setPosting] = useState(false)
  const counts = useMemo(
    () => ({
      approved: round.findings.filter((f) => f.decision === 'approved').length,
      dropped: round.findings.filter((f) => f.decision === 'dropped').length,
      pending: round.findings.filter((f) => f.decision === 'pending').length
    }),
    [round.findings]
  )
  const decisionKey = round.findings.map((f) => `${f.id}:${f.decision}`).join('|')
  useEffect(() => setConfirming(false), [decisionKey, mission.id])
  const canPost = !readOnly && (round.findings.length === 0 || counts.approved + counts.dropped > 0)

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

  return (
    <footer className="flex shrink-0 flex-wrap items-center gap-2 border-t border-line bg-surface px-5 py-2.5">
      <div className="flex items-center gap-3 text-[12px] tabular-nums">
        <span className={cn(counts.approved > 0 ? 'text-lime' : 'text-faint')}>{counts.approved} approved</span>
        <span className={cn(counts.dropped > 0 ? 'text-muted' : 'text-faint')}>{counts.dropped} dropped</span>
        <span className={cn(counts.pending > 0 ? 'text-amber' : 'text-faint')}>{counts.pending} pending</span>
      </div>
      <Button size="sm" variant="ghost" aria-pressed={preview} icon={preview ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />} onClick={onPreview}>
        Preview comment
      </Button>
      <div className="flex-1" />
      <ReviewSplitButton
        label="Re-run"
        icon={<RotateCcw className="h-3.5 w-3.5" aria-hidden />}
        loadoutId={mission.loadoutId}
        autoPost={mission.autoPost}
        disabled={readOnly}
        title="Start a new round on the current head"
        onStart={({ loadoutId, options }) => actions.rerun(mission.id, loadoutId, options)}
      />
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
  )
}

function NotReviewed({ pr }: { pr: PullRequest }) {
  const navigate = useAppStore((s) => s.navigate)
  const earlier = useAppStore((s) => selectMissions(s).some((m) => m.prId === pr.id && m.state === 'closed'))
  return (
    <EmptyState
      icon={<ScrollText />}
      title="No review yet"
      description="Start one with Review above. Its arrow picks the review type, model, effort and budget for this run only."
      action={
        earlier ? (
          <Button size="sm" variant="ghost" onClick={() => navigate('log')}>
            Earlier reviews of this PR are in the Log
          </Button>
        ) : undefined
      }
    />
  )
}

export interface DetailsPaneProps {
  pr: PullRequest
  mission?: Mission
}

/** Everything about one pull request: who and what it is, where its review stands, and each round. */
export function DetailsPane({ pr, mission }: DetailsPaneProps) {
  const settings = useAppStore(selectSettings)
  const slots = useAppStore(selectSlots)
  const now = useNow()
  const rounds = mission?.rounds ?? []
  const latest = rounds[rounds.length - 1]
  const [roundId, setRoundId] = useState<string | undefined>(latest?.id)
  const [preview, setPreview] = useState(false)
  useEffect(() => setRoundId(latest?.id), [mission?.id, latest?.id])
  useEffect(() => setPreview(false), [mission?.id])
  if (!settings) return null

  const round = rounds.find((r) => r.id === roundId) ?? latest
  const running = !!mission && RUNNING.includes(mission.state)
  const runningId = running && latest && !latest.finishedAt ? latest.id : undefined
  const triageRound = mission && (mission.state === 'needs_you' || mission.state === 'posting') && latest && !latest.postedAt ? latest : undefined
  const inTriage = !!round && round.id === triageRound?.id

  // A failure before the round was created (checkout, fetch) has no round of its own to hold the error.
  const failedBeforeRound = mission?.state === 'failed' && !latest?.error
  let content
  if (!mission) content = <NotReviewed pr={pr} />
  else if (failedBeforeRound && !round) content = <ErrorPanel mission={mission} />
  else if (!round || round.id === runningId) content = <LiveActivity mission={mission} />
  else if (round.error) content = <ErrorPanel mission={mission} round={round} />
  else
    content = (
      <>
        {inTriage && mission.error && mission.error.includes('\n') && <ErrorBox error={mission.error} />}
        <RoundView mission={mission} round={round} settings={settings} triage={inTriage} readOnly={mission.state === 'posting'} now={now} />
        {inTriage && preview && <CommentPreview mission={mission} round={round} />}
      </>
    )

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-details={pr.id}>
      <PrHeader pr={pr} mission={mission} now={now} />
      <StatusLine pr={pr} mission={mission} settings={settings} slots={slots} now={now} />
      <div className="min-h-0 flex-1 overflow-auto">
        <div className="mx-auto grid max-w-[1180px] gap-4 px-5 py-4 min-[1360px]:grid-cols-[minmax(0,1fr)_300px]">
          <div className="flex min-w-0 flex-col gap-4">
            {mission?.state === 'closed' && mission.error && <ErrorBox error={mission.error} />}
            {failedBeforeRound && round && <ErrorPanel mission={mission} />}
            {rounds.length > 1 && <RoundTabs rounds={rounds} selectedId={round?.id} runningId={runningId} onSelect={setRoundId} />}
            {content}
          </div>
          <DetailsSide pr={pr} mission={mission} settings={settings} slots={slots} now={now} />
        </div>
      </div>
      {mission && triageRound && inTriage && (
        <TriageFooter mission={mission} round={triageRound} readOnly={mission.state === 'posting'} preview={preview} onPreview={() => setPreview((p) => !p)} />
      )}
    </div>
  )
}
