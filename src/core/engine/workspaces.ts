/**
 * Workspaces: repos that ship together. The repos adapter detects them; this
 * module merges what it found into the user's settings and builds the context
 * a review gets to see beyond its own worktree. Browser-safe.
 */
import type { DetectedWorkspace, LocalRepo, PullRequest, Workspace } from '../domain'
import type { WorkspaceContext } from '../ports'

export function workspaceSlug(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug || 'workspace'
}

/** `ws-<slug>`, numbered when the slug is already taken. */
export function uniqueWorkspaceId(name: string, taken: Iterable<string>): string {
  const used = new Set(taken)
  const base = `ws-${workspaceSlug(name)}`
  if (!used.has(base)) return base
  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}`
    if (!used.has(candidate)) return candidate
  }
}

/**
 * Detected entries are matched by root path: the user's name, enabled and
 * includeNotes survive, the repo list follows the disk, and roots that
 * vanished drop out. A new container starts enabled only when it carries a
 * CLAUDE.md, the sign the user already treats the folder as one workspace.
 * Manual entries are left alone.
 */
export function mergeDetectedWorkspaces(existing: Workspace[], detected: DetectedWorkspace[]): Workspace[] {
  const pending = new Map(detected.map((d) => [d.rootPath, d]))
  const merged: Workspace[] = []
  for (const ws of existing) {
    if (ws.source !== 'detected') {
      merged.push(ws)
      continue
    }
    const found = ws.rootPath ? pending.get(ws.rootPath) : undefined
    if (!found) continue
    pending.delete(found.rootPath)
    merged.push({ ...ws, repos: [...found.repos] })
  }
  const ids = new Set(merged.map((w) => w.id))
  for (const d of detected) {
    if (!pending.has(d.rootPath)) continue
    pending.delete(d.rootPath)
    const id = uniqueWorkspaceId(d.name, ids)
    ids.add(id)
    merged.push({ id, name: d.name, rootPath: d.rootPath, repos: [...d.repos], enabled: d.hasClaudeMd, source: 'detected', includeNotes: true })
  }
  return merged
}

/** The first enabled workspace that lists the repo. */
export function workspaceFor(workspaces: Workspace[], fullName: string): Workspace | undefined {
  return workspaces.find((w) => w.enabled && w.repos.includes(fullName))
}

export interface WorkspaceContextArgs {
  workspace: Workspace
  /** The repo under review; it is left out of the siblings. */
  fullName: string
  localRepos: LocalRepo[]
  /** Resolves a sibling's checkout, honouring path overrides. */
  pathOf: (fullName: string) => string | undefined
  /** The reviewer's own PRs; only open ones in sibling repos are kept. */
  myPrs: PullRequest[]
  notes?: string
}

export function buildWorkspaceContext({ workspace, fullName, localRepos, pathOf, myPrs, notes }: WorkspaceContextArgs): WorkspaceContext {
  const siblings = workspace.repos
    .filter((r) => r !== fullName)
    .map((r) => {
      const sibling: WorkspaceContext['siblings'][number] = { fullName: r }
      const path = pathOf(r)
      if (path) sibling.path = path
      const defaultBranch = localRepos.find((l) => l.fullName === r)?.defaultBranch
      if (defaultBranch) sibling.defaultBranch = defaultBranch
      return sibling
    })
  const siblingNames = new Set(siblings.map((s) => s.fullName))
  const myOpenPrs = myPrs
    .filter((p) => p.state === 'open' && siblingNames.has(p.repo.fullName))
    .sort((a, b) => a.repo.fullName.localeCompare(b.repo.fullName) || a.number - b.number)
    .map((p) => ({ fullName: p.repo.fullName, number: p.number, title: p.title, headRef: p.headRef, baseRef: p.baseRef, url: p.url }))
  const context: WorkspaceContext = { name: workspace.name, siblings, myOpenPrs }
  if (workspace.rootPath) context.rootPath = workspace.rootPath
  if (notes) context.notes = notes
  return context
}

/** The activity line announcing what a review gets to see. */
export function describeWorkspaceContext(context: WorkspaceContext): string {
  const k = context.siblings.length
  return `Workspace ${context.name}: ${k} sibling ${k === 1 ? 'repo' : 'repos'}, ${context.myOpenPrs.length} of your open PRs`
}
