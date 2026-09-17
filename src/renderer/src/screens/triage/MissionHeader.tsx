import type { ReactNode } from 'react'
import { ExternalLink, Folder } from 'lucide-react'
import type { Loadout, Mission, ReviewRound, Slot } from '@core/domain'
import { api } from '@/lib/api'
import { formatDuration, shortSha } from '@/lib/format'
import { Button } from '@/components/ui/Button'
import { Chip } from '@/components/ui/Chip'
import { StateChip } from '@/components/app/StateChip'
import { useNow } from '@/components/app/useNow'
import { roundElapsedMs } from './shared'

export interface MissionHeaderProps {
  mission: Mission
  round?: ReviewRound
  slot?: Slot
  loadout?: Loadout
  actions?: ReactNode
}

function Sep() {
  return (
    <span className="text-faint/60" aria-hidden>
      ·
    </span>
  )
}

export function MissionHeader({ mission, round, slot, loadout, actions }: MissionHeaderProps) {
  const running = !!round && !round.finishedAt && round.durationMs === undefined
  const now = useNow(running ? 1000 : 60_000)
  const elapsed = roundElapsedMs(round, now)
  const pr = mission.pr
  const worktree = mission.worktreePath
  return (
    <div className="shrink-0 border-b border-line px-5 py-3">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <StateChip state={mission.state} />
            <a
              href={pr.url}
              title={pr.url}
              className="group inline-flex min-w-0 items-center gap-1 truncate text-[14px] font-semibold tracking-tight text-ink hover:text-accent"
            >
              <span className="truncate">{pr.title}</span>
              <ExternalLink className="h-3 w-3 shrink-0 opacity-0 transition-opacity group-hover:opacity-100" aria-hidden />
            </a>
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-muted">
            <span className="font-mono">
              {pr.repo.fullName}#{pr.number}
            </span>
            <Sep />
            <span className="font-mono" title={round?.headSha ?? pr.headSha}>
              {shortSha(round?.headSha ?? pr.headSha)}
            </span>
            {loadout && (
              <>
                <Sep />
                <Chip tone="muted" title={loadout.tagline}>
                  {loadout.name}
                </Chip>
              </>
            )}
            {slot && (
              <>
                <Sep />
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full" style={{ background: slot.color }} aria-hidden />
                  {slot.name}
                </span>
              </>
            )}
            {round && (
              <>
                <Sep />
                <span>Round {round.index}</span>
                <Sep />
                <span className="tabular-nums" title="Round duration">
                  {formatDuration(elapsed)}
                </span>
              </>
            )}
            {round?.model && (
              <>
                <Sep />
                <span className="font-mono" title="Model the round ran on">
                  {round.model}
                </span>
              </>
            )}
            {round?.effort && (
              <>
                <Sep />
                <span title="Effort level">effort {round.effort}</span>
              </>
            )}
            {round?.workspaceName && (
              <>
                <Sep />
                <span title="The review saw the sibling repos, your open PRs in them and the folder's notes">Workspace: {round.workspaceName}</span>
              </>
            )}
          </div>
        </div>
        {(worktree || actions) && (
          <div className="flex shrink-0 items-center gap-1.5">
            {worktree && (
              <Button size="sm" variant="ghost" icon={<Folder className="h-3.5 w-3.5" />} title={worktree} onClick={() => void api.openPath(worktree)}>
                Open worktree
              </Button>
            )}
            {actions}
          </div>
        )}
      </div>
    </div>
  )
}
