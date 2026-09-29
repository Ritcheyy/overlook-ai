import { useMemo, useState, type KeyboardEvent, type MouseEvent } from 'react'
import { FolderGit2, Github, Inbox as InboxIcon, Search, SearchX } from 'lucide-react'
import type { Mission, PullRequest, Settings } from '@core/domain'
import { api } from '@/lib/api'
import { cn } from '@/lib/cn'
import { plural, relativeTime } from '@/lib/format'
import { selectInbox, selectMissions, selectSettings, useAppStore } from '@/state/store'
import { Button } from '@/components/ui/Button'
import { Chip } from '@/components/ui/Chip'
import { EmptyState } from '@/components/ui/EmptyState'
import { IconButton } from '@/components/ui/IconButton'
import { Input } from '@/components/ui/Input'
import { Segmented } from '@/components/ui/Segmented'
import { PrMarkers } from '@/components/app/PrMarkers'
import { ReviewSplitButton } from '@/components/app/ReviewSplitButton'
import { StateChip } from '@/components/app/StateChip'
import { useNow } from '@/components/app/useNow'
import { useMissionActions } from '../triage/useMissionActions'

/** "To review" is everyone else's PRs: requested of you, or still under your review after the request went away. */
type Filter = 'all' | 'others' | 'mine'

function matchesQuery(pr: PullRequest, q: string): boolean {
  if (!q) return true
  const hay = [`#${pr.number}`, pr.title, pr.author, pr.repo.fullName, pr.headRef, ...pr.labels].join(' ').toLowerCase()
  return q
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((term) => hay.includes(term))
}

function InboxRow({ pr, mission, settings, now }: { pr: PullRequest; mission?: Mission; settings: Settings; now: number }) {
  const openDetails = useAppStore((s) => s.openDetails)
  const actions = useMissionActions()
  const open = () => openDetails({ prId: pr.id, missionId: mission?.id })
  // Buttons inside the row act on their own; everything else opens the details.
  const stop = (e: MouseEvent | KeyboardEvent) => e.stopPropagation()
  return (
    <li
      tabIndex={0}
      onClick={open}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          open()
        }
      }}
      className={cn(
        'group grid cursor-pointer grid-cols-[56px_minmax(0,1fr)_auto] items-center gap-3 border-b border-line/60 py-2 pl-8 pr-4 outline-none transition-[background-color,opacity] hover:bg-surface/70 focus-visible:bg-surface/70',
        pr.isDraft && 'opacity-60 hover:opacity-100'
      )}
    >
      <span className="font-mono text-[12px] tabular-nums text-faint">#{pr.number}</span>
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="min-w-0 truncate text-[13px] text-ink group-hover:text-accent" title={pr.title}>
            {pr.title}
          </span>
          {pr.isDraft && <Chip tone="faint">DRAFT</Chip>}
          {pr.labels.map((l) => (
            <Chip key={l} tone="muted" className="hidden font-normal lg:inline-flex">
              {l}
            </Chip>
          ))}
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11.5px] text-faint">
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
      <div className="flex items-center justify-end gap-2">
        <PrMarkers pr={pr} mission={mission} className="justify-end" />
        {mission ? (
          <StateChip state={mission.state} size="sm" />
        ) : (
          <span onClick={stop} onKeyDown={stop}>
            <ReviewSplitButton
              label="Review"
              loadoutId={settings.defaultLoadoutId}
              autoPost={settings.autoPostRepos.includes(pr.repo.fullName)}
              title="Review with the default review type"
              onStart={({ loadoutId, options }) => actions.dispatch(pr.id, loadoutId, options)}
            />
          </span>
        )}
        <span onClick={stop} onKeyDown={stop}>
          <IconButton size="sm" aria-label={`Open #${pr.number} on GitHub`} title={pr.url} onClick={() => void api.openExternal(pr.url)}>
            <Github />
          </IconButton>
        </span>
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
      others: inbox.filter((p) => !p.mine).length,
      mine: inbox.filter((p) => p.mine).length
    }),
    [inbox]
  )

  const groups = useMemo(() => {
    const q = query.trim()
    const visible = inbox.filter((p) => (filter === 'others' ? !p.mine : filter === 'mine' ? p.mine : true)).filter((p) => matchesQuery(p, q))
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
            { value: 'others', label: 'To review', count: counts.others },
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
