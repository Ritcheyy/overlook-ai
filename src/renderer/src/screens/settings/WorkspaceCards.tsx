import { useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import type { Settings, Workspace } from '@core/domain'
import { uniqueWorkspaceId } from '@core/engine/workspaces'
import { cn } from '@/lib/cn'
import { Button } from '@/components/ui/Button'
import { Chip } from '@/components/ui/Chip'
import { IconButton } from '@/components/ui/IconButton'
import { Toggle } from '@/components/ui/Toggle'
import { TextField, type Save } from './fields'

const DETECTED_OFF_HINT = 'Detected because the folder holds several repos; turn on if they ship together.'
const ENABLED_HINT = 'Reviews in these repos see the siblings and your open PRs in them.'

function WorkspaceCard({
  workspace,
  knownRepos,
  onChange,
  onRemove
}: {
  workspace: Workspace
  knownRepos: string[]
  onChange: (patch: Partial<Workspace>) => void
  onRemove: () => void
}) {
  const [editing, setEditing] = useState(false)
  const manual = workspace.source === 'manual'
  const options = [...new Set([...knownRepos, ...workspace.repos])].sort()
  const toggleRepo = (name: string, on: boolean) =>
    onChange({ repos: on ? [...new Set([...workspace.repos, name])] : workspace.repos.filter((r) => r !== name) })
  return (
    <div role="group" aria-label={`Workspace ${workspace.name}`} className={cn('rounded-lg border border-line bg-bg px-3 py-2.5', !workspace.enabled && 'opacity-80')}>
      <div className="flex flex-wrap items-center gap-2">
        {manual ? (
          <TextField aria-label="Workspace name" value={workspace.name} onSave={(name) => onChange({ name: name.trim() || workspace.name })} wrapperClassName="w-[200px]" />
        ) : (
          <span className="text-[13px] font-medium text-ink">{workspace.name}</span>
        )}
        <Chip tone={manual ? 'accent' : 'teal'}>{workspace.source}</Chip>
        {workspace.rootPath && (
          <span className="min-w-0 truncate font-mono text-[11.5px] text-faint" title={workspace.rootPath}>
            {workspace.rootPath}
          </span>
        )}
        <div className="flex-1" />
        {manual && (
          <>
            <Button size="sm" variant="ghost" aria-pressed={editing} onClick={() => setEditing((e) => !e)}>
              {editing ? 'Done' : 'Edit repos'}
            </Button>
            <IconButton size="sm" tone="danger" aria-label={`Delete workspace ${workspace.name}`} onClick={onRemove}>
              <Trash2 />
            </IconButton>
          </>
        )}
      </div>
      <div className="mt-2 flex flex-wrap gap-1">
        {workspace.repos.length === 0 ? (
          <span className="text-[12px] text-faint">No repos yet.</span>
        ) : (
          workspace.repos.map((r) => (
            <Chip key={r} tone="muted" mono className="font-normal">
              {r}
            </Chip>
          ))
        )}
      </div>
      {editing && (
        <ul className="mt-2 grid grid-cols-1 gap-1 sm:grid-cols-2" aria-label={`Repos in ${workspace.name}`}>
          {options.map((name) => {
            const on = workspace.repos.includes(name)
            return (
              <li key={name}>
                <label className="flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-[12px] hover:bg-raised">
                  <input type="checkbox" className="h-3.5 w-3.5 accent-accent" checked={on} onChange={(e) => toggleRepo(name, e.target.checked)} />
                  <span className={on ? 'font-mono text-ink' : 'font-mono text-muted'}>{name}</span>
                </label>
              </li>
            )
          })}
        </ul>
      )}
      <div className="mt-2.5 flex flex-col gap-2 border-t border-line/60 pt-2.5">
        <div className="flex items-start gap-2">
          <Toggle size="sm" aria-label={`${workspace.name} enabled`} checked={workspace.enabled} onChange={(enabled) => onChange({ enabled })} className="mt-0.5" />
          <div className="min-w-0">
            <div className="text-[12px] text-ink">Enabled</div>
            <div className="text-[11.5px] leading-snug text-faint">{!manual && !workspace.enabled ? DETECTED_OFF_HINT : ENABLED_HINT}</div>
          </div>
        </div>
        {workspace.rootPath && (
          <div className="flex items-start gap-2">
            <Toggle
              size="sm"
              aria-label={`Share ${workspace.name} notes with reviews`}
              checked={workspace.includeNotes}
              onChange={(includeNotes) => onChange({ includeNotes })}
              className="mt-0.5"
            />
            <div className="min-w-0">
              <div className="text-[12px] text-ink">Share workspace notes with reviews</div>
              <div className="text-[11.5px] leading-snug text-faint">Your Claude memory for this folder, read-only; never posted.</div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export function WorkspaceCards({ settings, knownRepos, save }: { settings: Settings; knownRepos: string[]; save: Save }) {
  const { workspaces } = settings
  const update = (id: string, patch: Partial<Workspace>) => void save({ workspaces: workspaces.map((w) => (w.id === id ? { ...w, ...patch } : w)) })
  const remove = (id: string) => void save({ workspaces: workspaces.filter((w) => w.id !== id) })
  const add = () => {
    const id = uniqueWorkspaceId('workspace', workspaces.map((w) => w.id))
    void save({ workspaces: [...workspaces, { id, name: 'New workspace', repos: [], enabled: true, source: 'manual', includeNotes: false }] })
  }
  return (
    <div className="flex w-full flex-col gap-2">
      {workspaces.length === 0 && <div className="text-[12px] text-faint">None yet. A scan finds folders that hold several repos; or put one together by hand.</div>}
      {workspaces.map((ws) => (
        <WorkspaceCard key={ws.id} workspace={ws} knownRepos={knownRepos} onChange={(patch) => update(ws.id, patch)} onRemove={() => remove(ws.id)} />
      ))}
      <div>
        <Button size="sm" variant="secondary" icon={<Plus className="h-3.5 w-3.5" />} onClick={add}>
          New workspace
        </Button>
      </div>
    </div>
  )
}
