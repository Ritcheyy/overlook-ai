import { useCallback, useRef, useState, type CSSProperties } from 'react'
import {
  CircleAlert,
  FlaskConical,
  Github,
  Inbox,
  LayoutGrid,
  ListChecks,
  RefreshCw,
  ScrollText,
  Settings,
  ShieldQuestion,
  type LucideIcon
} from 'lucide-react'
import icon from '@/assets/icon.png'
import { api } from '@/lib/api'
import { cn } from '@/lib/cn'
import { relativeTime } from '@/lib/format'
import { selectNeedsYouCount, useAppStore, type Screen } from '@/state/store'
import { Badge } from '../ui/Badge'
import { Chip } from '../ui/Chip'
import { Dropdown, MenuItem, MenuLabel, MenuSeparator } from '../ui/Dropdown'
import { IconButton } from '../ui/IconButton'
import { Kbd } from '../ui/Kbd'
import { useNow } from './useNow'

export const NAV_ITEMS: { screen: Screen; label: string; icon: LucideIcon; key: string }[] = [
  { screen: 'floor', label: 'Floor', icon: LayoutGrid, key: '1' },
  { screen: 'inbox', label: 'Inbox', icon: Inbox, key: '2' },
  { screen: 'triage', label: 'Triage', icon: ListChecks, key: '3' },
  { screen: 'log', label: 'Log', icon: ScrollText, key: '4' },
  { screen: 'settings', label: 'Settings', icon: Settings, key: '5' }
]

const DRAG = { WebkitAppRegion: 'drag' } as unknown as CSSProperties
const NO_DRAG = { WebkitAppRegion: 'no-drag' } as unknown as CSSProperties

const selectInboxPendingCount = (s: ReturnType<typeof useAppStore.getState>) => {
  const snap = s.snapshot
  if (!snap) return 0
  const active = new Set(snap.missions.filter((m) => m.state !== 'closed').map((m) => m.prId))
  return snap.inbox.filter((p) => p.reviewRequested && !active.has(p.id)).length
}

function DemoMenu() {
  const anchor = useRef<HTMLSpanElement>(null)
  const [open, setOpen] = useState(false)
  const close = useCallback(() => setOpen(false), [])
  const pushToast = useAppStore((s) => s.pushToast)
  const selected = useAppStore((s) => (s.selectedMissionId ? s.snapshot?.missions.find((m) => m.id === s.selectedMissionId) : undefined))
  const run = async (kind: 'push' | 'merge' | 'close' | 'new_pr' | 'fail_next_review', prId?: string) => {
    close()
    try {
      await api.demoSimulate({ kind, prId })
    } catch (e) {
      pushToast({ kind: 'error', title: 'Demo action failed', body: (e as Error).message })
    }
  }
  const pr = selected?.pr
  return (
    <>
      <span ref={anchor} className="inline-flex">
        <Chip
          tone="amber"
          icon={<FlaskConical className="h-3 w-3" aria-hidden />}
          onClick={() => setOpen((o) => !o)}
          aria-haspopup="menu"
          aria-expanded={open}
          title="Demo mode: fake GitHub and fake reviewer. Click for demo events."
        >
          DEMO
        </Chip>
      </span>
      <Dropdown open={open} onClose={close} anchorRef={anchor} align="start" width={280}>
        <div role="menu">
          <MenuLabel>Simulate on {pr ? `#${pr.number}` : 'the selected mission'}</MenuLabel>
          <MenuItem disabled={!pr} onClick={() => run('push', pr?.id)}>
            Author pushes a new commit
          </MenuItem>
          <MenuItem disabled={!pr} onClick={() => run('merge', pr?.id)}>
            Merge the pull request
          </MenuItem>
          <MenuItem disabled={!pr} onClick={() => run('close', pr?.id)}>
            Close without merging
          </MenuItem>
          <MenuSeparator />
          <MenuItem onClick={() => run('new_pr')}>A new review request arrives</MenuItem>
          <MenuItem onClick={() => run('fail_next_review')}>Make the next review fail</MenuItem>
        </div>
      </Dropdown>
    </>
  )
}

export function Rail() {
  const screen = useAppStore((s) => s.screen)
  const navigate = useAppStore((s) => s.navigate)
  const needsYou = useAppStore(selectNeedsYouCount)
  const inboxPending = useAppStore(selectInboxPendingCount)
  const lastPollAt = useAppStore((s) => s.snapshot?.lastPollAt)
  const pollError = useAppStore((s) => s.snapshot?.pollError)
  const login = useAppStore((s) => s.snapshot?.githubLogin)
  const demo = useAppStore((s) => s.snapshot?.settings.demoMode ?? false)
  const environment = useAppStore((s) => s.snapshot?.environment)
  const version = useAppStore((s) => s.snapshot?.version)
  const pushToast = useAppStore((s) => s.pushToast)
  const now = useNow(20_000)
  const [refreshing, setRefreshing] = useState(false)

  const refresh = async () => {
    setRefreshing(true)
    try {
      await api.refreshInbox()
    } catch (e) {
      pushToast({ kind: 'error', title: 'Refresh failed', body: (e as Error).message })
    } finally {
      setRefreshing(false)
    }
  }

  return (
    <aside className="flex h-full w-[220px] shrink-0 flex-col border-r border-line bg-surface" aria-label="Navigation">
      {/* Top padding clears the macOS traffic lights; the whole block stays draggable like a title bar. */}
      <div className="flex shrink-0 items-center gap-2.5 px-4 pb-5 pt-[52px]" style={DRAG}>
        <img src={icon} alt="" width={28} height={28} className="h-7 w-7 shrink-0 rounded-md" draggable={false} />
        <span className="text-[14px] font-semibold tracking-tight text-ink">Overlook</span>
      </div>

      <nav className="flex flex-col gap-0.5 px-2" aria-label="Screens">
        {NAV_ITEMS.map(({ screen: id, label, icon: Icon, key }) => {
          const active = screen === id
          const count = id === 'triage' ? needsYou : id === 'inbox' ? inboxPending : 0
          return (
            <button
              key={id}
              type="button"
              aria-current={active ? 'page' : undefined}
              onClick={() => navigate(id)}
              style={NO_DRAG}
              className={cn(
                'group flex h-7 items-center gap-2.5 rounded-md px-2 text-[13px] transition-colors',
                active ? 'bg-raised text-ink shadow-[inset_0_0_0_1px_rgb(var(--line))]' : 'text-muted hover:bg-raised/60 hover:text-ink'
              )}
            >
              <Icon className={cn('h-[15px] w-[15px]', active ? 'text-accent' : 'text-faint group-hover:text-muted')} aria-hidden />
              <span className="flex-1 text-left">{label}</span>
              {count > 0 ? (
                <Badge count={count} tone={id === 'triage' ? 'amber' : 'accent'} aria-label={`${count} ${id === 'triage' ? 'missions need you' : 'pull requests waiting'}`} />
              ) : (
                <Kbd className="opacity-0 transition-opacity group-hover:opacity-100">⌘{key}</Kbd>
              )}
            </button>
          )
        })}
      </nav>

      <div className="flex-1" />

      <div className="flex flex-col gap-2 border-t border-line px-3 py-3 text-[12px]">
        <div className="flex items-center gap-2">
          {pollError ? (
            <span className="flex min-w-0 flex-1 items-center gap-1.5 text-rose" title={pollError}>
              <CircleAlert className="h-3.5 w-3.5 shrink-0" aria-hidden />
              <span className="truncate">{pollError}</span>
            </span>
          ) : (
            <span className="flex min-w-0 flex-1 items-center gap-1.5 text-muted" title={lastPollAt}>
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-lime" aria-hidden />
              <span className="truncate">{lastPollAt ? `Synced ${relativeTime(lastPollAt, now)}` : 'Not synced yet'}</span>
            </span>
          )}
          <IconButton size="sm" aria-label="Refresh inbox" onClick={refresh} disabled={refreshing}>
            <RefreshCw className={cn(refreshing && 'animate-spin')} />
          </IconButton>
        </div>
        {!demo && environment?.ok !== true && (
          <Chip
            tone={environment ? 'rose' : 'muted'}
            icon={environment ? <CircleAlert className="h-3 w-3" aria-hidden /> : <ShieldQuestion className="h-3 w-3" aria-hidden />}
            onClick={() => navigate('settings')}
            className="self-start"
            title="Open the Claude settings to check gh, claude, git and the worktree root."
          >
            {environment ? 'Environment check failed' : 'Run environment check'}
          </Chip>
        )}
        <div className="flex items-center gap-2">
          <span className="flex min-w-0 flex-1 items-center gap-1.5 text-muted">
            <Github className="h-3.5 w-3.5 shrink-0 text-faint" aria-hidden />
            <span className="truncate">{login ? `@${login}` : 'Not signed in'}</span>
          </span>
          {demo && <DemoMenu />}
        </div>
        {version && <div className="text-[10.5px] text-faint">{/^\d/.test(version) ? `v${version}` : version}</div>}
      </div>
    </aside>
  )
}
