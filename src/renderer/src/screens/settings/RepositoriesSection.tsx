import { useState } from 'react'
import { FolderOpen, Plus, Radar, Trash2 } from 'lucide-react'
import type { LocalRepo, Settings } from '@core/domain'
import { api } from '@/lib/api'
import { cn } from '@/lib/cn'
import { plural } from '@/lib/format'
import { selectInbox, selectSnapshot, useAppStore } from '@/state/store'
import { Button } from '@/components/ui/Button'
import { IconButton } from '@/components/ui/IconButton'
import { Input } from '@/components/ui/Input'
import { Toggle } from '@/components/ui/Toggle'
import { Field, Section, TextField, type Save } from './fields'
import { WorkspaceCards } from './WorkspaceCards'

function ListEditor({ items, onChange, placeholder, label }: { items: string[]; onChange: (next: string[]) => void; placeholder: string; label: string }) {
  const [draft, setDraft] = useState('')
  const add = () => {
    const v = draft.trim()
    if (!v || items.includes(v)) return
    onChange([...items, v])
    setDraft('')
  }
  return (
    <div className="flex w-full flex-col gap-1.5">
      {items.length === 0 && <div className="text-[12px] text-faint">Nothing configured.</div>}
      <ul className="flex flex-col gap-1">
        {items.map((item) => (
          <li key={item} className="flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate rounded-md border border-line bg-bg px-2 py-1 font-mono text-[12px] text-muted" title={item}>
              {item}
            </span>
            <IconButton size="sm" tone="danger" aria-label={`Remove ${item}`} onClick={() => onChange(items.filter((i) => i !== item))}>
              <Trash2 />
            </IconButton>
          </li>
        ))}
      </ul>
      <div className="flex items-center gap-2">
        <Input
          mono
          aria-label={label}
          placeholder={placeholder}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') add()
          }}
        />
        <Button size="md" variant="secondary" icon={<Plus className="h-3.5 w-3.5" />} onClick={add} disabled={!draft.trim()}>
          Add
        </Button>
      </div>
    </div>
  )
}

function KeyValueEditor({
  entries,
  onChange,
  keyPlaceholder,
  valuePlaceholder,
  label
}: {
  entries: Record<string, string>
  onChange: (next: Record<string, string>) => void
  keyPlaceholder: string
  valuePlaceholder: string
  label: string
}) {
  const [key, setKey] = useState('')
  const [value, setValue] = useState('')
  const keys = Object.keys(entries).sort()
  const add = () => {
    const k = key.trim()
    const v = value.trim()
    if (!k || !v) return
    onChange({ ...entries, [k]: v })
    setKey('')
    setValue('')
  }
  const remove = (k: string) => {
    const next = { ...entries }
    delete next[k]
    onChange(next)
  }
  return (
    <div className="flex w-full flex-col gap-1.5">
      {keys.length === 0 && <div className="text-[12px] text-faint">Nothing configured.</div>}
      <ul className="flex flex-col gap-1">
        {keys.map((k) => (
          <li key={k} className="grid grid-cols-[minmax(140px,1fr)_minmax(0,2fr)_auto] items-center gap-2">
            <span className="truncate rounded-md border border-line bg-bg px-2 py-1 font-mono text-[12px] text-muted" title={k}>
              {k}
            </span>
            <TextField mono aria-label={`${label} for ${k}`} value={entries[k]} onSave={(v) => onChange({ ...entries, [k]: v })} />
            <IconButton size="sm" tone="danger" aria-label={`Remove ${k}`} onClick={() => remove(k)}>
              <Trash2 />
            </IconButton>
          </li>
        ))}
      </ul>
      <div className="grid grid-cols-[minmax(140px,1fr)_minmax(0,2fr)_auto] items-center gap-2">
        <Input mono aria-label={`New ${label} repository`} placeholder={keyPlaceholder} value={key} onChange={(e) => setKey(e.target.value)} />
        <Input
          mono
          aria-label={`New ${label}`}
          placeholder={valuePlaceholder}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') add()
          }}
        />
        <Button size="md" variant="secondary" icon={<Plus className="h-3.5 w-3.5" />} onClick={add} disabled={!key.trim() || !value.trim()}>
          Add
        </Button>
      </div>
    </div>
  )
}

interface RepoRow {
  fullName: string
  /** Absent for repos that only appear in the inbox. */
  local?: LocalRepo
}

/** Local checkouts and repos seen in the inbox, one row per `owner/name`, sorted. */
function repoRows(local: LocalRepo[], inboxRepos: string[]): RepoRow[] {
  const byName = new Map<string, RepoRow>()
  for (const r of local) if (!byName.has(r.fullName)) byName.set(r.fullName, { fullName: r.fullName, local: r })
  for (const name of inboxRepos) if (!byName.has(name)) byName.set(name, { fullName: name })
  return [...byName.values()].sort((a, b) => a.fullName.localeCompare(b.fullName))
}

export function RepositoriesSection({ settings, save }: { settings: Settings; save: Save }) {
  const snapshotRepos = useAppStore((s) => selectSnapshot(s)?.localRepos ?? [])
  const inbox = useAppStore(selectInbox)
  const pushToast = useAppStore((s) => s.pushToast)
  const [scanned, setScanned] = useState<LocalRepo[] | null>(null)
  const [scanning, setScanning] = useState(false)
  const repos = scanned ?? snapshotRepos
  const rows = repoRows(
    repos,
    inbox.map((p) => p.repo.fullName)
  )
  const isActive = (fullName: string) => !settings.inactiveRepos.includes(fullName)
  const activeCount = rows.filter((r) => isActive(r.fullName)).length
  const setActive = (fullName: string, on: boolean) => {
    const next = on ? settings.inactiveRepos.filter((r) => r !== fullName) : [...new Set([...settings.inactiveRepos, fullName])]
    void save({ inactiveRepos: next })
  }
  const setAllActive = (on: boolean) => {
    const names = rows.map((r) => r.fullName)
    // Repos not shown here keep their setting either way.
    const others = settings.inactiveRepos.filter((r) => !names.includes(r))
    void save({ inactiveRepos: on ? others : [...others, ...names] })
  }

  const scan = async () => {
    setScanning(true)
    try {
      const found = await api.discoverRepos()
      setScanned(found)
      pushToast({ kind: 'success', title: `Found ${plural(found.length, 'repository', 'repositories')}` })
    } catch (e) {
      pushToast({ kind: 'error', title: 'Scan failed', body: (e as Error).message })
    } finally {
      setScanning(false)
    }
  }

  // Switched-off repos never reach the inbox, so offering to auto-post them only adds noise; their choice is kept.
  const known = [...new Set([...repos.map((r) => r.fullName), ...Object.keys(settings.repoPaths), ...settings.autoPostRepos])]
    .filter((name) => !settings.inactiveRepos.includes(name))
    .sort()
  const toggleAutoPost = (fullName: string, on: boolean) => {
    const next = on ? [...new Set([...settings.autoPostRepos, fullName])] : settings.autoPostRepos.filter((r) => r !== fullName)
    void save({ autoPostRepos: next })
  }

  return (
    <Section
      id="repositories"
      title="Repositories"
      description="Where your checkouts live. Worktrees are created next to the main checkout of each repo."
      actions={
        <Button size="sm" variant="secondary" icon={<Radar className="h-3.5 w-3.5" />} loading={scanning} onClick={() => void scan()}>
          Scan
        </Button>
      }
    >
      <Field label="Project roots" hint="Scanned two levels deep for git repos. ~ is expanded." stacked>
        <ListEditor items={settings.projectsRoots} onChange={(projectsRoots) => void save({ projectsRoots })} placeholder="~/Projects" label="New project root" />
      </Field>
      <Field
        label="Workspaces"
        hint="Repos that ship together. A review in one of them can look at the others, at your open PRs there, and at the folder's notes."
        stacked
      >
        <WorkspaceCards settings={settings} knownRepos={known} save={save} />
      </Field>
      <Field
        label="Repositories"
        hint="Checkouts found under your project roots plus repos seen in the inbox. Switched-off repos are hidden from the inbox and never fetched."
        stacked
      >
        {rows.length === 0 ? (
          <div className="text-[12px] text-faint">Run a scan to map remotes to local paths.</div>
        ) : (
          <div className="flex w-full flex-col gap-2">
            <div className="flex items-center gap-2">
              <span className="text-[12px] tabular-nums text-muted" data-testid="active-repos-caption">
                {activeCount} of {rows.length} active
              </span>
              <div className="flex-1" />
              <Button size="sm" variant="ghost" onClick={() => setAllActive(false)} disabled={activeCount === 0}>
                Turn all off
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setAllActive(true)} disabled={activeCount === rows.length}>
                Turn all on
              </Button>
            </div>
            <div className="w-full overflow-x-auto rounded-md border border-line">
              <table className="w-full border-collapse text-[12px]">
                <thead>
                  <tr className="bg-bg text-[10.5px] uppercase tracking-wider text-faint">
                    <th className="px-2 py-1.5 text-left font-semibold">Active</th>
                    <th className="px-2 py-1.5 text-left font-semibold">Repository</th>
                    <th className="px-2 py-1.5 text-left font-semibold">Path</th>
                    <th className="px-2 py-1.5 text-left font-semibold">Branch</th>
                    <th className="px-2 py-1.5 text-left font-semibold">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(({ fullName, local }) => {
                    const on = isActive(fullName)
                    const path = settings.repoPaths[fullName] ?? local?.path
                    return (
                      <tr key={fullName} className={cn('border-t border-line/60', !on && 'text-faint')}>
                        <td className="px-2 py-1.5">
                          <Toggle size="sm" aria-label={`${fullName} active`} checked={on} onChange={(next) => setActive(fullName, next)} />
                        </td>
                        <td className={cn('px-2 py-1.5 font-mono', on ? 'text-ink' : 'text-muted')}>{fullName}</td>
                        <td className="max-w-[360px] truncate px-2 py-1.5 font-mono text-muted" title={path}>
                          {path ?? <span className="text-faint">not found locally</span>}
                          {settings.repoPaths[fullName] && <span className="ml-1.5 text-[10.5px] text-amber">override</span>}
                        </td>
                        <td className="px-2 py-1.5 font-mono text-faint">{local?.defaultBranch ?? '—'}</td>
                        <td className="px-2 py-1.5 text-right">
                          {path && (
                            <IconButton size="sm" aria-label={`Reveal ${fullName} in Finder`} onClick={() => void api.openPath(path)}>
                              <FolderOpen />
                            </IconButton>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </Field>
      <Field label="Path overrides" hint="For repos discovery gets wrong: owner/name → absolute path." stacked>
        <KeyValueEditor entries={settings.repoPaths} onChange={(repoPaths) => void save({ repoPaths })} keyPlaceholder="owner/name" valuePlaceholder="/absolute/path/to/checkout" label="path override" />
      </Field>
      <Field label="Prepare commands" hint="Run once inside each fresh worktree, keyed by owner/name." stacked>
        <KeyValueEditor entries={settings.prepareCommands} onChange={(prepareCommands) => void save({ prepareCommands })} keyPlaceholder="owner/name" valuePlaceholder="pnpm install --frozen-lockfile" label="prepare command" />
      </Field>
      <Field label="Link node_modules" hint="Symlink node_modules from the main checkout into new worktrees so reviews do not wait on installs." htmlFor="link-node-modules">
        <Toggle aria-label="Link node_modules" checked={settings.linkNodeModules} onChange={(linkNodeModules) => void save({ linkNodeModules })} />
      </Field>
      <Field label="Auto-post repos" hint="Findings for these active repos post straight to the PR with no triage stop." stacked>
        {known.length === 0 ? (
          <div className="text-[12px] text-faint">Scan your project roots first, or add a path override above.</div>
        ) : (
          <ul className="grid w-full grid-cols-1 gap-1 sm:grid-cols-2">
            {known.map((name) => {
              const on = settings.autoPostRepos.includes(name)
              return (
                <li key={name}>
                  <label className="flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-[12px] hover:bg-raised">
                    <input type="checkbox" className="h-3.5 w-3.5 accent-accent" checked={on} onChange={(e) => toggleAutoPost(name, e.target.checked)} />
                    <span className={on ? 'font-mono text-ink' : 'font-mono text-muted'}>{name}</span>
                  </label>
                </li>
              )
            })}
          </ul>
        )}
      </Field>
    </Section>
  )
}
