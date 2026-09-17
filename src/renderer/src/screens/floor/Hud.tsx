import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import type { Mission, MissionState, Slot } from '@core/domain'
import type { DemoEventKind } from '@core/ipc-contract'
import { api } from '@/lib/api'
import { Chip } from '@/components/ui/Chip'
import { ConfirmButton } from '@/components/ui/ConfirmButton'
import { selectNeedsYouCount, selectSettings, useAppStore } from '@/state/store'
import { chipFor, elapsedInState, formatElapsed, truncate } from './animation'
import { hasUnreviewedPush } from './floor-selectors'
import { useActivityLines, useDemoTarget, useFloorEmpty, useNewPushCount, useNow, useQueue, useSlotView, useSlots, useWatching } from './useFloorData'

const RUNNING: readonly MissionState[] = ['preparing', 'reviewing', 'posting']

export function StateChip({ state }: { state?: MissionState }) {
  const { label, color } = chipFor(state)
  return (
    <span
      className="inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium leading-none"
      style={{ color, borderColor: `${color}55`, backgroundColor: `${color}1f` }}
    >
      {label}
    </span>
  )
}

/** The amber tag every floor surface uses for a push nobody has reviewed yet. */
export function NewPushChip({ className }: { className?: string }) {
  return (
    <Chip tone="amber" dot pulse className={className}>
      new push
    </Chip>
  )
}

export function Counters() {
  const queued = useQueue().length
  const needsYou = useAppStore(selectNeedsYouCount)
  const watching = useWatching().length
  const newPush = useNewPushCount()
  const items: [string, number, string][] = [
    ['queued', queued, 'text-muted'],
    ['needs you', needsYou, needsYou > 0 ? 'text-amber' : 'text-muted'],
    ['watching', watching, watching > 0 ? 'text-teal' : 'text-muted'],
    ['new push', newPush, newPush > 0 ? 'text-amber' : 'text-muted']
  ]
  return (
    <div className="flex items-center gap-4 font-mono text-[11px] uppercase tracking-wider">
      {items.map(([label, n, cls]) => (
        <span key={label} className={cls}>
          <span className="text-ink">{n}</span> {label}
        </span>
      ))}
    </div>
  )
}

export function FloorTitle() {
  return (
    <div className="pointer-events-auto flex flex-col gap-1">
      <h1 className="text-lg font-semibold tracking-tight text-ink">Floor</h1>
      <Counters />
    </div>
  )
}

function ShelfRow({ mission }: { mission: Mission }) {
  const navigate = useAppStore((s) => s.navigate)
  const pushToast = useAppStore((s) => s.pushToast)
  const settings = useAppStore(selectSettings)
  const [busy, setBusy] = useState(false)
  const loadoutName = settings?.loadouts.find((l) => l.id === mission.loadoutId)?.name
  const label = `#${mission.pr.number} ${mission.pr.title}`
  const onCancel = async () => {
    setBusy(true)
    try {
      await api.cancelMission(mission.id)
    } catch (e) {
      pushToast({ kind: 'error', title: 'Could not cancel', body: (e as Error).message })
    } finally {
      setBusy(false)
    }
  }
  return (
    <li className="flex items-center gap-1" data-queued={mission.id}>
      <button
        type="button"
        onClick={() => navigate('triage', { missionId: mission.id })}
        title={label}
        className="flex min-w-0 flex-1 flex-col rounded-md px-1.5 py-1 text-left hover:bg-raised"
      >
        <span className="w-full truncate text-[11px] text-ink">
          <span className="font-mono text-muted">#{mission.pr.number}</span> {mission.pr.title}
        </span>
        <span className="w-full truncate text-[10px] text-faint">
          {loadoutName ?? mission.loadoutId}
          {mission.rounds.length > 0 ? ` · round ${mission.rounds.length + 1}` : ''}
        </span>
      </button>
      <ConfirmButton
        size="sm"
        variant="ghost"
        aria-label={`Cancel #${mission.pr.number}`}
        confirmLabel="Cancel?"
        icon={<X className="h-3.5 w-3.5" aria-hidden />}
        loading={busy}
        onConfirm={() => void onCancel()}
        className="px-1 text-muted hover:text-rose"
      />
    </li>
  )
}

/** Queued missions waiting for a free desk, in the order the scheduler will pick them. */
export function ShelfList() {
  const queue = useQueue()
  if (queue.length === 0) return null
  return (
    <section aria-label="Shelf" className="pointer-events-auto w-52 rounded-lg border border-line bg-surface/85 p-1.5 shadow-lg backdrop-blur xl:w-64">
      <div className="flex items-center justify-between px-1.5 pb-1 font-mono text-[10px] uppercase tracking-wider text-muted">
        <span>Shelf</span>
        <span className="text-faint">next up</span>
      </div>
      <ul className="flex max-h-44 flex-col gap-0.5 overflow-y-auto">
        {queue.map((m) => (
          <ShelfRow key={m.id} mission={m} />
        ))}
      </ul>
    </section>
  )
}

function WatchingRow({ mission }: { mission: Mission }) {
  const navigate = useAppStore((s) => s.navigate)
  const label = `#${mission.pr.number} ${mission.pr.title}`
  return (
    <li data-watching={mission.id}>
      <button
        type="button"
        onClick={() => navigate('triage', { missionId: mission.id })}
        title={label}
        className="flex w-full min-w-0 items-center gap-1.5 rounded-md px-1.5 py-1 text-left hover:bg-raised"
      >
        <span className="min-w-0 flex-1 truncate text-[11px] text-ink">
          <span className="font-mono text-muted">#{mission.pr.number}</span> {mission.pr.title}
        </span>
        {hasUnreviewedPush(mission) && <NewPushChip />}
      </button>
    </li>
  )
}

/** Watched missions, which the 3D floor pins to its corkboard; the DOM fallback lists them here. */
export function WatchingList() {
  const watching = useWatching()
  if (watching.length === 0) return null
  return (
    <section aria-label="Corkboard" className="pointer-events-auto w-52 rounded-lg border border-line bg-surface/85 p-1.5 shadow-lg backdrop-blur xl:w-64">
      <div className="flex items-center justify-between px-1.5 pb-1 font-mono text-[10px] uppercase tracking-wider text-muted">
        <span>Corkboard</span>
        <span className="text-faint">watching</span>
      </div>
      <ul className="flex max-h-44 flex-col gap-0.5 overflow-y-auto">
        {watching.map((m) => (
          <WatchingRow key={m.id} mission={m} />
        ))}
      </ul>
    </section>
  )
}

export function DemoControls() {
  const settings = useAppStore(selectSettings)
  const target = useDemoTarget()
  const pushToast = useAppStore((s) => s.pushToast)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState<DemoEventKind | null>(null)
  if (!settings?.demoMode) return null

  const run = async (kind: DemoEventKind) => {
    setBusy(kind)
    try {
      await api.demoSimulate({ kind, prId: target?.prId })
    } catch (e) {
      pushToast({ kind: 'error', title: 'Demo action failed', body: (e as Error).message })
    } finally {
      setBusy(null)
    }
  }
  const prLabel = target ? `#${target.pr.number}` : 'PR'
  const actions: { kind: DemoEventKind; label: string; needsTarget: boolean }[] = [
    { kind: 'new_pr', label: 'New PR', needsTarget: false },
    { kind: 'push', label: `Push to ${prLabel}`, needsTarget: true },
    { kind: 'merge', label: `Merge ${prLabel}`, needsTarget: true },
    { kind: 'fail_next_review', label: 'Fail next review', needsTarget: false }
  ]
  return (
    <div className="pointer-events-auto relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="rounded-md border border-line bg-surface/80 px-2.5 py-1 text-[11px] font-medium text-muted backdrop-blur hover:text-ink"
      >
        Demo controls
      </button>
      {open && (
        <div
          role="menu"
          aria-label="Demo controls"
          className="absolute right-0 top-full z-20 mt-1 flex w-52 flex-col gap-1 rounded-lg border border-line bg-surface/95 p-2 shadow-xl backdrop-blur"
        >
          {actions.map((a) => (
            <button
              key={a.kind}
              type="button"
              role="menuitem"
              disabled={busy !== null || (a.needsTarget && !target)}
              onClick={() => void run(a.kind)}
              className="rounded-md px-2 py-1.5 text-left text-xs text-ink hover:bg-raised disabled:cursor-not-allowed disabled:opacity-40"
            >
              {a.label}
            </button>
          ))}
          {!target && <div className="px-2 pt-1 text-[10px] text-faint">Push and merge need an active or watched PR.</div>}
        </div>
      )}
    </div>
  )
}

export function EmptyHint() {
  const navigate = useAppStore((s) => s.navigate)
  return (
    <div className="pointer-events-auto flex flex-col items-center gap-3 rounded-xl border border-line/60 bg-bg/60 px-6 py-5 text-center backdrop-blur-sm">
      <p className="text-sm text-muted">Send a PR from the Inbox to put someone to work</p>
      <button
        type="button"
        onClick={() => navigate('inbox')}
        className="rounded-md border border-accent/50 bg-accent/15 px-3 py-1.5 text-xs font-medium text-accent hover:bg-accent/25"
      >
        Open inbox
      </button>
    </div>
  )
}

function ActivityLines({ mission, count }: { mission: Mission | undefined; count: number }) {
  const lines = useActivityLines(mission?.id, count)
  if (!mission) return null
  if (lines.length === 0) return <div className="font-mono text-[11px] text-faint">waiting for activity…</div>
  return (
    <ul className="flex flex-col gap-0.5">
      {lines.map((a, i) => (
        <li key={`${a.at}-${i}`} className="truncate font-mono text-[11px] text-muted" title={a.text}>
          <span className="text-faint">{a.kind}</span> {a.text}
        </li>
      ))}
    </ul>
  )
}

export function SlotCard({ slot }: { slot: Slot }) {
  const { mission, loadoutName } = useSlotView(slot)
  const navigate = useAppStore((s) => s.navigate)
  const pushToast = useAppStore((s) => s.pushToast)
  const now = useNow(1000)
  const [expanded, setExpanded] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const missionId = mission?.id
  useEffect(() => {
    setExpanded(false)
    setConfirming(false)
  }, [missionId])

  const running = !!mission && RUNNING.includes(mission.state)
  const cancellable = running && mission.state !== 'posting'
  const elapsed = mission ? formatElapsed(elapsedInState(mission, now)) : undefined

  const onOpen = () => {
    if (!mission) return
    if (mission.state === 'needs_you' || mission.state === 'failed') navigate('triage', { missionId: mission.id })
    else setExpanded((v) => !v)
  }
  const onCancel = async () => {
    if (!mission) return
    setBusy(true)
    try {
      await api.cancelMission(mission.id)
    } catch (e) {
      pushToast({ kind: 'error', title: 'Could not cancel', body: (e as Error).message })
    } finally {
      setBusy(false)
      setConfirming(false)
    }
  }
  const onRetry = async () => {
    if (!mission) return
    setBusy(true)
    try {
      await api.retryMission(mission.id)
    } catch (e) {
      pushToast({ kind: 'error', title: 'Could not retry', body: (e as Error).message })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="pointer-events-auto flex min-w-0 flex-col gap-2 rounded-xl border border-line bg-surface/85 p-3 shadow-lg backdrop-blur" data-slot={slot.id}>
      <div className="flex items-center gap-2">
        <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: slot.color, boxShadow: `0 0 8px ${slot.color}88` }} />
        <span className="text-sm font-semibold text-ink">{slot.name}</span>
        <StateChip state={mission?.state} />
        {mission && hasUnreviewedPush(mission) && <NewPushChip />}
        {elapsed && <span className="ml-auto font-mono text-[11px] text-muted">{elapsed}</span>}
      </div>
      {mission ? (
        <>
          <div className="min-w-0">
            <div className="truncate text-xs text-ink" title={`#${mission.pr.number} ${mission.pr.title}`}>
              <span className="font-mono text-muted">#{mission.pr.number}</span> {truncate(mission.pr.title, 72)}
            </div>
            <div className="truncate text-[11px] text-faint">
              {mission.pr.repo.fullName}
              {loadoutName ? ` · ${loadoutName}` : ''}
              {mission.rounds.length > 1 ? ` · round ${mission.rounds.length}` : ''}
            </div>
            {mission.error && (
              <div className="truncate font-mono text-[11px] text-rose" title={mission.error} role="alert">
                {mission.error}
              </div>
            )}
          </div>
          <ActivityLines mission={mission} count={expanded ? 12 : 3} />
          <div className="flex items-center gap-2 pt-0.5">
            <button
              type="button"
              onClick={onOpen}
              className="rounded-md border border-line bg-raised px-2.5 py-1 text-[11px] font-medium text-ink hover:border-accent/60"
            >
              {mission.state === 'needs_you' ? 'Open triage' : mission.state === 'failed' ? 'Open' : expanded ? 'Less' : 'Open'}
            </button>
            {mission.state === 'failed' && (
              <button
                type="button"
                disabled={busy}
                onClick={() => void onRetry()}
                className="rounded-md border border-accent/50 bg-accent/15 px-2.5 py-1 text-[11px] font-medium text-accent hover:bg-accent/25 disabled:opacity-50"
              >
                Retry
              </button>
            )}
            {cancellable && !confirming && (
              <button
                type="button"
                onClick={() => setConfirming(true)}
                className="rounded-md border border-line px-2.5 py-1 text-[11px] font-medium text-muted hover:border-rose/60 hover:text-rose"
              >
                Cancel
              </button>
            )}
            {cancellable && confirming && (
              <span className="flex items-center gap-1.5 text-[11px] text-muted">
                Cancel this review?
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void onCancel()}
                  className="rounded-md border border-rose/60 bg-rose/15 px-2 py-0.5 font-medium text-rose disabled:opacity-50"
                >
                  {busy ? 'Cancelling…' : 'Yes'}
                </button>
                <button type="button" onClick={() => setConfirming(false)} className="rounded-md border border-line px-2 py-0.5 text-ink">
                  Keep
                </button>
              </span>
            )}
          </div>
        </>
      ) : (
        <div className="text-[11px] text-faint">Idle. Waiting for a PR from the inbox.</div>
      )}
    </div>
  )
}

/** The overlay drawn on top of the canvas; `static` lays the same pieces out as a page. */
export function FloorHud({ variant }: { variant: 'overlay' | 'static' }) {
  const slots = useSlots()
  const empty = useFloorEmpty()
  const cards = slots.slice(0, 2)
  if (variant === 'static') {
    return (
      <div className="flex h-full flex-col gap-4 p-4">
        <div className="flex items-start justify-between">
          <div className="flex flex-col gap-3">
            <FloorTitle />
            <ShelfList />
            <WatchingList />
          </div>
          <DemoControls />
        </div>
        {empty && (
          <div className="flex justify-center">
            <EmptyHint />
          </div>
        )}
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {cards.map((s) => (
            <SlotCard key={s.id} slot={s} />
          ))}
        </div>
      </div>
    )
  }
  return (
    <div className="pointer-events-none absolute inset-0 z-30 flex flex-col p-4">
      <div className="flex items-start justify-between">
        <div className="flex flex-col gap-3">
          <FloorTitle />
          <ShelfList />
        </div>
        <DemoControls />
      </div>
      <div className="mt-auto flex flex-col gap-4">
        {empty && (
          <div className="flex justify-center">
            <EmptyHint />
          </div>
        )}
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {cards.map((s) => (
            <SlotCard key={s.id} slot={s} />
          ))}
        </div>
      </div>
    </div>
  )
}
