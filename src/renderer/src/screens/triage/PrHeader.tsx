import { useCallback, useRef, useState } from 'react'
import { Folder, FolderGit2, GitBranch, Github, MoreHorizontal, X } from 'lucide-react'
import type { Mission, PullRequest } from '@core/domain'
import { api } from '@/lib/api'
import { plural, relativeTime } from '@/lib/format'
import { Chip } from '@/components/ui/Chip'
import { Dropdown, MenuItem } from '@/components/ui/Dropdown'
import { IconButton } from '@/components/ui/IconButton'
import { StateChip } from '@/components/app/StateChip'
import { GitHubDecision } from '@/components/app/PrMarkers'
import { useMissionActions } from './useMissionActions'

function Sep() {
  return (
    <span className="text-faint/60" aria-hidden>
      ·
    </span>
  )
}

function MoreMenu({ mission }: { mission: Mission }) {
  const actions = useMissionActions()
  const anchor = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const [arming, setArming] = useState(false)
  const close = useCallback(() => {
    setOpen(false)
    setArming(false)
  }, [])
  const worktree = mission.worktreePath
  const closable = mission.state !== 'closed' && mission.state !== 'posting'
  if (!worktree && !closable) return null
  return (
    <>
      <IconButton ref={anchor} aria-label="More actions" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <MoreHorizontal />
      </IconButton>
      <Dropdown open={open} onClose={close} anchorRef={anchor} align="end" width={250}>
        <div role="menu" aria-label="More actions">
          {worktree && (
            <MenuItem
              icon={<Folder />}
              hint={<span className="font-mono">{worktree.split('/').pop()}</span>}
              title={worktree}
              onClick={() => {
                close()
                void api.openPath(worktree)
              }}
            >
              Open worktree
            </MenuItem>
          )}
          {closable && (
            <MenuItem
              icon={<X />}
              tone="danger"
              onClick={() => {
                if (!arming) {
                  setArming(true)
                  return
                }
                close()
                void actions.close(mission.id)
              }}
            >
              {arming ? 'Click again to close and remove the worktree' : 'Close review'}
            </MenuItem>
          )}
        </div>
      </Dropdown>
    </>
  )
}

export interface PrHeaderProps {
  pr: PullRequest
  mission?: Mission
  now: number
}

/** Which PR this is, whose, from which branch, and how big: the details header. */
export function PrHeader({ pr, mission, now }: PrHeaderProps) {
  const added = pr.additions ?? 0
  const removed = pr.deletions ?? 0
  return (
    <header className="shrink-0 border-b border-line px-5 pb-3 pt-3">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-muted">
            <FolderGit2 className="h-3.5 w-3.5 text-faint" aria-hidden />
            <span>
              <span className="text-faint">{pr.repo.owner}/</span>
              <span className="font-medium text-ink">{pr.repo.name}</span>
            </span>
            <span className="font-mono text-faint">#{pr.number}</span>
            {mission ? <StateChip state={mission.state} /> : <Chip tone="faint">Not reviewed</Chip>}
            {pr.isDraft && <Chip tone="faint">Draft</Chip>}
            <GitHubDecision decision={pr.reviewDecision} />
          </div>
          <h2 className="mt-1 line-clamp-2 text-[15px] font-semibold leading-snug tracking-tight text-ink" title={pr.title}>
            {pr.title}
          </h2>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-muted">
            <span className="text-ink/90">@{pr.author}</span>
            <Sep />
            <span title={pr.createdAt}>opened {relativeTime(pr.createdAt, now)}</span>
            <Sep />
            <span title={pr.updatedAt}>updated {relativeTime(pr.updatedAt, now)}</span>
            <Sep />
            <span className="inline-flex min-w-0 items-center gap-1 font-mono text-[11.5px]" title={`${pr.headRef} into ${pr.baseRef}`}>
              <GitBranch className="h-3 w-3 shrink-0 text-faint" aria-hidden />
              <span className="truncate">{pr.headRef}</span>
              <span className="text-faint">→</span>
              <span className="truncate">{pr.baseRef}</span>
            </span>
            <Sep />
            <span className="font-mono tabular-nums">
              <span className="text-lime/80">+{added}</span> <span className="text-rose/80">−{removed}</span>
            </span>
            {pr.changedFiles !== undefined && (
              <>
                <Sep />
                <span>{plural(pr.changedFiles, 'file')}</span>
              </>
            )}
            {pr.labels.map((l) => (
              <Chip key={l} tone="muted" className="font-normal">
                {l}
              </Chip>
            ))}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <IconButton aria-label="Open on GitHub" title={pr.url} onClick={() => void api.openExternal(pr.url)}>
            <Github />
          </IconButton>
          {mission && <MoreMenu mission={mission} />}
        </div>
      </div>
    </header>
  )
}
