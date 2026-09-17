import { useCallback, useMemo, useRef, useState } from 'react'
import { ChevronDown, FolderGit2, Inbox as InboxIcon, LoaderCircle, Search, SearchX } from 'lucide-react'
import type { Mission, PullRequest, Settings } from '@core/domain'
import { api } from '@/lib/api'
import { cn } from '@/lib/cn'
import { plural, relativeTime } from '@/lib/format'
import { selectInbox, selectMissions, selectSettings, useAppStore } from '@/state/store'
import { Button } from '@/components/ui/Button'
import { Chip } from '@/components/ui/Chip'
import { Dropdown, MenuItem, MenuLabel, MenuSeparator } from '@/components/ui/Dropdown'
import { EmptyState } from '@/components/ui/EmptyState'
import { Input } from '@/components/ui/Input'
import { Segmented } from '@/components/ui/Segmented'
import { StateChip } from '@/components/app/StateChip'
import { useNow } from '@/components/app/useNow'

type Filter = 'all' | 'requested' | 'mine'

function matchesQuery(pr: PullRequest, q: string): boolean {
  if (!q) return true
  const hay = [`#${pr.number}`, pr.title, pr.author, pr.repo.fullName, pr.headRef, ...pr.labels].join(' ').toLowerCase()
  return q
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((term) => hay.includes(term))
}

function ReviewButton({ pr, settings }: { pr: PullRequest; settings: Settings }) {
  const pushToast = useAppStore((s) => s.pushToast)
  const anchor = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  // Undefined means "not chosen here": the engine falls back to the per-repo setting.
  const [autoPost, setAutoPost] = useState<boolean | undefined>(undefined)
  const close = useCallback(() => setOpen(false), [])
  const repoAutoPost = settings.autoPostRepos.includes(pr.repo.fullName)
  const defaultLoadout = settings.loadouts.find((l) => l.id === settings.defaultLoadoutId) ?? settings.loadouts[0]

  const dispatch = async (loadoutId: string) => {
    setOpen(false)
    setBusy(true)
    try {
      await api.dispatch({ prId: pr.id, loadoutId, autoPost })
    } catch (e) {
      pushToast({ kind: 'error', title: `Could not dispatch #${pr.number}`, body: (e as Error).message })
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div
        ref={anchor}
        className={cn(
          'inline-flex h-7 items-stretch overflow-hidden rounded-md border border-line bg-raised text-[12px] font-medium text-ink transition-colors',
          'hover:border-faint/70',
          busy && 'opacity-60'
        )}
      >
        <button
          type="button"
          disabled={busy || !defaultLoadout}
          onClick={() => defaultLoadout && dispatch(defaultLoadout.id)}
          title={defaultLoadout ? `Review with ${defaultLoadout.name}` : 'No loadouts configured'}
          className="inline-flex items-center gap-1.5 px-2.5 transition-colors hover:bg-surface disabled:pointer-events-none"
        >
          {busy && <LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden />}
          Review
        </button>
        <button
          type="button"
          aria-label="Choose loadout"
          aria-haspopup="menu"
          aria-expanded={open}
          disabled={busy}
          onClick={() => setOpen((o) => !o)}
          className="inline-flex items-center border-l border-line px-1.5 text-muted transition-colors hover:bg-surface hover:text-ink"
        >
          <ChevronDown className="h-3.5 w-3.5" aria-hidden />
        </button>
      </div>
      <Dropdown open={open} onClose={close} anchorRef={anchor} align="end" width={300}>
        <div role="menu" aria-label="Review options">
          <MenuLabel>Review with</MenuLabel>
          {settings.loadouts.map((l) => (
            <MenuItem key={l.id} onClick={() => dispatch(l.id)} hint={l.id === settings.defaultLoadoutId ? 'default' : undefined}>
              <div className="text-ink">{l.name}</div>
              <div className="mt-0.5 text-[11px] leading-snug text-faint">{l.tagline}</div>
            </MenuItem>
          ))}
          <MenuSeparator />
          <label className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-[12px] text-muted hover:bg-surface">
            <input
              type="checkbox"
              className="h-3.5 w-3.5 accent-accent"
              checked={autoPost ?? repoAutoPost}
              onChange={(e) => setAutoPost(e.target.checked)}
            />
            <span className="flex-1">Post without triage</span>
            {repoAutoPost && autoPost === undefined && <span className="text-[10.5px] text-faint">repo default</span>}
          </label>
        </div>
      </Dropdown>
    </>
  )
}

function InboxRow({ pr, mission, settings, now }: { pr: PullRequest; mission?: Mission; settings: Settings; now: number }) {
  const navigate = useAppStore((s) => s.navigate)
  const openMission = () => {
    if (!mission) return
    const target = mission.state === 'needs_you' || mission.state === 'failed' ? 'triage' : 'floor'
    navigate(target, { missionId: mission.id })
  }
  return (
    <li
      className={cn(
        'group grid grid-cols-[56px_minmax(0,1fr)_auto] items-center gap-3 border-b border-line/60 py-2 pl-8 pr-5 transition-[background-color,opacity] hover:bg-surface/70',
        pr.isDraft && 'opacity-60 hover:opacity-100'
      )}
    >
      <span className="font-mono text-[12px] tabular-nums text-faint">#{pr.number}</span>
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-1.5">
          <button
            type="button"
            onClick={() => void api.openExternal(pr.url)}
            title={`${pr.title}\n${pr.url}`}
            className="min-w-0 truncate text-left text-[13px] text-ink hover:text-accent hover:underline"
          >
            {pr.title}
          </button>
          {pr.isDraft && <Chip tone="faint">DRAFT</Chip>}
          {pr.labels.map((l) => (
            <Chip key={l} tone="muted" className="hidden font-normal lg:inline-flex">
              {l}
            </Chip>
          ))}
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11.5px] text-faint">
          <span className="text-muted">{pr.author}</span>
          <span aria-hidden>·</span>
          <span title={pr.updatedAt}>{relativeTime(pr.updatedAt, now)}</span>
          <span aria-hidden>·</span>
          <span className="font-mono tabular-nums">
            <span className="text-lime/80">+{pr.additions ?? 0}</span> <span className="text-rose/80">−{pr.deletions ?? 0}</span>
          </span>
          {pr.changedFiles !== undefined && (
            <>
              <span aria-hidden>·</span>
              <span>{plural(pr.changedFiles, 'file')}</span>
            </>
          )}
          {pr.mine && (
            <>
              <span aria-hidden>·</span>
              <span className="text-teal/80">mine</span>
            </>
          )}
        </div>
      </div>
      <div className="flex items-center justify-end">
        {mission ? (
          <StateChip state={mission.state} size="sm" onClick={openMission} title="Open mission" />
        ) : (
          <ReviewButton pr={pr} settings={settings} />
        )}
      </div>
    </li>
  )
}

export function InboxScreen() {
  const inbox = useAppStore(selectInbox)
  const missions = useAppStore(selectMissions)
  const settings = useAppStore(selectSettings)
  const pollError = useAppStore((s) => s.snapshot?.pollError)
  const pushToast = useAppStore((s) => s.pushToast)
  const [filter, setFilter] = useState<Filter>('all')
  const [query, setQuery] = useState('')
  const now = useNow()

  const missionByPr = useMemo(() => {
    const map = new Map<string, Mission>()
    for (const m of missions) if (m.state !== 'closed' && !map.has(m.prId)) map.set(m.prId, m)
    return map
  }, [missions])

  const counts = useMemo(
    () => ({
      all: inbox.length,
      requested: inbox.filter((p) => p.reviewRequested).length,
      mine: inbox.filter((p) => p.mine).length
    }),
    [inbox]
  )

  const groups = useMemo(() => {
    const q = query.trim()
    const visible = inbox.filter((p) => (filter === 'requested' ? p.reviewRequested : filter === 'mine' ? p.mine : true)).filter((p) => matchesQuery(p, q))
    const byRepo = new Map<string, PullRequest[]>()
    for (const p of visible) byRepo.set(p.repo.fullName, [...(byRepo.get(p.repo.fullName) ?? []), p])
    return [...byRepo.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([fullName, prs]) => ({
        fullName,
        owner: prs[0].repo.owner,
        name: prs[0].repo.name,
        prs: prs.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      }))
  }, [inbox, filter, query])

  const visibleCount = groups.reduce((n, g) => n + g.prs.length, 0)
  if (!settings) return null

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-[52px] shrink-0 items-center gap-3 border-b border-line px-5">
        <h1 className="text-[14px] font-semibold tracking-tight">Inbox</h1>
        <span className="text-[12px] tabular-nums text-faint">{plural(visibleCount, 'pull request')}</span>
        <div className="flex-1" />
        <Segmented<Filter>
          aria-label="Filter pull requests"
          size="md"
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'all', label: 'All', count: counts.all },
            { value: 'requested', label: 'Requested', count: counts.requested },
            { value: 'mine', label: 'Mine', count: counts.mine }
          ]}
        />
        <Input
          leading={<Search />}
          placeholder="Search title, author, repo…"
          aria-label="Search pull requests"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          wrapperClassName="w-[240px]"
        />
      </header>
      {pollError && (
        <div className="border-b border-rose/30 bg-rose/10 px-5 py-1.5 text-[12px] text-rose" role="alert">
          Polling failed: {pollError}
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-auto">
        {inbox.length === 0 ? (
          <EmptyState
            icon={<InboxIcon />}
            title="Inbox zero"
            description="No open pull requests are waiting for your review. New review requests show up here as GitHub is polled."
            action={
              <Button
                variant="secondary"
                onClick={() => void api.refreshInbox().catch((e: Error) => pushToast({ kind: 'error', title: 'Refresh failed', body: e.message }))}
              >
                Poll GitHub now
              </Button>
            }
          />
        ) : groups.length === 0 ? (
          <EmptyState
            icon={<SearchX />}
            title="No matches"
            description="Nothing in the inbox matches this filter."
            action={
              <Button
                variant="ghost"
                onClick={() => {
                  setQuery('')
                  setFilter('all')
                }}
              >
                Clear filters
              </Button>
            }
          />
        ) : (
          groups.map((g, i) => (
            <section key={g.fullName} aria-label={g.fullName} className={cn(i > 0 && 'mt-3')}>
              <h2 className="sticky top-0 z-10 flex h-9 items-center gap-2 border-b border-t border-line bg-surface px-5 text-[13px]">
                <FolderGit2 className="h-3.5 w-3.5 text-faint" aria-hidden />
                <span className="text-muted">{g.owner}/</span>
                <span className="font-semibold text-ink">{g.name}</span>
                <Chip tone="muted" className="ml-1 tabular-nums">
                  {g.prs.length}
                </Chip>
              </h2>
              <ul>
                {g.prs.map((pr) => (
                  <InboxRow key={pr.id} pr={pr} mission={missionByPr.get(pr.id)} settings={settings} now={now} />
                ))}
              </ul>
            </section>
          ))
        )}
      </div>
    </div>
  )
}
